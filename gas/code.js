/**
 * ==========================================================================
 * バックエンド処理（code.gs）- スコア管理ツール専用（新MasterData対応版）
 * ==========================================================================
 */

function doPost(e) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let logSheet = ss.getSheetByName("DebugLog") || ss.insertSheet("DebugLog");

    try {
        if (!e || !e.postData || !e.postData.contents) {
            throw new Error("リクエストデータが空です");
        }

        const params = JSON.parse(e.postData.contents);
        const mode = String(params.mode || "checker");

        // 1. ランキング取得モード
        if (mode === "get_ranking") {
            const t = String(params.title || "");
            const d = String(params.diff || "");
            
            const results = getRankingFromSheets(ss, t, d, params, logSheet);
            
            const songProps = getSongPropsFromMaster(ss, t, d); 
            return createJsonResponse({ status: "success", data: results, songProps: songProps });
        }

        // 2. 統計取得モード（読み取り専用）
        if (mode === "get_stats") {
            const results = getStatsFromSheets(ss, params);
            return createJsonResponse({ status: "success", data: results });
        }

        // 3. 特定のプレイヤーの全プレイデータ取得（読み取り専用）
        if (mode === "get_player_detail") {
            const playerName = String(params.playerName || "");
            const results = getPlayerDetailFromSheet(ss, playerName, params);
            return createJsonResponse({ status: "success", data: results });
        }

        // VS機能 プレイヤー一覧取得モード（読み取り専用）
        if (mode === "get_vs_players") {
            const sheets = ss.getSheets();
            const playerNames = sheets.map(s => s.getName()).filter(name => 
                name !== "UserMap" && name !== "MasterData" && name !== "DebugLog" && name !== "NewSongs" && name !== "マスター" && name !== "設定"
            ); 
            return createJsonResponse({ status: "success", players: playerNames });
        }

        // VS機能 スコア比較データ取得モード（読み取り専用）
        if (mode === "get_vs_data") {
            const comparisonData = getVsDataFromSheets(ss, params);
            return createJsonResponse({ status: "success", data: comparisonData });
        }

        // 4. 同期/認証モード (checker) 
        if (mode === "checker") {
            const lock = LockService.getScriptLock();
            if (!lock.tryLock(15000)) {
                return createJsonResponse({ status: "error", message: "サーバーが混雑しています。少し時間を置いて再度お試しください。" });
            }

            try {
                const token = String(params.token || "");
                let playerName = String(params.playerName || "");
                
                playerName = playerName.replace(/[\*＼\/\\\[\]\?：:]/g, "").trim();

                const records = fetchAndProcessFromApi(token, ss);

                const hashedToken = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)
                    .map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');

                let userMapSheet = ss.getSheetByName("UserMap") || ss.insertSheet("UserMap");
                if (userMapSheet.getLastRow() === 0) userMapSheet.appendRow(["token_hash", "name"]);

                const userMapData = userMapSheet.getDataRange().getValues();
                let userRowIndex = userMapData.findIndex(row => row[0] === hashedToken);

                if (userRowIndex === -1) {
                    const sameNameIndex = userMapData.findIndex(row => row[1] === playerName);

                    if (sameNameIndex !== -1) {
                        userMapSheet.getRange(sameNameIndex + 1, 1).setValue(hashedToken);
                        userRowIndex = sameNameIndex; 
                    } else if (!playerName) {
                        return createJsonResponse({ status: "need_name" });
                    } else {
                        userMapSheet.appendRow([hashedToken, playerName]);
                    }
                } else {
                    playerName = userMapData[userRowIndex][1];
                }

                updateUserSheet(ss, playerName, records);
                return createJsonResponse({ status: "success", playerName: playerName, records: records });

            } finally {
                lock.releaseLock();
            }
        }

        throw new Error("無効なモードが指定されました: " + mode);

    } catch (error) {
        logSheet.appendRow([new Date(), "ERROR", String(error.message || error)]);
        return createJsonResponse({ status: "error", message: error.toString() });
    }
}

/**
 * ランキング取得ロジック（MainTrend判定版）
 */
