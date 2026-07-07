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

        // 💡【新設】手元動画リクエスト・アップロードの履歴取得（最新30件ずつ）
        if (mode === "get_video_history") {
            const history = getVideoHistory(ss);
            return createJsonResponse({ status: "success", data: history });
        }

        // 💡【修正】新規リクエストの投稿（備考 params.comment を追加）
        if (mode === "add_video_request") {
            const res = addVideoRequestRow(ss, params.id, params.title, params.diff, params.requester, params.comment);
            return createJsonResponse(res);
        }

        // 💡【新設】動画アップロード（供給）の投稿（新規 ＆ 編集上書き対応）
        if (mode === "add_video_supply") {
            // params.id があれば編集、なければ新規
            const res = addVideoSupplyRow(ss, params.id, params.title, params.diff, params.contributor, params.videoUrl, params.videoTitle);
            return createJsonResponse(res);
        }

        // 💡【新設】投稿の削除モード（リクエスト/アップロード共通）
        if (mode === "delete_video_item") {
            const res = deleteVideoItemRow(ss, params.id, params.playerName);
            return createJsonResponse(res);
        }

        // 1. ランキング取得モード
        if (mode === "get_ranking") {
            const t = String(params.title || "");
            const d = String(params.diff || "");
            const results = getRankingFromSheets(ss, t, d, params, logSheet);
            const songProps = getSongPropsFromMaster(ss, t, d); 
            const videoList = getVideosForSong(ss, t, d);
            
            return createJsonResponse({ status: "success", data: results, songProps: songProps, videoList: videoList });
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
 * 💡 決定版：統計情報を取得（WEのみ平均スコア集計対象を90万点以上に緩和版）
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

    // フロントから渡された難易度フィルター（配列形式）を取得
    const diffFilter = Array.isArray(params.diffFilter) ? params.diffFilter.map(d => String(d).toUpperCase().trim()) : [];

    const isTrendEnabled = !!(params.trendEnable !== undefined ? params.trendEnable : params.isTrendEnabled);
    const rawTrends = Array.isArray(params.trends) ? params.trends : (Array.isArray(params.activeTrends) ? params.activeTrends : []);
    const activeTrends = rawTrends.map(t => String(t).toUpperCase().trim());

    const masterSheet = ss.getSheetByName("MasterData");
    const masterDataCache = {}; 
    
    // 重複・空白を許さず、純粋な対象曲数だけを正確に数えるための名簿 (Set)
    const uniqueMatchingSongs = new Set();

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
                
                const mTitle = String(mRow[titleIdx] || "").trim();
                let mDiff = String(mRow[diffIdx] || "").toUpperCase().trim();
                
                // 💡【WE表記の統一ガード】WORLD'S END 系の表記をすべて "WE" にマッピング
                if (mDiff.includes("WORLD") || mDiff === "WE") {
                    mDiff = "WE";
                }
                
                if (!mTitle || !mDiff || mRow[targetConstIdx] === "") {
                    continue; 
                }

                // MasterDataの難易度自体が、選択された難易度に無ければ除外
                if (diffFilter.length > 0 && !diffFilter.includes(mDiff)) {
                    continue;
                }

                const mFullKey = `${mTitle}_${mDiff}`;
                const cConst = parseFloat(mRow[targetConstIdx] || 0);
                const isNewStr = String(mRow[targetIsNewIdx] || "").toLowerCase().trim();
                const mMain = String(mRow[mainIdx] || "").toUpperCase().trim();

                masterDataCache[mFullKey] = {
                    constant: cConst,
                    mainTrend: mMain,
                    diff: mDiff // フロントへのバッジ返却用
                };

                // 💡 WE楽曲の場合は定数チェックをスキップして通過させる（定数がないため）
                const isPassConstant = (mDiff === "WE") || (cConst >= minC && cConst <= maxC);

                if (isPassConstant) {
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
                            uniqueMatchingSongs.add(mFullKey);
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

    // プレイヤーごとの集計処理
    for (let i = 1; i < userMap.length; i++) {
        const name = String(userMap[i][1] || "");
        const data = sheetDataMap[name];
        if (!data) continue;

        let playerCountFiltered = 0;
        let playerTotalScoreFiltered = 0;
        let playerTotalCountFiltered = 0;
        
        let playerValidScoreSum = 0;
        let playerValidScoreCount = 0;

        for (let j = 1; j < data.length; j++) {
            const row = data[j];
            if (!row || row.length < 7) continue;

            const songName = String(row[0] || "不明な曲");
            let diff = String(row[1] || "").toUpperCase().trim();
            
            // 【WE表記の統一ガード】ユーザー個別個人シート側の難易度も "WE" にマッピング
            if (diff.includes("WORLD") || diff === "WE") {
                diff = "WE";
            }

            // 個人のスコア行の難易度が、選択された難易度に無ければスキップ
            if (diffFilter.length > 0 && !diffFilter.includes(diff)) {
                continue;
            }

            const fullTitleKey = diff ? `${songName.trim()}_${diff.trim()}` : songName.trim();

            const masterInfo = masterDataCache[fullTitleKey] || { constant: parseFloat(row[2] || 0), mainTrend: "None", diff: diff };
            const cConst = masterInfo.constant; 

            // 💡 WE楽曲以外（通常曲）のときだけ定数フィルターを適用する
            if (diff !== "WE" && (cConst < minC || cConst > maxC)) {
                continue;
            }

            if (isTrendEnabled && activeTrends.length > 0) {
                const songMainTrend = masterInfo.mainTrend;
                if (!songMainTrend) continue; 
                if (!activeTrends.includes(songMainTrend)) continue; 
            }

            const cScore = parseFloat(row[3] || 0);
            const cRating = parseFloat(row[4] || 0);
            const cLamp = String(row[5] || "");
            const isNewSongStr = String(row[6] || "").toLowerCase().trim();

            const fullTitleDisplay = songName; 

            if (!songAggregation[fullTitleDisplay]) {
                songAggregation[fullTitleDisplay] = {
                    count: 0, 
                    constant: cConst, 
                    diff: masterInfo.diff || diff, 
                    players: [],
                    totalScoreAll: 0, 
                    totalCountAll: 0,
                    validScoreSum: 0,  
                    validScoreCount: 0 
                };
            }
            songAggregation[fullTitleDisplay].totalScoreAll += cScore;
            songAggregation[fullTitleDisplay].totalCountAll++;

            // 💡【重要修正】難易度に応じて平均スコア用の最低カットラインを動的に変更
            // WEの場合は90万点、それ以外の通常曲の場合は99万点
            const scoreCutoff = (diff === "WE") ? 900000 : 990000;
            if (cScore >= scoreCutoff) {
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
                
                // 💡 個人別統計（平均スコア）の算出時にも同様のカットライン条件を適用
                if (cScore >= scoreCutoff) {
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
            // 💡 個人側の分母（全プレイ曲数）も、カットラインを満たした有効なプレイ数に同期させます
            allPlayCount: playerValidScoreCount,
            avgScore: playerValidScoreCount > 0 ? Math.round(playerValidScoreSum / playerValidScoreCount) : 0
        });
    }

    // 楽曲別ランキングの作成
    const songRanking = Object.keys(songAggregation).map(t => {
        const data = songAggregation[t];
        return {
            title: t, 
            count: data.count, 
            constant: data.constant, 
            diff: data.diff, 
            players: data.players,
            avgScore: data.validScoreCount > 0 ? Math.round(data.validScoreSum / data.validScoreCount) : 0,
            // 💡 楽曲側の分母（全プレイ人数）も、カットラインを満たした有効な人数に同期させます
            totalCountAll: data.validScoreCount || 0
        };
    });

    return {
        playerRanking: results,
        songRanking: songRanking,
        theoryCount: uniqueMatchingSongs.size, 
        totalUsers: userMap.length - 1
    };
}

/**
 * 💡 修正版：特定のプレイヤーの詳細データを取得する（難易度マルチ・WE定数スルー対応版）
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

    // 💡 フロントから渡された難易度フィルター（配列形式）を取得
    const diffFilter = Array.isArray(params.diffFilter) ? params.diffFilter.map(d => String(d).toUpperCase().trim()) : [];

    const isTrendEnabled = !!(params.trendEnable !== undefined ? params.trendEnable : params.isTrendEnabled);
    const rawTrends = Array.isArray(params.trends) ? params.trends : (Array.isArray(params.activeTrends) ? params.activeTrends : []);
    const activeTrends = rawTrends.map(t => String(t).toUpperCase().trim());

    const masterSheet = ss.getSheetByName("MasterData");
    const masterDataCache = {}; 
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
                const mTitle = String(mRow[titleIdx] || "").trim();
                let mDiff = String(mRow[diffIdx] || "").toUpperCase().trim();

                // 💡【WE表記の統一ガード】
                if (mDiff.includes("WORLD") || mDiff === "WE") mDiff = "WE";

                const mFullKey = mDiff ? `${mTitle}_${mDiff}` : mTitle;

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

        const songName = String(row[0] || "").trim();
        let diff = String(row[1] || "").toUpperCase().trim();

        // 💡【WE表記の統一ガード】
        if (diff.includes("WORLD") || diff === "WE") diff = "WE";

        // 💡【追加】選択された難易度配列に含まれていない難易度ならスキップ
        if (diffFilter.length > 0 && !diffFilter.includes(diff)) {
            continue;
        }

        const fullTitleKey = diff ? `${songName}_${diff}` : songName;
        const masterInfo = masterDataCache[fullTitleKey] || { constant: parseFloat(row[2] || 0), mainTrend: "None" };
        const cConst = masterInfo.constant; 

        // 💡 WE楽曲以外（通常曲）のときだけ定数フィルターを適用する
        if (diff !== "WE" && (cConst < minC || cConst > maxC)) {
            continue;
        }

        if (isTrendEnabled && activeTrends.length > 0) {
            const songMainTrend = masterInfo.mainTrend;
            if (!songMainTrend || !activeTrends.includes(songMainTrend)) continue; 
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
            constant: cConst 
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
 * 💡 修正統合版：VS機能 スコア比較データ取得モード（WE定数免除＆リアルタイム参照完全版）
 */
function getVsDataFromSheets(ss, params) {
    const myName = String(params.myName || "").trim();
    const opponents = params.opponents || []; 
    const minC = parseFloat(params.minConst || 13.5);
    const maxC = parseFloat(params.maxConst || 16.0);

    const isTrendEnabled = !!params.isTrendEnabled;
    const rawTrends = params.activeTrends || [];
    const activeTrends = rawTrends.map(t => String(t).toUpperCase().trim());

    // 💡 フロントエンドから送られてきた難易度フィルター配列を取得して大文字・トリミング統一
    const rawDiffs = params.diffFilter || [];
    const activeDiffs = rawDiffs.map(d => String(d).toUpperCase().trim());

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
                    const mDiff = String(mRow[diffIdx] || "").toUpperCase().trim(); // 大文字で統一
                    // この関数内で使用されるキー「曲名 [難易度]」の形式に統一
                    const mFullTitle = mDiff ? `${mSongName} [${mDiff}]` : mSongName;
                    
                    const cConst = parseFloat(mRow[targetConstIdx] || 0);
                    const mTrend = String(mRow[mainIdx] || "").toUpperCase().trim();
                    
                    if (mFullTitle) {
                        masterDataCache[mFullTitle] = {
                            constant: cConst,
                            mainTrend: mTrend,
                            difficulty: mDiff // 💡 キャッシュに元データの難易度を保持
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
            const diff = String(row[1] || "").toUpperCase().trim(); // 大文字で統一
            const fullTitle = diff ? `${songName} [${diff}]` : songName;

            // 💡 プレイヤーシートの値ではなく、MasterDataのキャッシュから諸情報をリアルタイムに引き出す
            const masterInfo = masterDataCache[fullTitle] || { constant: parseFloat(row[2] || 0), mainTrend: "None", difficulty: diff };
            const cConst = masterInfo.constant; 
            const songDiff = masterInfo.difficulty;

            // 💡 【修正点1】難易度マルチ選択のフィルター判定を「最優先」に引き上げる
            if (activeDiffs.length > 0) {
                if (!songDiff || !activeDiffs.includes(songDiff)) {
                    continue; 
                }
            }

            // 💡 【修正点2】難易度が「WE」以外の場合のみ、定数範囲フィルターを適用する（WE楽曲は定数チェックを免除して通過）
            if (songDiff !== "WE") {
                if (cConst < minC || cConst > maxC) continue;
            }

            // 💡 3. 傾向フィルターもMasterData基準で完全に判定
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
 * 💡 トレンド復活版：ユーザーごとのシートを更新する
 * （フロントエンドへ返す records にもトレンド情報を正しく引き渡す）
 */
function updateUserSheet(ss, name, records) {
    let sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    
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

            // 💡【復活のポイント】
            // fetchAndProcessFromApi 側で計算・付与された各コスト能力値や、
            // 保存されているトレンド情報をここでしっかりと確保します。
            const pTairyoku = r.tairyoku || 0;
            const pKenban   = r.kenban   || 0;
            const pChuni    = r.chuni    || 0;
            const pKuse     = r.kuse     || 0;
            const mTrend    = String(r.mainTrend || "None"); // 💡MasterDataから引き継いだメインの属性トレンド

            // ⚠️【超重要】HTML側（displayScores）がこのプロパティを読み込むため、
            // 念のためオブジェクト r にもしっかりとセットし直します
            r.mainTrend = mTrend;

            return [
                cleanTitle, 
                String(r.diff || ""),
                r.const || 0,        
                r.score || 0,
                r.rating || 0,       
                String(r.lamp || ""),
                String(r.isNew || ""),
                pTairyoku,           // H列
                pKenban,             // I列
                pChuni,              // J列
                pKuse,               // K列
                mTrend               // L列
            ];
        });
    }

    // シートをクリアして一気に書き込む
    sheet.clear();
    sheet.appendRow(header);
    
    if (rows.length > 0) {
        sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
    }
}



/**
 * 💡 完全版：APIから通常譜面とWORLD'S ENDレコードを両方取得し、
 * MasterDataの情報を完全内包して返す（WE対応版）
 */
function fetchAndProcessFromApi(token, ss, playerName) {
    // 1. MasterDataから最新の情報をキャッシュ（変更なし）
    const masterSheet = ss.getSheetByName("MasterData");
    const masterDataCache = {};
    
    const targetConstIdx = 2;   // C列：定数
    const targetIsNewIdx = 3;   // D列：isNew
    const targetTairyokuIdx = 4; // E列：体力コスト
    const targetKenbanIdx = 5;   // F列：鍵盤コスト
    const targetChuniIdx = 6;    // G列：チュウニズム力コスト
    const targetKuseIdx = 7;     // H列：癖コスト
    const targetTrendIdx = 9;    // J列：Main Trend

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

                masterDataCache[mFullKey] = {
                    constant: parseFloat(mRow[targetConstIdx] || 0),
                    isNew: (String(mRow[targetIsNewIdx] || "").toLowerCase().trim() === "true"),
                    tairyoku: parseFloat(mRow[targetTairyokuIdx] || 0),
                    kenban: parseFloat(mRow[targetKenbanIdx] || 0),
                    chuni: parseFloat(mRow[targetChuniIdx] || 0),
                    kuse: parseFloat(mRow[targetKuseIdx] || 0),
                    mainTrend: String(mRow[targetTrendIdx] || "None").trim()
                };
            }
        }
    }

    // 2. API通信とエラーハンドリング（通常譜面 ＆ WE譜面の並列取得）
    const normalApiUrl = `https://api.chunirec.net/2.0/records/showall.json?token=${token}&region=jp2`;
    const weApiUrl = `https://api.chunirec.net/2.0/records/worldsend.json?token=${token}&region=jp2`; // 💡WE用のエンドポイント
    
    let apiRecords = [];
    let isApiAvailable = true;

    try {
        // ① 通常譜面のフェッチ
        const resNormal = UrlFetchApp.fetch(normalApiUrl, { "muteHttpExceptions": true });
        if (resNormal.getResponseCode() === 200) {
            const jsonNormal = JSON.parse(resNormal.getContentText());
            if (jsonNormal.records) {
                apiRecords = apiRecords.concat(jsonNormal.records);
            }
        }

        // ② WORLD'S END譜面のフェッチ（💡新設）
        const resWe = UrlFetchApp.fetch(weApiUrl, { "muteHttpExceptions": true });
        if (resWe.getResponseCode() === 200) {
            const jsonWe = JSON.parse(resWe.getContentText());
            if (jsonWe.records) {
                // プレイ済みのWEレコードのみを対象にマージする
                const playedWe = jsonWe.records.filter(rec => rec.is_played === true);
                apiRecords = apiRecords.concat(playedWe);
            }
        }
    } catch (e) {
        console.warn("API取得中に例外が発生しました: " + e.toString());
    }

    // API停止時の個人シートからのフォールバックモード（通常・WE混在シートから読み出すため変更なしでOK）
    if (!apiRecords || apiRecords.length === 0) {
        console.log("⚠️ chunirec API停止中。個人シートの既存データから再計算します。");
        isApiAvailable = false;
        
        const userSheet = ss.getSheetByName(playerName);
        if (!userSheet) {
            throw new Error("API接続に失敗し、かつ個人シートも見つからないため処理を中断しました。");
        }
        
        const userValues = userSheet.getDataRange().getValues();
        if (userValues.length > 1) {
            apiRecords = [];
            const uHeader = userValues[0].map(h => String(h).toLowerCase().trim());
            const uTitleIdx = uHeader.findIndex(h => h.includes("title") || h.includes("曲名"));
            const uDiffIdx = uHeader.findIndex(h => h.includes("diff") || h.includes("難易度"));
            const uScoreIdx = uHeader.findIndex(h => h.includes("score") || h.includes("スコア"));
            const uLampIdx = uHeader.findIndex(h => h.includes("lamp") || h.includes("ランプ"));

            for (let i = 1; i < userValues.length; i++) {
                const uRow = userValues[i];
                if (!uRow[uTitleIdx]) continue;
                
                apiRecords.push({
                    title: String(uRow[uTitleIdx]),
                    diff: String(uRow[uDiffIdx] || "MAS"),
                    score: parseFloat(uRow[uScoreIdx]) || 0,
                    lamp: String(uRow[uLampIdx] || "")
                });
            }
        } else {
            throw new Error("APIが停止しており、個人シートにもデータが存在しません。");
        }
    }

    // 3. データのマッピング、コスト計算、Rating再計算
    const processedRecords = apiRecords.map(r => {
        const key = r.title + "_" + r.diff;
        
        // MasterDataキャッシュ参照
        const masterInfo = masterDataCache[key] || { 
            constant: parseFloat(r.const || 0), 
            isNew: false, 
            tairyoku: 0, 
            kenban: 0, 
            chuni: 0, 
            kuse: 0, 
            mainTrend: "None" 
        };

        const c = masterInfo.constant;
        const isNewSong = masterInfo.isNew;

        // ランプの判定（通常譜面もWE譜面も共通のプロパティ構造なのでそのまま適用可能）
        let lamp = isApiAvailable ? (r.score >= 1010000 ? "AJC" : r.is_alljustice ? "AJ" : r.is_fullcombo ? "FC" : "") : (r.lamp || "");
        
        // スコア補正値を計算
        const scoreMod = calculateScoreModifier(r.score, lamp);

        return {
            title: r.title,
            diff: r.diff,
            const: c,
            score: r.score,
            // 💡 補足：WEの場合、通常譜面用のレーティング計算を走らせると 0 になります（仕様通りでOK）
            rating: calculateChuniRating(r.score, c),
            lamp: lamp,
            isNew: isNewSong,
            tairyoku: Math.round(masterInfo.tairyoku * scoreMod * 100) / 100,
            kenban: Math.round(masterInfo.kenban * scoreMod * 100) / 100,
            chuni: Math.round(masterInfo.chuni * scoreMod * 100) / 100,
            kuse: Math.round(masterInfo.kuse * scoreMod * 100) / 100,
            mainTrend: masterInfo.mainTrend 
        };
    }).filter(r => {
        // 💡【重要・フィルター条件緩和】
        // 通常譜面は「定数13.5以上」、WORLD'S ENDは「難易度がWE（定数0）」のものを両方残す
        return r.const >= 13.5 || r.diff === "WE";
    });

    return processedRecords;
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
 *  スコア補正値計算用のヘルパー関数（もしGAS内にまだ無ければ、fetchAndProcessFromApiの下辺りに貼り付けてください）
 */
