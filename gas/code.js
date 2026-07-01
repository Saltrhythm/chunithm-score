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

        // 2. 統計取得モード
        if (mode === "get_stats") {
            const results = getStatsFromSheets(ss, params);
            return createJsonResponse({ status: "success", data: results });
        }

        // 3. 特定のプレイヤーの全プレイデータ取得
        if (mode === "get_player_detail") {
            const playerName = String(params.playerName || "");
            const results = getPlayerDetailFromSheet(ss, playerName, params);
            return createJsonResponse({ status: "success", data: results });
        }

        // VS機能 プレイヤー一覧取得モード
        if (mode === "get_vs_players") {
            const sheets = ss.getSheets();
            const playerNames = sheets.map(s => s.getName()).filter(name =>
                name !== "UserMap" && name !== "MasterData" && name !== "DebugLog" && name !== "NewSongs" && name !== "マスター" && name !== "設定"
            );
            return createJsonResponse({ status: "success", players: playerNames });
        }

        // VS機能 スコア比較データ取得モード
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

                // 認証トークンのハッシュ化処理
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

                // 💡【修正】プレイヤー名が確定したこのタイミングで、playerNameを第3引数に渡して実行！
                // これにより、API停止時でも playerName のシートから既存データを安全に救出できます。
                const records = fetchAndProcessFromApi(token, ss, playerName);

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
 * 💡 修正版：ランキング取得ロジック（MasterData定数リアルタイム参照＆付与版）
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

    // 💡 トレンドフィルターの有無に関わらず、MasterDataから最新定数とMainTrendを事前に取得する
    let songConst = 0;
    let songMainTrend = "None";

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

            for (let i = 1; i < masterData.length; i++) {
                if (normalize(masterData[i][titleIdx]) === targetTitle && normalize(masterData[i][diffIdx]) === targetDiff) {
                    // 💡 C列（インデックス2）から最新の定数を取得
                    songConst = parseFloat(masterData[i][2] || 0);
                    songMainTrend = String(masterData[i][mainIdx] || "").toUpperCase().trim();
                    break;
                }
            }
        }
    }

    // 💡 事前に取得したMainTrendを元に、選択されているトレンド配列に含まれているか一発で判定
    if (isTrendEnabled && activeTrends.length > 0) {
        if (!activeTrends.includes(songMainTrend)) {
            return []; // トレンドが一致しない場合は即座に空配列を返す
        }
    }

    const allSheets = ss.getSheets();
    const sheetDataMap = {};
    allSheets.forEach(sheet => {
        const sName = sheet.getName();
        // 不要なシステムシートを除外
        if (sName !== "UserMap" && sName !== "MasterData" && sName !== "DebugLog" && sName !== "NewSongs" && sName !== "マスター" && sName !== "設定") {
            sheetDataMap[sName] = sheet.getDataRange().getValues();
        }
    });

    for (let i = 1; i < userMap.length; i++) {
        const name = String(userMap[i][1] || "");
        if (!name) continue;

        const data = sheetDataMap[name];
        if (!data) {
            // 💡 返却データに constant を追加
            results.push({ playerName: name, score: "-", lamp: "-", constant: songConst });
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
            // 💡 返却データに constant を追加
            results.push({ playerName: name, score: scoreVal, lamp: lampVal, constant: songConst });
        } else {
            // 💡 返却データに constant を追加
            results.push({ playerName: name, score: "-", lamp: "-", constant: songConst });
        }
    }

    return results.sort((a, b) => {
        const sA = (a.score === "-" || !a.score) ? -1 : parseFloat(a.score);
        const sB = (b.score === "-" || !b.score) ? -1 : parseFloat(b.score);
        return sB - sA;
    });
}

/**
 * 💡 修正版：MasterDataから特定の楽曲のプロパティを取得する（定数追加版）
 */