function getRankingFromSheets(ss, title, diff, params, logSheet) {
    const userMapSheet = ss.getSheetByName("UserMap");
    if (!userMapSheet) return [];

    const userMap = userMapSheet.getDataRange().getValues();
    const results = [];

    const normalize = (str) => String(str || "").replace(/\s+/g, "").toLowerCase();
    const targetTitle = normalize(title);
    const targetDiff = normalize(diff);

    const isTrendEnabled = !!(params.trendEnable !== undefined ? params.trendEnable : params.isTrendEnabled);
    const rawTrends = Array.isArray(params.trends) ? params.trends : (Array.isArray(params.activeTrends) ? params.activeTrends : []);
    const activeTrends = rawTrends.map(t => String(t).toUpperCase().trim());

    if (isTrendEnabled && activeTrends.length > 0) {
        const masterSheet = ss.getSheetByName("MasterData");
        if (masterSheet) {
            const masterData = masterSheet.getDataRange().getValues();
            if (masterData.length > 1) {
                const headerRow = masterData[0].map(h => String(h).toLowerCase().trim());
                
                // J列の見出し（maintrend）のインデックスを探す（なければデフォルトJ=9）
                let mainIdx = headerRow.findIndex(h => h.includes("maintrend") || h === "main");
                if (mainIdx === -1) mainIdx = 9;

                const titleIdx = headerRow.findIndex(h => h.includes("title") || h.includes("曲名")) !== -1 ? headerRow.findIndex(h => h.includes("title") || h.includes("曲名")) : 0;
                const diffIdx = headerRow.findIndex(h => h.includes("diff") || h.includes("難易度")) !== -1 ? headerRow.findIndex(h => h.includes("diff") || h.includes("難易度")) : 1;

                let isMatchTrend = false;
                for (let i = 1; i < masterData.length; i++) {
                    if (normalize(masterData[i][titleIdx]) === targetTitle && normalize(masterData[i][diffIdx]) === targetDiff) {
                        const mMain = String(masterData[i][mainIdx] || "").toUpperCase().trim();
                        
                        // MainTrendが、画面側で選択されているトレンド配列に含まれているか判定
                        isMatchTrend = activeTrends.includes(mMain);
                        break;
                    }
                }
                if (!isMatchTrend) {
                    return [];
                }
            }
        }
    }

    const allSheets = ss.getSheets();
    const sheetDataMap = {};
    allSheets.forEach(sheet => {
        const sName = sheet.getName();
        if (sName !== "UserMap" && sName !== "MasterData" && sName !== "DebugLog" && sName !== "NewSongs") {
            sheetDataMap[sName] = sheet.getDataRange().getValues();
        }
    });

    for (let i = 1; i < userMap.length; i++) {
        const name = String(userMap[i][1] || "");
        if (!name) continue;

        const data = sheetDataMap[name];
        if (!data) {
            results.push({ playerName: name, score: "-", lamp: "-" });
            continue;
        }

        let match = null;
        for (let j = 1; j < data.length; j++) {
            if (normalize(data[j][0]) === targetTitle && normalize(data[j][1]) === targetDiff) {
                match = data[j];
                break;
            }
        }

        if (match) {
            const scoreVal = (match[3] !== undefined && match[3] !== null) ? match[3] : "-";
            const lampVal = (match[5] !== undefined && match[5] !== null) ? String(match[5]) : "-";
            results.push({ playerName: name, score: scoreVal, lamp: lampVal });
        } else {
            results.push({playerName: name, score: "-", lamp: "-" });
        }
    }

    return results.sort((a, b) => {
        const sA = (a.score === "-" || !a.score) ? -1 : parseFloat(a.score);
        const sB = (b.score === "-" || !b.score) ? -1 : parseFloat(b.score);
        return sB - sA;
    });
}

/**
 * MasterDataから特定の楽曲のプロパティを取得する
 */
function getSongPropsFromMaster(ss, title, diff) {
    const defaultProps = { tairyoku: 0, kenban: 0, chuni: 0, kuse: 0, mainTrend: "None", subTrend: "None" };
    const masterSheet = ss.getSheetByName("MasterData");
    if (!masterSheet) return defaultProps;

    const lastRow = masterSheet.getLastRow();
    if (lastRow <= 1) return defaultProps;

    const data = masterSheet.getRange(1, 1, lastRow, 11).getValues();
    const normalize = (str) => String(str || "").replace(/\s+/g, "").toLowerCase();
    const targetTitle = normalize(title);
    const targetDiff = normalize(diff);

    for (let i = 1; i < data.length; i++) {
        if (normalize(data[i][0]) === targetTitle && normalize(data[i][1]) === targetDiff) {
            return {
                tairyoku: parseFloat(data[i][4]) || 0, // E列
                kenban: parseFloat(data[i][5]) || 0,   // F列
                chuni: parseFloat(data[i][6]) || 0,    // G列
                kuse: parseFloat(data[i][7]) || 0,     // H列
                mainTrend: String(data[i][9] || "None").trim(),  // J列 (Main)
                subTrend: String(data[i][10] || "None").trim()   // K列 (Sub)
            };
        }
    }
    return defaultProps;
}

/**
 * 統計情報を取得（MainTrend文字列判定のみ版）
 */