function calculateScoreModifier(score, lamp) {
    if (score >= 1010000 || lamp === "AJC") return 1.0;
    if (score >= 1007500) return 0.95;
    if (score >= 1005000) return 0.9;
    if (score >= 1000000) return 0.8;
    if (score >= 990000) return 0.7;
    if (score >= 975000) return 0.5;
    return 0.0;
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

// =========================================================================
// 手元動画プラットフォーム用：スプレッドシート操作関数群（本番確定版）
// =========================================================================

/**
 * 最新30件のリクエストとアップロードのデータを取得する（備考欄対応版）
 */
function getVideoHistory(ss) {
    const reqSheet = ss.getSheetByName("VideoRequests") || ss.insertSheet("VideoRequests");
    const supSheet = ss.getSheetByName("VideoSupplies") || ss.insertSheet("VideoSupplies");

    if (reqSheet.getLastRow() === 0) reqSheet.appendRow(["ID", "曲名", "難易度", "投稿者", "日時", "備考"]);
    if (supSheet.getLastRow() === 0) supSheet.appendRow(["ID", "曲名", "難易度", "動画タイトル", "URL", "提供者", "日時"]);

    return {
        // 💡 取得するキーに "comment" を追加（6列目）
        requests: getLatestRowsArray(reqSheet, 30, ["id", "title", "diff", "user", "date", "comment"]),
        supplies: getLatestRowsArray(supSheet, 30, ["id", "title", "diff", "videoTitle", "url", "user", "date"])
    };
}

/**
 * リクエストの登録（新規追加 ＆ 既存の編集上書き / 備考欄対応版）
 */
function addVideoRequestRow(ss, id, title, diff, requester, comment) {
    const sheet = ss.getSheetByName("VideoRequests") || ss.insertSheet("VideoRequests");
    if (sheet.getLastRow() === 0) sheet.appendRow(["ID", "曲名", "難易度", "投稿者", "日時", "備考"]);

    const nowStr = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd HH:mm");
    const finalComment = comment ? String(comment).trim() : ""; // 空なら空文字

    if (id) {
        // 【編集モード】
        const data = sheet.getDataRange().getValues();
        const rowIdx = data.findIndex(row => String(row[0]) === String(id));
        if (rowIdx === -1) return { status: "error", message: "指定されたリクエストが見つかりません。" };
        if (data[rowIdx][3] !== requester) return { status: "error", message: "他人の投稿は編集できません。" };

        // 曲名[2列目]、難易度[3列目]を更新、さらに備考[6列目]を上書き
        sheet.getRange(rowIdx + 1, 2, 1, 2).setValues([[title, diff]]);
        sheet.getRange(rowIdx + 1, 6).setValue(finalComment); // 6列目(F列)に備考をセット
        return { status: "success", message: "updated" };
    } else {
        // 【新規投稿モード】
        const newId = "REQ_" + new Date().getTime();
        sheet.appendRow([newId, title, diff, requester, nowStr, finalComment]);
        return { status: "success", message: "inserted" };
    }
}

/**
 * 動画共有リンクの登録（新規追加 ＆ 既存の編集上書き）
 */
function addVideoSupplyRow(ss, id, title, diff, contributor, videoUrl, videoTitle) {
    const sheet = ss.getSheetByName("VideoSupplies") || ss.insertSheet("VideoSupplies");
    if (sheet.getLastRow() === 0) sheet.appendRow(["ID", "曲名", "難易度", "動画タイトル", "URL", "提供者", "日時"]);

    const nowStr = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd HH:mm");

    if (id) {
        // 【編集モード】
        const data = sheet.getDataRange().getValues();
        const rowIdx = data.findIndex(row => String(row[0]) === String(id));
        if (rowIdx === -1) return { status: "error", message: "指定された動画共有が見つかりません。" };

        // セキュリティチェック：提供者が一致しているか
        if (data[rowIdx][5] !== contributor) return { status: "error", message: "他人の投稿は編集できません。" };

        // 曲名[2列目]、難易度[3列目]、動画タイトル[4列目]、URL[5列目]を上書き
        sheet.getRange(rowIdx + 1, 2, 1, 4).setValues([[title, diff, videoTitle, videoUrl]]);
        return { status: "success", message: "updated" };
    } else {
        // 【新規投稿モード】
        const newId = "SUP_" + new Date().getTime();
        sheet.appendRow([newId, title, diff, videoTitle, videoUrl, contributor, nowStr]);
        return { status: "success", message: "inserted" };
    }
}

/**
 * 投稿の削除（IDのプレフィックスからシートを自動判別）
 */
function deleteVideoItemRow(ss, id, playerName) {
    if (!id) return { status: "error", message: "IDが指定されていません。" };
    
    // REQ_ から始まるならリクエストシート、違えばサプライシート
    const sheetName = id.indexOf("REQ_") === 0 ? "VideoRequests" : "VideoSupplies";
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return { status: "error", message: "シートが見つかりません。" };

    const data = sheet.getDataRange().getValues();
    const rowIdx = data.findIndex(row => String(row[0]) === String(id));
    if (rowIdx === -1) return { status: "error", message: "削除対象のデータが見つかりません。" };

    // セキュリティチェック（リクエストは4列目[3]、サプライは6列目[5]が投稿者ユーザー名）
    const userColIdx = (sheetName === "VideoRequests") ? 3 : 5;
    if (data[rowIdx][userColIdx] !== playerName) {
        return { status: "error", message: "他人の投稿は削除できません。" };
    }

    // 行を丸ごと削除
    sheet.deleteRow(rowIdx + 1);
    return { status: "success", message: "deleted" };
}

/**
 * 内部ヘルパー：指定シートの下部から最新のデータを逆順（降順）のオブジェクト配列で返す（データ欠損修正版）
 */
function getLatestRowsArray(sheet, count, keys) {
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return []; // ヘッダーのみ、または空
    
    const lastCol = sheet.getLastColumn();
    const startRow = Math.max(2, lastRow - count + 1);
    const numRows = lastRow - startRow + 1;
    
    // 💡 keys.length ではなく、シートの実際の最大列数（lastCol）を指定して確実に全列取得する
    const values = sheet.getRange(startRow, 1, numRows, lastCol).getValues();
    
    const resultList = [];
    // 新しい投稿が「上」に表示されるように逆順ループ
    for (let i = values.length - 1; i >= 0; i--) {
        let obj = {};
        for (let j = 0; j < keys.length; j++) {
            // 万が一シートの列数が指定キーより少なければ空文字を、あればシートの値をセット
            obj[keys[j]] = (j < lastCol) ? values[i][j] : "";
        }
        resultList.push(obj);
    }
    return resultList;
}

/**
 * 既存の getVideosForSong (ランキング用) が無い場合、または連動を強化するための関数
 * スプレッドシートから該当する曲名と難易度の動画リストを引っ張る
 */
function getVideosForSong(ss, title, diff) {
    const sheet = ss.getSheetByName("VideoSupplies");
    if (!sheet || sheet.getLastRow() <= 1) return [];

    const data = sheet.getDataRange().getValues();
    const list = [];
    
    // 2行目（データ開始行）からスキャン
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        // 曲名と難易度が完全一致するか（大文字小文字無視）
        if (String(row[1]).toLowerCase() === title.toLowerCase() && String(row[2]).toLowerCase() === diff.toLowerCase()) {
            list.push({
                id: row[0],
                title: row[1],
                diff: row[2],
                videoTitle: row[3],
                url: row[4],
                user: row[5],
                date: row[6]
            });
        }
    }
    return list; // 既存の getRanking 時に自動的にこの配列がフロントへ返ります
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