function getSongPropsFromMaster(ss, title, diff) {
    // 💡 デフォルトの戻り値オブジェクトに constant: 0 を追加
    const defaultProps = { constant: 0, tairyoku: 0, kenban: 0, chuni: 0, kuse: 0, mainTrend: "None", subTrend: "None" };
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
                // 💡 C列（インデックス2）から最新の譜面定数を取得して追加
                constant: parseFloat(data[i][2]) || 0,
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
 * 統計情報を取得（MasterData定数リアルタイム参照 ＆ 99万未満除外平均スコア版）
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
    // 💡 トレンドと最新定数を一括で保持するためのキャッシュオブジェクト
    const masterDataCache = {};
    let totalMatchingSongs = 0;

    // 💡 定数はC列（インデックス2）、isNewはD列（インデックス3）で固定
    const targetConstIdx = 2;
    const targetIsNewIdx = 3;

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

                const cConst = parseFloat(mRow[targetConstIdx] || 0);
                const isNewStr = String(mRow[targetIsNewIdx] || "").toLowerCase().trim();
                const mMain = String(mRow[mainIdx] || "").toUpperCase().trim();

                // 💡 キャッシュに「最新定数」と「トレンド」を一緒に保存
                masterDataCache[mFullKey] = {
                    constant: cConst,
                    mainTrend: mMain
                };

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

        // 💡 個人用の「99万以上の合計スコア」と「その曲数」の受け皿を追加
        let playerValidScoreSum = 0;
        let playerValidScoreCount = 0;

        for (let j = 1; j < data.length; j++) {
            const row = data[j];
            if (!row || row.length < 7) continue;

            const songName = String(row[0] || "不明な曲");
            const diff = String(row[1] || "");
            const fullTitleKey = diff ? `${songName.trim()}_${diff.trim()}` : songName.trim();

            // 💡 プレイヤーシートの値ではなく、MasterDataのキャッシュから定数とトレンドをリアルタイムに引き出す
            const masterInfo = masterDataCache[fullTitleKey] || { constant: parseFloat(row[2] || 0), mainTrend: "None" };
            const cConst = masterInfo.constant;

            if (cConst < minC || cConst > maxC) continue;

            if (isTrendEnabled && activeTrends.length > 0) {
                const songMainTrend = masterInfo.mainTrend;
                if (!songMainTrend) continue;
                if (!activeTrends.includes(songMainTrend)) continue;
            }

            const cScore = parseFloat(row[3] || 0);
            const cRating = parseFloat(row[4] || 0);
            const cLamp = String(row[5] || "");
            const isNewSongStr = String(row[6] || "").toLowerCase().trim();

            const fullTitleDisplay = diff ? `${songName} [${diff}]` : songName;

            // 💡 楽曲用オブジェクトに「99万以上の合計スコア」と「その人数」の受け皿を追加
            if (!songAggregation[fullTitleDisplay]) {
                songAggregation[fullTitleDisplay] = {
                    count: 0, constant: cConst, players: [],
                    totalScoreAll: 0, totalCountAll: 0,
                    validScoreSum: 0,
                    validScoreCount: 0
                };
            }
            songAggregation[fullTitleDisplay].totalScoreAll += cScore;
            songAggregation[fullTitleDisplay].totalCountAll++;

            // 💡 楽曲別で990,000点以上の場合のみ、平均スコア用カウンターに加算
            if (cScore >= 990000) {
                songAggregation[fullTitleDisplay].validScoreSum += cScore;
                songAggregation[fullTitleDisplay].validScoreCount++;
            }

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

                // 💡 個人別で990,000点以上の場合のみ、平均スコア用カウンターに加算
                if (cScore >= 990000) {
                    playerValidScoreSum += cScore;
                    playerValidScoreCount++;
                }

                if (isAchieved) {
                    playerCountFiltered++;
                }
            }
        }

        results.push({
            playerName: name,
            count: playerCountFiltered,
            allPlayCount: playerTotalCountFiltered,
            // 💡 個人別平均スコアを99万以上のデータのみで算出
            avgScore: playerValidScoreCount > 0 ? Math.round(playerValidScoreSum / playerValidScoreCount) : 0
        });
    }

    const songRanking = Object.keys(songAggregation).map(t => {
        const data = songAggregation[t];
        return {
            title: t, count: data.count, constant: data.constant, players: data.players,
            // 💡 楽曲別平均スコアを99万以上のデータのみで算出
            avgScore: data.validScoreCount > 0 ? Math.round(data.validScoreSum / data.validScoreCount) : 0,
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
 * 💡 修正版：特定のプレイヤーの詳細データを取得する（MasterData定数リアルタイム参照版）
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
    // 💡 トレンドと最新定数を一括で保持するためのキャッシュオブジェクト
    const masterDataCache = {};

    // 💡 定数はC列（インデックス2）で固定
    const targetConstIdx = 2;

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

                // 💡 キャッシュに「最新定数」と「トレンド」をセットで保存
                masterDataCache[mFullKey] = {
                    constant: parseFloat(mRow[targetConstIdx] || 0),
                    mainTrend: String(mRow[mainIdx] || "").toUpperCase().trim()
                };
            }
        }
    }

    for (let j = 1; j < data.length; j++) {
        const row = data[j];
        if (!row || row.length < 7) continue;

        // 💡 順番変更：キャッシュを引くために、先に曲名と難易度を取得
        const songName = String(row[0] || "");
        const diff = String(row[1] || "");
        const fullTitleKey = diff ? `${songName.trim()}_${diff.trim()}` : songName.trim();

        // 💡 プレイヤーシートの値ではなく、MasterDataのキャッシュから定数とトレンドをリアルタイムに引き出す
        const masterInfo = masterDataCache[fullTitleKey] || { constant: parseFloat(row[2] || 0), mainTrend: "None" };
        const cConst = masterInfo.constant; // ★常にMasterData基準の定数になる！

        // 💡 最新化された定数（cConst）で範囲フィルターを通す
        if (cConst < minC || cConst > maxC) continue;

        if (isTrendEnabled && activeTrends.length > 0) {
            const songMainTrend = masterInfo.mainTrend; // ★キャッシュから取得
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
            isAchieved: isAchieved,
            constant: cConst // 💡 フロント（JS）側でも最新定数を使えるように、念のためプロパティに含めて返却
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
 * 💡 修正版：VS機能 スコア比較データ取得モード（MasterData定数＆トレンドリアルタイム参照版）
 */
function getVsDataFromSheets(ss, params) {
    const myName = String(params.myName || "").trim();
    const opponents = params.opponents || [];
    const minC = parseFloat(params.minConst || 13.5);
    const maxC = parseFloat(params.maxConst || 16.0);

    const isTrendEnabled = !!params.isTrendEnabled;
    const rawTrends = params.activeTrends || [];
    const activeTrends = rawTrends.map(t => String(t).toUpperCase().trim());

    // 💡 トレンドと最新定数を一括で保持するためのキャッシュオブジェクト
    const masterDataCache = {};

    // 💡 定数はC列（インデックス2）で固定
    const targetConstIdx = 2;

    try {
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

                for (let m = 1; m < masterData.length; m++) {
                    const mRow = masterData[m];
                    if (!mRow) continue;

                    const mSongName = String(mRow[titleIdx] || "").trim();
                    const mDiff = String(mRow[diffIdx] || "").trim();
                    // この関数内で使用されるキー「曲名 [難易度]」の形式に統一
                    const mFullTitle = mDiff ? `${mSongName} [${mDiff}]` : mSongName;

                    const cConst = parseFloat(mRow[targetConstIdx] || 0);
                    const mTrend = String(mRow[mainIdx] || "").toUpperCase().trim();

                    if (mFullTitle) {
                        masterDataCache[mFullTitle] = {
                            constant: cConst,
                            mainTrend: mTrend
                        };
                    }
                }
            }
        }
    } catch (err) {
        console.error("MasterDataからのデータ取得に失敗しました:", err);
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
            const fullTitle = diff ? `${songName} [${diff}]` : songName;

            // 💡 プレイヤーシートの値ではなく、MasterDataのキャッシュから定数とトレンドをリアルタイムに引き出す
            const masterInfo = masterDataCache[fullTitle] || { constant: parseFloat(row[2] || 0), mainTrend: "None" };
            const cConst = masterInfo.constant; // ★常にMasterData基準の定数になる！

            // 💡 最新化された定数（cConst）で範囲フィルターを最優先で判定
            if (cConst < minC || cConst > maxC) continue;

            // 💡 傾向フィルターも個人シートの列（row[11]）を見に行かず、MasterData基準で完全に判定
            if (isTrendEnabled && activeTrends.length > 0) {
                const songTrend = masterInfo.mainTrend;
                if (!songTrend || !activeTrends.includes(songTrend)) {
                    continue;
                }
            }

            const cScore = parseFloat(row[3] || 0);

            if (!songMap[fullTitle]) {
                songMap[fullTitle] = {
                    title: fullTitle,
                    constant: cConst, // 💡 最新の定数をVS行データに格納
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
 * 💡 修正版：ユーザーごとのシートを更新する（二重処理を撤廃し超高速・安全化）
 */
function updateUserSheet(ss, name, records) {
    let sheet = ss.getSheetByName(name) || ss.insertSheet(name);

    // 💡 安全対策: データ書き込み用の配列を先に用意し、準備万端になってから clear() する
    const header = ["title", "diff", "const", "score", "rating", "lamp", "isNew", "体力", "鍵盤力", "チュウニズム力", "癖力", "mainTrend"];
    let rows = [];

    if (records && records.length > 0) {
        // レーティングの降順にソート
        records.sort((a, b) => b.rating - a.rating);

        rows = records.map(r => {
            let cleanTitle = String(r.title || "");
            if (/^0\d+$/.test(cleanTitle)) {
                cleanTitle = "'" + cleanTitle;
            }

            // 💡【重要】定数、コスト能力値、MainTrendの計算・取得は、
            // すべて手前の「fetchAndProcessFromApi」側でMasterData基準で計算し尽くされて
            // オブジェクト(r)内に格納されているため、ここではそのまま配列に入れるだけで100%正確に動きます！

            // 念のため、手前で追加されたコスト能力値（r.tairyoku等）があれば流用、なければ0
            const pTairyoku = r.tairyoku || 0;
            const pKenban = r.kenban || 0;
            const pChuni = r.chuni || 0;
            const pKuse = r.kuse || 0;

            return [
                cleanTitle,
                String(r.diff || ""),
                r.const || 0,        // MasterDataの最新定数（fetchAndProcessFromApiで上書き済）
                r.score || 0,
                r.rating || 0,       // 最新定数で再計算された正しいRating
                String(r.lamp || ""),
                String(r.isNew || ""),
                pTairyoku,           // H列
                pKenban,             // I列
                pChuni,              // J列
                pKuse,               // K列
                String(r.mainTrend || "None") // L列（fetchAndProcessFromApiで上書き済）
            ];
        });
    }

    // 💡 ここで初めてシートをクリアして、一気に書き込む（データ消失バグを完全に回避）
    sheet.clear();
    sheet.appendRow(header);

    if (rows.length > 0) {
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

/**
 * 💡 改良版：APIからレコードを取得し、MasterDataの最新定数を適用して処理する
 * （chunirec API停止時でも、個人シートの既存スコアをベースに最新定数での再計算を実行可能）
 */
function fetchAndProcessFromApi(token, ss, playerName) {
    // 1. MasterDataから最新の定数と新曲フラグ(isNew)をキャッシュする
    const masterSheet = ss.getSheetByName("MasterData");
    const masterDataCache = {};

    const targetConstIdx = 2; // C列：定数
    const targetIsNewIdx = 3;  // D列：isNew

    if (masterSheet) {
        const masterData = masterSheet.getDataRange().getValues();
        if (masterData.length > 1) {
            const headerRow = masterData[0].map(h => String(h).toLowerCase().trim());
            const titleIdx = headerRow.findIndex(h => h.includes("title") || h.includes("曲名")) !== -1 ? headerRow.findIndex(h => h.includes("title") || h.includes("曲名")) : 0;
            const diffIdx = headerRow.findIndex(h => h.includes("diff") || h.includes("難易度")) !== -1 ? headerRow.findIndex(h => h.includes("diff") || h.includes("難易度")) : 1;

            for (let i = 1; i < masterData.length; i++) {
                const mRow = masterData[i];
                const mTitle = String(mRow[titleIdx] || "");
                const mDiff = String(mRow[diffIdx] || "");
                const mFullKey = mDiff ? `${mTitle.trim()}_${mDiff.trim()}` : mTitle.trim();

                const cConst = parseFloat(mRow[targetConstIdx] || 0);
                const isNewStr = String(mRow[targetIsNewIdx] || "").toLowerCase().trim();

                masterDataCache[mFullKey] = {
                    constant: cConst,
                    isNew: (isNewStr === "true")
                };
            }
        }
    }

    // --- 💡 ここからAPI通信とエラーハンドリングの改良 ---
    const apiUrl = `https://api.chunirec.net/2.0/records/showall.json?token=${token}&region=jp2`;
    let apiRecords = null;
    let isApiAvailable = true;

    try {
        const res = UrlFetchApp.fetch(apiUrl, { "muteHttpExceptions": true });
        const responseCode = res.getResponseCode();

        if (responseCode === 200) {
            const json = JSON.parse(res.getContentText());
            if (json.records) {
                apiRecords = json.records;
            }
        }
    } catch (e) {
        console.warn("API取得中に例外が発生しました（停止中の可能性あり）: " + e.toString());
    }

    // 💡【重要】APIからデータが取れなかった場合、個人シートの既存データをベースにする（フォールバック）
    if (!apiRecords || apiRecords.length === 0) {
        console.log("⚠️ chunirec APIが利用できないか停止しています。個人シートの既存データから再計算モードに移行します。");
        isApiAvailable = false;

        const userSheet = ss.getSheetByName(playerName);
        if (!userSheet) {
            throw new Error("API接続に失敗し、かつ個人シートも見つからないため処理を中断しました。");
        }

        // 個人シートのデータを読み込んで、APIから降ってきたデータと同じ構造（疑似レコード）に変換する
        const userValues = userSheet.getDataRange().getValues();
        if (userValues.length > 1) {
            apiRecords = [];
            // 個人シートのヘッダー（曲名、難易度、スコア、ランプ等）のインデックスを自動検出
            const uHeader = userValues[0].map(h => String(h).toLowerCase().trim());
            const uTitleIdx = uHeader.findIndex(h => h.includes("title") || h.includes("曲名"));
            const uDiffIdx = uHeader.findIndex(h => h.includes("diff") || h.includes("難易度"));
            const uScoreIdx = uHeader.findIndex(h => h.includes("score") || h.includes("スコア"));
            const uLampIdx = uHeader.findIndex(h => h.includes("lamp") || h.includes("ランプ"));

            for (let i = 1; i < userValues.length; i++) {
                const uRow = userValues[i];
                if (!uRow[uTitleIdx]) continue;

                // 疑似的なAPIレコード構造を作成
                apiRecords.push({
                    title: String(uRow[uTitleIdx]),
                    diff: String(uRow[uDiffIdx] || "MAS"),
                    score: parseFloat(uRow[uScoreIdx]) || 0,
                    lamp: String(uRow[uLampIdx] || "")
                });
            }
        } else {
            throw new Error("APIが停止しており、個人シートにもデータが存在しないため再計算できません。");
        }
    }

    // 3. データのマッピングと、MasterDataの最新定数によるRating再計算
    const processedRecords = apiRecords.map(r => {
        const key = r.title + "_" + r.diff;

        // MasterDataCacheから最新情報を引き出す（なければ0）
        const masterInfo = masterDataCache[key] || { constant: parseFloat(r.const || 0), isNew: false };
        const c = masterInfo.constant;
        const isNewSong = masterInfo.isNew;

        // APIから取ってきたデータならランプを自動算出、個人シートから復元したデータなら既存のランプを流用
        let lamp = "";
        if (isApiAvailable) {
            lamp = r.score >= 1010000 ? "AJC" : r.is_alljustice ? "AJ" : r.is_fullcombo ? "FC" : "";
        } else {
            lamp = r.lamp || ""; // 個人シートのランプをそのまま保持
        }

        return {
            title: r.title,
            diff: r.diff,
            const: c,                                    // 💡 MasterDataの最新定数
            score: r.score,                              // 💡 スコアは維持
            rating: calculateChuniRating(r.score, c),    // 💡 最新定数ベースで内部レーティングを再計算！
            lamp: lamp,
            isNew: isNewSong                             // 💡 MasterData基準の新曲フラグ
        };
    }).filter(r => r.const >= 13.5 || r.const === 0);

    return processedRecords;
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