function getStatsFromSheets(ss, params) {
    const userMapSheet = ss.getSheetByName("UserMap");
    if (!userMapSheet) return [];

    const userMap = userMapSheet.getDataRange().getValues();
    const results = [];
    const songAggregation = {};

    const minC = parseFloat(params.minConst || 0);
    const maxC = parseFloat(params.maxConst || 16.0);
    const minRating = parseFloat(params.minRate || 0);
    const maxRating = parseFloat(params.maxRate || 21.0);
    const rMin = parseFloat(params.rankMin || 0);
    const rMax = parseFloat(params.rankMax || 1010000);
    const targetLamp = String(params.lampFilter || 'all');
    const typeFilter = String(params.typeFilter || 'all');
    const filterMode = String(params.filterMode || "rank");

    const isTrendEnabled = !!(params.trendEnable !== undefined ? params.trendEnable : params.isTrendEnabled);
    const rawTrends = Array.isArray(params.trends) ? params.trends : (Array.isArray(params.activeTrends) ? params.activeTrends : []);
    const activeTrends = rawTrends.map(t => String(t).toUpperCase().trim());

    const masterSheet = ss.getSheetByName("MasterData");
    const masterTrendMap = {}; 
    let totalMatchingSongs = 0;

    let targetConstIdx = 2;
    let targetIsNewIdx = 3;

    if (masterSheet) {
        const masterData = masterSheet.getDataRange().getValues();
        if (masterData.length > 1) {
            const headerRow = masterData[0].map(h => String(h).toLowerCase().trim());
            const constColumnIndex = headerRow.findIndex(h => h.includes("const"));
            const isNewColumnIndex = headerRow.findIndex(h => h.includes("isnew"));
            
            let mainIdx = headerRow.findIndex(h => h.includes("maintrend") || h === "main");
            if (mainIdx === -1) mainIdx = 9;

            const titleIdx = headerRow.findIndex(h => h.includes("title") || h.includes("曲名")) !== -1 ? headerRow.findIndex(h => h.includes("title") || h.includes("曲名")) : 0;
            const diffIdx = headerRow.findIndex(h => h.includes("diff") || h.includes("難易度")) !== -1 ? headerRow.findIndex(h => h.includes("diff") || h.includes("難易度")) : 1;

            if (constColumnIndex !== -1) targetConstIdx = constColumnIndex;
            if (isNewColumnIndex !== -1) targetIsNewIdx = isNewColumnIndex;

            for (let i = 1; i < masterData.length; i++) {
                const mRow = masterData[i];
                const mTitle = String(mRow[titleIdx] || "");
                const mDiff = String(mRow[diffIdx] || "");
                const mFullKey = mDiff ? `${mTitle.trim()}_${mDiff.trim()}` : mTitle.trim();

                const cConst = parseFloat(mRow[targetConstIdx] || 0);
                const isNewStr = String(mRow[targetIsNewIdx] || "").toLowerCase().trim();

                // J列(MainTrend)のみをマップに保持
                const mMain = String(mRow[mainIdx] || "").toUpperCase().trim();
                masterTrendMap[mFullKey] = mMain;

                if (cConst >= minC && cConst <= maxC) {
                    let passType = false;
                    if (typeFilter === 'all') passType = true;
                    else if (typeFilter === 'new' && isNewStr === 'true') passType = true;
                    else if (typeFilter === 'old' && isNewStr !== 'true') passType = true;

                    if (passType) {
                        let passTrend = true;
                        if (isTrendEnabled && activeTrends.length > 0) {
                            passTrend = activeTrends.includes(mMain);
                        }
                        if (passTrend) {
                            totalMatchingSongs++;
                        }
                    }
                }
            }
        }
    }

    const allSheets = ss.getSheets();
    const sheetDataMap = {};
    allSheets.forEach(sheet => {
        const sName = sheet.getName();
        if (sName !== "UserMap" && sName !== "MasterData" && sName !== "DebugLog" && sName !== "NewSongs" && sName !== "マスター" && sName !== "設定") {
            sheetDataMap[sName] = sheet.getDataRange().getValues();
        }
    });

    for (let i = 1; i < userMap.length; i++) {
        const name = String(userMap[i][1] || "");
        const data = sheetDataMap[name];
        if (!data) continue;

        let playerCountFiltered = 0;
        let playerTotalScoreFiltered = 0;
        let playerTotalCountFiltered = 0;

        for (let j = 1; j < data.length; j++) {
            const row = data[j];
            if (!row || row.length < 7) continue;

            const cConst = parseFloat(row[2] || 0);
            if (cConst < minC || cConst > maxC) continue;

            const songName = String(row[0] || "不明な曲");
            const diff = String(row[1] || "");
            const fullTitleKey = diff ? `${songName.trim()}_${diff.trim()}` : songName.trim();

            if (isTrendEnabled && activeTrends.length > 0) {
                const songMainTrend = masterTrendMap[fullTitleKey];
                if (!songMainTrend) continue; 
                // Mainが選択中のトレンドに含まれているかのみを判定
                if (!activeTrends.includes(songMainTrend)) continue; 
            }

            const cScore = parseFloat(row[3] || 0);
            const cRating = parseFloat(row[4] || 0);
            const cLamp = String(row[5] || "");
            const isNewSongStr = String(row[6] || "").toLowerCase().trim();

            const fullTitleDisplay = diff ? `${songName} [${diff}]` : songName;

            if (!songAggregation[fullTitleDisplay]) {
                songAggregation[fullTitleDisplay] = {
                    count: 0, constant: cConst, players: [],
                    totalScoreAll: 0, totalCountAll: 0
                };
            }
            songAggregation[fullTitleDisplay].totalScoreAll += cScore;
            songAggregation[fullTitleDisplay].totalCountAll++;

            let isAchieved = true;
            if (cRating < minRating || cRating > maxRating) isAchieved = false;
            
            function getUpperLimitGASFallback(val) { return val; }
            let limitMax = (filterMode === "score") ? rMax : (typeof getUpperLimitGAS === 'function' ? getUpperLimitGAS(rMax) : getUpperLimitGASFallback(rMax));
            if (cScore < rMin || cScore > limitMax) isAchieved = false;

            if (targetLamp !== 'all') {
                if (targetLamp === 'ajc' && !cLamp.includes('AJC')) isAchieved = false;
                else if (targetLamp === 'aj' && !cLamp.includes('AJ')) isAchieved = false;
                else if (targetLamp === 'None' && (cLamp.includes('AJ') || cLamp.includes('AJC'))) isAchieved = false;
            }

            if (isAchieved) {
                songAggregation[fullTitleDisplay].count++;
            }
            songAggregation[fullTitleDisplay].players.push({
                name: name, score: cScore, isAchieved: isAchieved
            });

            let passTypeFilter = false;
            if (typeFilter === 'all') passTypeFilter = true;
            else if (typeFilter === 'new' && isNewSongStr === 'true') passTypeFilter = true;
            else if (typeFilter === 'old' && isNewSongStr !== 'true') passTypeFilter = true;

            if (passTypeFilter) {
                playerTotalCountFiltered++;
                playerTotalScoreFiltered += cScore;
                if (isAchieved) {
                    playerCountFiltered++;
                }
            }
        }

        results.push({
            playerName: name,
            count: playerCountFiltered,
            allPlayCount: playerTotalCountFiltered,
            avgScore: playerTotalCountFiltered > 0 ? Math.round(playerTotalScoreFiltered / playerTotalCountFiltered) : 0
        });
    }

    const songRanking = Object.keys(songAggregation).map(t => {
        const data = songAggregation[t];
        return {
            title: t, count: data.count, constant: data.constant, players: data.players,
            avgScore: data.totalCountAll > 0 ? Math.round(data.totalScoreAll / data.totalCountAll) : 0,
            totalCountAll: data.totalCountAll || 0
        };
    });

    return {
        playerRanking: results,
        songRanking: songRanking,
        theoryCount: totalMatchingSongs,
        totalUsers: userMap.length - 1
    };
}

/**
 * 特定のプレイヤーの詳細データを取得する（MainTrend文字列判定のみ版）
 */
function getPlayerDetailFromSheet(ss, playerName, params) {
    playerName = playerName.replace(/[\*＼\/\\\[\]\?：:]/g, "").trim();
    const sheet = ss.getSheetByName(playerName);
    if (!sheet) return [];

    const data = sheet.getDataRange().getValues();
    const details = [];

    const minC = parseFloat(params.minConst || 0);
    const maxC = parseFloat(params.maxConst || 16.0);
    const minRating = parseFloat(params.minRate || 0);
    const maxRating = parseFloat(params.maxRate || 21.0);
    const rMin = parseFloat(params.rankMin || 0);
    const rMax = parseFloat(params.rankMax || 1010000);
    const targetLamp = String(params.lampFilter || 'all');
    const typeFilter = String(params.typeFilter || 'all');
    const filterMode = String(params.filterMode || "rank");

    const isTrendEnabled = !!(params.trendEnable !== undefined ? params.trendEnable : params.isTrendEnabled);
    const rawTrends = Array.isArray(params.trends) ? params.trends : (Array.isArray(params.activeTrends) ? params.activeTrends : []);
    const activeTrends = rawTrends.map(t => String(t).toUpperCase().trim());

    const masterSheet = ss.getSheetByName("MasterData");
    const masterTrendMap = {};
    if (masterSheet) {
        const masterData = masterSheet.getDataRange().getValues();
        if (masterData.length > 1) {
            const headerRow = masterData[0].map(h => String(h).toLowerCase().trim());
            
            let mainIdx = headerRow.findIndex(h => h.includes("maintrend") || h === "main");
            if (mainIdx === -1) mainIdx = 9;

            const titleIdx = headerRow.findIndex(h => h.includes("title") || h.includes("曲名")) !== -1 ? headerRow.findIndex(h => h.includes("title") || h.includes("曲名")) : 0;
            const diffIdx = headerRow.findIndex(h => h.includes("diff") || h.includes("難易度")) !== -1 ? headerRow.findIndex(h => h.includes("diff") || h.includes("難易度")) : 1;

            for (let i = 1; i < masterData.length; i++) {
                const mRow = masterData[i];
                const mTitle = String(mRow[titleIdx] || "");
                const mDiff = String(mRow[diffIdx] || "");
                const mFullKey = mDiff ? `${mTitle.trim()}_${mDiff.trim()}` : mTitle.trim();

                masterTrendMap[mFullKey] = String(mRow[mainIdx] || "").toUpperCase().trim();
            }
        }
    }

    for (let j = 1; j < data.length; j++) {
        const row = data[j];
        if (!row || row.length < 7) continue;

        const cConst = parseFloat(row[2] || 0);
        if (cConst < minC || cConst > maxC) continue;

        const songName = String(row[0] || "");
        const diff = String(row[1] || "");
        
        const fullTitleKey = diff ? `${songName.trim()}_${diff.trim()}` : songName.trim();

        if (isTrendEnabled && activeTrends.length > 0) {
            const songMainTrend = masterTrendMap[fullTitleKey];
            if (!songMainTrend) continue; 
            if (!activeTrends.includes(songMainTrend)) continue; 
        }

        const isNewSongStr = String(row[6] || "").toLowerCase().trim();
        let passType = (typeFilter === 'all') || 
                       (typeFilter === 'new' && isNewSongStr === 'true') || 
                       (typeFilter === 'old' && isNewSongStr !== 'true');
        if (!passType) continue;

        const cScore = parseFloat(row[3] || 0);
        const cRating = parseFloat(row[4] || 0);
        const cLamp = String(row[5] || "");

        let isAchieved = true;
        if (cRating < minRating || cRating > maxRating) isAchieved = false;
        
        function getUpperLimitGASFallback(val) { return val; }
        let limitMax = (filterMode === "score") ? rMax : (typeof getUpperLimitGAS === 'function' ? getUpperLimitGAS(rMax) : getUpperLimitGASFallback(rMax));
        if (cScore < rMin || cScore > limitMax) isAchieved = false;

        if (targetLamp !== 'all') {
            if (targetLamp === 'ajc' && !cLamp.includes('AJC')) isAchieved = false;
            else if (targetLamp === 'aj' && !cLamp.includes('AJ')) isAchieved = false;
            else if (targetLamp === 'None' && (cLamp.includes('AJ') || cLamp.includes('AJC'))) isAchieved = false;
        }

        const fullTitleDisplay = diff ? `${songName} [${diff}]` : songName;
        details.push({
            title: fullTitleDisplay,
            score: cScore,
            isAchieved: isAchieved
        });
    }
    return details.sort((a, b) => b.score - a.score);
}

/**
 * 補助関数：基準スコアのランク区分の「上限」を返す（GAS用）
 */
function getUpperLimitGAS(score) {
    if (score >= 1010000) return 1010001; 
    if (score >= 1009900) return 1010000; 
    if (score >= 1009000) return 1009899; 
    if (score >= 1007500) return 1008999; 
    if (score >= 1007000) return 1007499; 
    if (score >= 1005000) return 1006999; 
    if (score >= 1000000) return 1004999; 
    if (score >= 990000) return 999999;  
    if (score >= 970000) return 989999;  
    return 969999;
}


/**
 * VS機能 スコア比較データ取得モード
 */
function getVsDataFromSheets(ss, params) {
    const myName = String(params.myName || "").trim();
    const opponents = params.opponents || []; 
    const minC = parseFloat(params.minConst || 13.5);
    const maxC = parseFloat(params.maxConst || 16.0);

    // ★【ここを追加】傾向フィルター関連のパラメータを安全に取得
    const isTrendEnabled = !!params.isTrendEnabled;
    const activeTrends = params.activeTrends || [];

    // ★【重要】個人シートの同期状態に依存しないよう、MasterData から最新の傾向マップを作成
    let globalTrendMap = {};
    if (isTrendEnabled && activeTrends.length > 0) {
        try {
            const masterSheet = ss.getSheetByName("MasterData");
            if (masterSheet) {
                const masterData = masterSheet.getDataRange().getValues();
                // MasterDataの構造をループ（1行目がヘッダーと仮定）
                // ※MasterData内の「楽曲名（または 楽曲名 [難易度]）」と「メイン傾向」の列インデックスに合わせて調整してください。
                // ここでは一般的な構造として、A列：曲名、B列：難易度、あるいは結合済みのタイトルを元にマッピングします。
                for (let m = 1; m < masterData.length; m++) {
                    const mRow = masterData[m];
                    if (!mRow || mRow.length < 2) continue;
                    
                    // 例：A列が曲名、B列が難易度、L列(11)付近に傾向がある、もしくは別構造である場合
                    // 他の機能（fetchStatsなど）でMasterDataからタイトルと傾向をどう紐付けているかに合わせます。
                    // ここでは「曲名 [難易度]」をキーにするための一般的なサンプリングを行います。
                    const mSongName = String(mRow[0] || "").trim();
                    const mDiff = String(mRow[1] || "").trim();
                    const mFullTitle = mDiff ? `${mSongName} [${mDiff}]` : mSongName;
                    
                    // 他の機能（fetchStatsなど）のMasterDataのカラム位置が「L列（11番目）」などの場合：
                    // ※もしお使いのMasterDataの傾向列が違う場合は、ここの「11」を変更してください。
                    const mTrend = mRow.length > 9 ? String(mRow[9] || "").trim() : ""; 
                    
                    if (mFullTitle && mTrend) {
                        globalTrendMap[mFullTitle] = mTrend;
                    }
                }
            }
        } catch (err) {
            console.error("MasterDataからの傾向取得に失敗しました:", err);
        }
    }

    const targetPlayers = [myName, ...opponents].filter(p => p !== "");
    
    const allSheets = ss.getSheets();
    const sheetDataMap = {};
    allSheets.forEach(sheet => {
        const sName = sheet.getName();
        if (targetPlayers.includes(sName)) {
            sheetDataMap[sName] = sheet.getDataRange().getValues();
        }
    });

    const songMap = {};

    targetPlayers.forEach(pName => {
        const data = sheetDataMap[pName];
        if (!data) return;

        for (let j = 1; j < data.length; j++) {
            const row = data[j];
            if (!row || row.length < 4) continue;

            const songName = String(row[0] || "不明な曲");
            const diff = String(row[1] || "");
            const cConst = parseFloat(row[2] || 0);
            const cScore = parseFloat(row[3] || 0);

            if (cConst < minC || cConst > maxC) continue;

            const fullTitle = diff ? `${songName} [${diff}]` : songName;

            // ----------------------------------------------------
            // ★【ここを追加】傾向フィルター（トレンド）による絞り込み処理
            // ----------------------------------------------------
            if (isTrendEnabled && activeTrends.length > 0) {
                // まずは個人シートのL列（row[11]）から傾向の取得を試みる
                let songTrend = row.length > 11 ? String(row[11] || "").trim() : "";
                
                // 個人シートに無ければ（未同期プレイヤーなど）、先ほどMasterDataから作った共通マップから補完する
                if (!songTrend && globalTrendMap[fullTitle]) {
                    songTrend = globalTrendMap[fullTitle];
                }
                
                // 取得した傾向が、現在選択されているアクティブな傾向リストに含まれていなければスキップ（除外）
                if (!activeTrends.includes(songTrend)) {
                    continue;
                }
            }
            // ----------------------------------------------------

            if (!songMap[fullTitle]) {
                songMap[fullTitle] = {
                    title: fullTitle,
                    constant: cConst,
                    scores: {} 
                };
            }
            songMap[fullTitle].scores[pName] = cScore;
        }
    });

    const vsRows = [];
    let winCount = 0, drawCount = 0, loseCount = 0;
    let rank1 = 0, rank2 = 0, rank3 = 0, rank4 = 0;

    Object.keys(songMap).forEach(title => {
        const song = songMap[title];
        const allScoresList = targetPlayers.map(p => song.scores[p] || 0);
        if (Math.max(...allScoresList) === 0) return;

        const myScore = song.scores[myName] || 0;

        const scoreRankList = targetPlayers.map(p => {
            return { name: p, score: song.scores[p] || 0 };
        });
        
        scoreRankList.sort((a, b) => b.score - a.score);

        let myRank = 1;
        for (let i = 0; i < scoreRankList.length; i++) {
            if (scoreRankList[i].score > myScore) { myRank++; }
        }

        let matchResult = ""; 
        if (opponents.length === 1) {
            const oppScore = song.scores[opponents[0]] || 0;
            if (myScore > oppScore) { matchResult = "WIN"; winCount++; } 
            else if (myScore === oppScore) { matchResult = "DRAW"; drawCount++; } 
            else { matchResult = "LOSE"; loseCount++; }
        } else {
            if (myRank === 1) rank1++;
            else if (myRank === 2) rank2++;
            else if (myRank === 3) rank3++;
            else if (myRank === 4) rank4++;
        }

        vsRows.push({
            title: song.title,
            constant: song.constant,
            myScore: myScore,
            myRank: myRank,
            matchResult: matchResult,
            rankList: scoreRankList 
        });
    });

    return {
        vsRows: vsRows,
        summary: {
            win: winCount, draw: drawCount, lose: loseCount,
            rank1: rank1, rank2: rank2, rank3: rank3, rank4: rank4
        },
        opponents: opponents,
        myName: myName,
        minConst: minC,
        maxConst: maxC
    };
}

/**
 * 💡 修正版：ユーザーごとのシートを更新する
 * （H〜K列に4つの能力値、さらに【L列にMain Trend】を追加・フロント同期対応版）
 */
function updateUserSheet(ss, name, records) {
    let sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    sheet.clear();

    // 💡 ヘッダーの末尾に "mainTrend" を追加して L列 まで拡張
    const header = ["title", "diff", "const", "score", "rating", "lamp", "isNew", "体力", "鍵盤力", "チュウニズム力", "癖力", "mainTrend"];
    sheet.appendRow(header);

    // 1. MasterDataシートから各楽曲のコスト情報および【Main Trend】を一括取得してマップを作る
    const masterSheet = ss.getSheetByName("MasterData");
    const costMap = {};
    if (masterSheet) {
        const masterData = masterSheet.getDataRange().getValues();
        if (masterData.length > 1) {
            for (let i = 1; i < masterData.length; i++) {
                const mTitle = String(masterData[i][0] || "");
                const mDiff = String(masterData[i][1] || "");
                const key = mTitle + "_" + mDiff;

                costMap[key] = {
                    tairyoku: parseFloat(masterData[i][4] || 0), // 5列目: 体力コスト平均
                    kenban:   parseFloat(masterData[i][5] || 0), // 6列目: 鍵盤コスト平均
                    chuni:    parseFloat(masterData[i][6] || 0), // 7列目: チュウニズム力コスト平均
                    kuse:     parseFloat(masterData[i][7] || 0),  // 8列目: 癖コスト平均
                    // 💡 追加：10列目 (J列) から Main Trend を取得（無ければ "None"）
                    mainTrend: String(masterData[i][9] || "None").trim() 
                };
            }
        }
    }

    // 2. プレイレコードの書き込みデータを作成
    if (records && records.length > 0) {
        records.sort((a, b) => b.rating - a.rating);
        const rows = records.map(r => {
            let cleanTitle = String(r.title || "");
            if (/^0\d+$/.test(cleanTitle)) {
                cleanTitle = "'" + cleanTitle;
            }

            const key = r.title + "_" + r.diff;
            // 💡 マップから対応する曲のデータを取得（未登録なら初期値）
            const songData = costMap[key] || { tairyoku: 0, kenban: 0, chuni: 0, kuse: 0, mainTrend: "None" };

            // スコアとクリアランプ（AJ判定用）を渡して補正値を計算
            const scoreMod = calculateScoreModifier(r.score, r.lamp);

            // 各能力値を算出（コスト × スコア補正）。小数点以下2桁に丸める
            const pTairyoku = Math.round(songData.tairyoku * scoreMod * 100) / 100;
            const pKenban   = Math.round(songData.kenban * scoreMod * 100) / 100;
            const pChuni    = Math.round(songData.chuni * scoreMod * 100) / 100;
            const pKuse     = Math.round(songData.kuse * scoreMod * 100) / 100;

            // 💡 重要：フロントエンド（JavaScript）が動くために、
            // 今ループしているプレイ履歴オブジェクト（r）自体にも「mainTrend」を覚え込ませる
            r.mainTrend = songData.mainTrend;

            return [
                cleanTitle, 
                String(r.diff || ""),
                r.const || 0,
                r.score || 0,
                r.rating || 0,
                String(r.lamp || ""),
                String(r.isNew || ""),
                pTairyoku, // H列
                pKenban,   // I列
                pChuni,    // J列
                pKuse,     // K列
                songData.mainTrend // 💡 L列: ユーザーシート側にも文字を記録として残す
            ];
        });
        sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
    }
}

/**
 * 💡 カスタム補正値計算（100万点未満0.4 / 最終3.0倍 / ②強化・④マイルド版）
 */
function calculateScoreModifier(score, lamp) {
    // 1,000,000点（S）未満は一律 0.4
    if (score < 1000000) return 0.4;
    
    let modifier = 0.0;
    
    // ① 1,000,000 〜 1,005,000点（倍率：0.4 から 0.55 までゆるやかに上昇）
    if (score >= 1000000 && score < 1005000) {
        modifier = 0.4 + (score - 1000000) * (0.15 / 5000);
    }
    // ② 1,005,000 〜 1,007,500点（倍率：0.55 から 1.85 まで【さらに最も激しく】上昇）
    else if (score >= 1005000 && score < 1007500) {
        modifier = 0.55 + (score - 1005000) * (1.3 / 2500);
    }
    // ③ 1,007,500 〜 1,009,000点（倍率：1.85 から 2.39 まで【2番目に激しく】上昇）
    else if (score >= 1007500 && score < 1009000) {
        modifier = 1.85 + (score - 1007500) * (0.54 / 1500);
    }
    // ④ 1,009,000 〜 1,010,000点（倍率：2.39 から 2.65 まで上昇、傾きを少しマイルドに減少）
    // 💡 最終3.0倍(AJ込み)の帳尻を合わせるため、この区間の計算結果に調整値(+0.25)を加算しています
    else {
        modifier = 2.39 + (score - 1009000) * (0.26 / 1000) + 0.25;
    }
    
    // ⑤ ＋AJ（All Justice / AJC含む）の時にボーナス（+0.10倍）を与える
    // 理論値（1,010,000点）の時は、2.65 + 0.25(上記) + 0.10 = ぴったり3.0倍になります
    const currentLamp = String(lamp || "");
    if (currentLamp.includes("AJ") || currentLamp.includes("AJC")) {
        modifier += 0.10;
    }
    
    return modifier;
}

function fetchAndProcessFromApi(token, ss) {
    const newSongsSheet = ss.getSheetByName("NewSongs");
    const newSongsMap = {};
    if (newSongsSheet) {
        const data = newSongsSheet.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
            if (data[i][0] && data[i][1]) {
                newSongsMap[data[i][0] + "_" + data[i][1]] = parseFloat(data[i][2]);
            }
        }
    }

    const apiUrl = `https://api.chunirec.net/2.0/records/showall.json?token=${token}&region=jp2`;
    const res = UrlFetchApp.fetch(apiUrl, { "muteHttpExceptions": true });
    const responseCode = res.getResponseCode();

    if (responseCode !== 200) {
        throw new Error("chunirec API接続失敗 (Status: " + responseCode + ")。");
    }

    const json = JSON.parse(res.getContentText());
    if (!json.records) {
        throw new Error("API取得失敗: レコードが見つが見つかりません。");
    }

    return json.records.map(r => {
        const key = r.title + "_" + r.diff;
        const isNewSong = newSongsMap[key] !== undefined;
        let c = isNewSong ? newSongsMap[key] : parseFloat(r.const);
        let lamp = r.score >= 1010000 ? "AJC" : r.is_alljustice ? "AJ" : r.is_fullcombo ? "FC" : "";
        return {
            title: r.title,
            diff: r.diff,
            const: c,
            score: r.score,
            rating: calculateChuniRating(r.score, c),
            lamp: lamp,
            isNew: isNewSong
        };
    }).filter(r => r.const >= 13.5 || r.const === 0);
}

function calculateChuniRating(score, constant) {
    if (constant <= 0) return 0;
    if (score >= 1009000) return constant + 2.15;
    if (score >= 1007500) return constant + 2.0 + (score - 1007500) * 0.01 / 100;
    if (score >= 1005000) return constant + 1.5 + (score - 1005000) * 0.01 / 50;
    if (score >= 1000000) return constant + 1.0 + (score - 1000000) * 0.01 / 100;
    if (score >= 990000) return constant + 0.6 + (score - 990000) * 0.01 / 250;
    if (score >= 975000) return constant + 0.0 + (score - 975000) * 0.6 / 15000;
    if (score >= 950000) return constant - 1.67 + (score - 950000) * 0.01 / 150;
    if (score >= 925000) return constant - 3.34 + (score - 925000) * 1.67 / 25000;
    if (score >= 900000) return constant - 5.0 + (score - 900000) * 1.66 / 25000;
    return 0; 
}

function createJsonResponse(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj))
        .setMimeType(ContentService.MimeType.JSON);
}

/**
 * ==========================================================================
 * 【追加機能】譜面傾向アンケートツールからMasterDataを同期する
 * ==========================================================================
 */

function syncMasterData() {
  // 💡 【重要】アンケートツールのスプレッドシートIDをここに貼り付けてください
  // URLの「https://docs.google.com/spreadsheets/d/ ○○○○ /edit」の○○○○の部分です
  const SOURCE_SPREADSHEET_ID = "1q-3deFNdWKTvscb8aKTGygXQt_PlvnpVLE3Iz40xZwo";
  
  const SOURCE_SHEET_NAME = "MasterData"; // アンケートツール側のシート名（もし違う場合は変更してください）
  const TARGET_SHEET_NAME = "MasterData"; // スコア管理ツール側のシート名
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let logSheet = ss.getSheetByName("DebugLog") || ss.insertSheet("DebugLog");
  
  try {
    // 1. アンケートツール側のスプレッドシートを開く
    const sourceSs = SpreadsheetApp.openById(SOURCE_SPREADSHEET_ID);
    const sourceSheet = sourceSs.getSheetByName(SOURCE_SHEET_NAME);
    if (!sourceSheet) {
      throw new Error("コピー元のシート「" + SOURCE_SHEET_NAME + "」が見つかりません。");
    }
    
    // 2. データの取得
    const sourceData = sourceSheet.getDataRange().getValues();
    if (sourceData.length <= 1) {
      throw new Error("コピー元のデータが空、またはヘッダーしかありません。");
    }
    
    // 3. スコア管理ツール側のMasterDataシートを取得
    let targetSheet = ss.getSheetByName(TARGET_SHEET_NAME) || ss.insertSheet(TARGET_SHEET_NAME);
    
    // 4. 古いマスタをクリアして、新しいマスタを一括書き込み
    targetSheet.clear();
    targetSheet.getRange(1, 1, sourceData.length, sourceData[0].length).setValues(sourceData);
    
    logSheet.appendRow([new Date(), "INFO", "MasterDataの同期に成功しました。総行数: " + sourceData.length]);
    
  } catch (error) {
    logSheet.appendRow([new Date(), "ERROR", "MasterData同期失敗: " + String(error.message || error)]);
    throw error; // トリガー実行時にもエラーが通知されるように再スロー
  }
}

/**
 * スプレッドシートを開いたときに、手動実行用のカスタムメニューを追加する
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🛠️ 管理者メニュー')
    .addItem('最新のMasterDataを同期（アンケートツールから）', 'syncMasterData')
    .addToUi();
}