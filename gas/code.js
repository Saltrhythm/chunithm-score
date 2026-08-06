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

        // 💡【追加】特定のプレイヤーの個別データ取得（セレクトボックス切替用）
        if (mode === "get_player_data") {
            const playerName = String(params.playerName || "");
            const records = getPlayerDataByName(playerName);
            return createJsonResponse({ status: "success", playerName: playerName, records: records });
        }

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

        // 💡【共通化】VS機能・枠データ共有 プレイヤー一覧取得モード
        if (mode === "get_vs_players") {
            const playerNames = getAllPlayerNames(); // UserMapのB列から取得
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
                const rawToken = String(params.token || "").trim();

                if (!rawToken) {
                    return createJsonResponse({ status: "error", message: "トークンを入力してください。" });
                }

                // 1. 認証トークンの SHA-256 ハッシュ化
                const rawBytes = Utilities.newBlob(rawToken).getBytes();
                const hashedToken = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, rawBytes)
                    .map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('').toLowerCase();

                // 2. UserMap シートの取得
                const userMapSheet = ss.getSheetByName("UserMap");
                if (!userMapSheet) {
                    return createJsonResponse({ status: "error", message: "UserMapシートが見つかりません。管理者に問い合わせてください。" });
                }

                const userMapData = userMapSheet.getDataRange().getValues();
                
                // 3. UserMap 照合
                let matchedRow = null;
                for (let i = 1; i < userMapData.length; i++) {
                    const sheetHash = String(userMapData[i][0] || "").trim().toLowerCase();
                    if (sheetHash === hashedToken) {
                        matchedRow = userMapData[i];
                        break;
                    }
                }

                if (!matchedRow) {
                    return createJsonResponse({ 
                        status: "error", 
                        message: "未承認のユーザーです。ツールを利用するには管理者に承認（UserMapへの登録）を依頼してください。" 
                    });
                }

                // 4. 承認済みユーザーのプレイヤー名を取得
                const playerName = String(matchedRow[1] || "").trim();
                if (!playerName) {
                    return createJsonResponse({ status: "error", message: "UserMap内のユーザー名設定が不正です。" });
                }

                // 5. データ取得および更新処理
                const records = fetchAndProcessFromApi(rawToken, ss, playerName);
                updateUserSheet(ss, playerName, records);
                
                return createJsonResponse({ 
                    status: "success", 
                    playerName: playerName, 
                    records: records 
                });

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
 * 💡 UserMapシートのB列からユーザー名一覧を取得
 */
function getAllPlayerNames() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("UserMap");
    if (!sheet) return [];

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return []; // ヘッダーのみの場合

    // B列（B2〜最終行）を取得
    const rangeValues = sheet.getRange(2, 2, lastRow - 1, 1).getValues();

    // 空白を除外して配列で返す
    return rangeValues
      .map(row => String(row[0]).trim())
      .filter(name => name !== "");

  } catch (e) {
    Logger.log("Error in getAllPlayerNames: " + e.message);
    return [];
  }
}

/**
 * 💡 指定されたプレイヤー名のシートからレコードデータを取得
 */
function getPlayerDataByName(playerName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(playerName);
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  const header = data[0].map(h => String(h).trim());

  const titleIdx    = header.indexOf("title");
  const diffIdx     = header.indexOf("diff");
  const constIdx    = header.indexOf("const");
  const scoreIdx    = header.indexOf("score");
  const ratingIdx   = header.indexOf("rating");
  const lampIdx     = header.indexOf("lamp");
  const isNewIdx    = header.indexOf("isNew");
  const tairyokuIdx = header.indexOf("体力");
  const kenbanIdx   = header.indexOf("鍵盤力");
  const chuniIdx    = header.indexOf("チュウニズム力");
  const kuseIdx     = header.indexOf("癖力");
  const trendIdx    = header.indexOf("mainTrend");

  const records = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const title = String(row[titleIdx] || "");
    if (!title) continue;

    const score = parseFloat(row[scoreIdx]) || 0;
    const lamp = String(row[lampIdx] || "");

    // スコア補正値から補正前コスト（raw***）を逆算・復元
    const scoreMod = (typeof calculateScoreModifier === 'function') ? calculateScoreModifier(score, lamp) : 1;
    const safeMod = scoreMod > 0 ? scoreMod : 1;

    const tairyoku = parseFloat(row[tairyokuIdx]) || 0;
    const kenban   = parseFloat(row[kenbanIdx]) || 0;
    const chuni    = parseFloat(row[chuniIdx]) || 0;
    const kuse     = parseFloat(row[kuseIdx]) || 0;

    records.push({
      title: title,
      diff: String(row[diffIdx] || ""),
      const: parseFloat(row[constIdx]) || 0,
      score: score,
      rating: parseFloat(row[ratingIdx]) || 0,
      lamp: lamp,
      isNew: String(row[isNewIdx] || "").toLowerCase() === "true",
      tairyoku: tairyoku,
      kenban: kenban,
      chuni: chuni,
      kuse: kuse,
      // 傾向枠（POWER/NOTES等）の表示用に補正前コストを復元
      rawTairyoku: Math.round((tairyoku / safeMod) * 10) / 10,
      rawKenban:   Math.round((kenban / safeMod) * 10) / 10,
      rawChuni:    Math.round((chuni / safeMod) * 10) / 10,
      rawKuse:     Math.round((kuse / safeMod) * 10) / 10,
      mainTrend: String(row[trendIdx] || "None")
    });
  }

  return records;
}

/**
 * 💡 高速化版：ランキング取得ロジック（ノーツ数保持版）
 */
function getRankingFromSheets(ss, title, diff, params, logSheet) {
    const userMapSheet = ss.getSheetByName("UserMap");
    if (!userMapSheet) return [];

    const userMap = userMapSheet.getDataRange().getValues();
    if (userMap.length <= 1) return [];

    const normalize = (str) => {
        if (!str) return "";
        const s = String(str);
        return s.includes(" ") || s.includes(" ") ? s.replace(/[\s ]+/g, "").toLowerCase() : s.toLowerCase();
    };

    const targetTitle = normalize(title);
    const targetDiff = normalize(diff);

    const isTrendEnabled = !!(params.trendEnable !== undefined ? params.trendEnable : params.isTrendEnabled);
    const rawTrends = Array.isArray(params.trends) ? params.trends : (Array.isArray(params.activeTrends) ? params.activeTrends : []);
    const activeTrends = rawTrends.map(t => String(t).toUpperCase().trim());

    let songConst = 0;
    let songMainTrend = "NONE";
    let songNotes = 0;
    
    const masterSheet = ss.getSheetByName("MasterData");
    if (masterSheet) {
        const masterData = masterSheet.getDataRange().getValues();
        if (masterData.length > 1) {
            const headerRow = masterData[0].map(h => String(h).toLowerCase().trim());
            
            let mainIdx = headerRow.findIndex(h => h.includes("maintrend") || h === "main");
            if (mainIdx === -1) mainIdx = 9;

            let titleIdx = headerRow.findIndex(h => h.includes("title") || h.includes("曲名"));
            if (titleIdx === -1) titleIdx = 0;

            let diffIdx = headerRow.findIndex(h => h.includes("diff") || h.includes("難易度"));
            if (diffIdx === -1) diffIdx = 1;

            let notesIdx = headerRow.findIndex(h => h.includes("notes") || h.includes("ノーツ"));
            if (notesIdx === -1) notesIdx = 11;

            for (let i = 1; i < masterData.length; i++) {
                const row = masterData[i];
                if (normalize(row[titleIdx]) === targetTitle && normalize(row[diffIdx]) === targetDiff) {
                    songConst = parseFloat(row[2] || 0); 
                    songMainTrend = String(row[mainIdx] || "NONE").toUpperCase().trim();
                    songNotes = parseInt(row[notesIdx] || 0, 10);
                    break;
                }
            }
        }
    }

    if (isTrendEnabled && activeTrends.length > 0) {
        if (!activeTrends.includes(songMainTrend)) {
            return [];
        }
    }

    const validUserSet = new Set();
    for (let i = 1; i < userMap.length; i++) {
        const uName = String(userMap[i][1] || "").trim();
        if (uName) validUserSet.add(uName);
    }

    const sheetDataMap = {};
    const allSheets = ss.getSheets();
    for (let i = 0; i < allSheets.length; i++) {
        const sheet = allSheets[i];
        const sName = sheet.getName();
        if (validUserSet.has(sName)) {
            sheetDataMap[sName] = sheet.getDataRange().getValues();
        }
    }

    const results = [];
    validUserSet.forEach(name => {
        const data = sheetDataMap[name];
        if (!data) {
            results.push({ playerName: name, score: "-", lamp: "-", constant: songConst, notes: songNotes });
            return;
        }

        let match = null;
        for (let j = 1; j < data.length; j++) {
            const row = data[j];
            const rowTitle = String(row[0] || "");
            const rowDiff = String(row[1] || "");

            if ((rowTitle === title && rowDiff === diff) || 
                (normalize(rowTitle) === targetTitle && normalize(rowDiff) === targetDiff)) {
                match = row;
                break;
            }
        }

        if (match) {
            const scoreVal = (match[3] !== undefined && match[3] !== null && match[3] !== "") ? match[3] : "-";
            const lampVal = (match[5] !== undefined && match[5] !== null && match[5] !== "") ? String(match[5]) : "-";
            results.push({ playerName: name, score: scoreVal, lamp: lampVal, constant: songConst, notes: songNotes });
        } else {
            results.push({ playerName: name, score: "-", lamp: "-", constant: songConst, notes: songNotes });
        }
    });

    return results.sort((a, b) => {
        const sA = (a.score === "-" || a.score === null || a.score === undefined) ? -1 : parseFloat(a.score);
        const sB = (b.score === "-" || b.score === null || b.score === undefined) ? -1 : parseFloat(b.score);
        return sB - sA;
    });
}

/**
 * 💡 高速化版：MasterDataから特定の楽曲のプロパティを取得
 */
function getSongPropsFromMaster(ss, title, diff) {
    const defaultProps = { constant: 0, tairyoku: 0, kenban: 0, chuni: 0, kuse: 0, mainTrend: "None", subTrend: "None", notes: 0 };
    const masterSheet = ss.getSheetByName("MasterData");
    if (!masterSheet) return defaultProps;

    const lastRow = masterSheet.getLastRow();
    if (lastRow <= 1) return defaultProps;

    const data = masterSheet.getRange(1, 1, lastRow, 12).getValues();
    const normalize = (str) => {
        if (!str) return "";
        const s = String(str);
        return s.includes(" ") || s.includes(" ") ? s.replace(/[\s ]+/g, "").toLowerCase() : s.toLowerCase();
    };

    const targetTitle = normalize(title);
    const targetDiff = normalize(diff);

    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const rowTitle = String(row[0] || "");
        const rowDiff = String(row[1] || "");

        if ((rowTitle === title && rowDiff === diff) || 
            (normalize(rowTitle) === targetTitle && normalize(rowDiff) === targetDiff)) {
            return {
                constant: parseFloat(row[2]) || 0,  
                tairyoku: parseFloat(row[4]) || 0, 
                kenban: parseFloat(row[5]) || 0,   
                chuni: parseFloat(row[6]) || 0,    
                kuse: parseFloat(row[7]) || 0,     
                mainTrend: String(row[9] || "None").trim(),  
                subTrend: String(row[10] || "None").trim(),
                notes: parseInt(row[11] || 0, 10)
            };
        }
    }
    return defaultProps;
}

/**
 * 💡 高速化版：統計情報を取得
 */
function getStatsFromSheets(ss, params) {
    const userMapSheet = ss.getSheetByName("UserMap");
    if (!userMapSheet) return [];

    const userMap = userMapSheet.getDataRange().getValues();
    if (userMap.length <= 1) return [];

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

    const diffFilter = Array.isArray(params.diffFilter) ? params.diffFilter.map(d => String(d).toUpperCase().trim()) : [];
    const isTrendEnabled = !!(params.trendEnable !== undefined ? params.trendEnable : params.isTrendEnabled);
    const rawTrends = Array.isArray(params.trends) ? params.trends : (Array.isArray(params.activeTrends) ? params.activeTrends : []);
    const activeTrends = rawTrends.map(t => String(t).toUpperCase().trim());

    // 💡【最適化1】ループ内で毎回計算していた limitMax を事前に定義
    const limitMax = (filterMode === "score") ? rMax : (typeof getUpperLimitGAS === 'function' ? getUpperLimitGAS(rMax) : rMax);

    const masterSheet = ss.getSheetByName("MasterData");
    const masterDataCache = {}; 
    const uniqueMatchingSongs = new Set();

    if (masterSheet) {
        const masterData = masterSheet.getDataRange().getValues();
        if (masterData.length > 1) {
            const headerRow = masterData[0].map(h => String(h).toLowerCase().trim());
            
            let mainIdx = headerRow.findIndex(h => h.includes("maintrend") || h === "main");
            if (mainIdx === -1) mainIdx = 9;

            let titleIdx = headerRow.findIndex(h => h.includes("title") || h.includes("曲名"));
            if (titleIdx === -1) titleIdx = 0;

            let diffIdx = headerRow.findIndex(h => h.includes("diff") || h.includes("難易度"));
            if (diffIdx === -1) diffIdx = 1;

            for (let i = 1; i < masterData.length; i++) {
                const mRow = masterData[i];
                const mTitle = String(mRow[titleIdx] || "").trim();
                let mDiff = String(mRow[diffIdx] || "").toUpperCase().trim();
                
                if (mDiff.includes("WORLD") || mDiff === "WE") mDiff = "WE";
                if (!mTitle || !mDiff || mRow[2] === "") continue;

                if (diffFilter.length > 0 && !diffFilter.includes(mDiff)) continue;

                const mFullKey = `${mTitle}_${mDiff}`;
                const cConst = parseFloat(mRow[2] || 0);
                const isNewStr = String(mRow[3] || "").toLowerCase().trim();
                const mMain = String(mRow[mainIdx] || "").toUpperCase().trim();

                masterDataCache[mFullKey] = {
                    title: mTitle,
                    constant: cConst,
                    mainTrend: mMain,
                    diff: mDiff
                };

                const isPassConstant = (mDiff === "WE") || (cConst >= minC && cConst <= maxC);
                if (isPassConstant) {
                    let passType = (typeFilter === 'all') ||
                                   (typeFilter === 'new' && isNewStr === 'true') ||
                                   (typeFilter === 'old' && isNewStr !== 'true');

                    if (passType) {
                        let passTrend = !isTrendEnabled || activeTrends.length === 0 || activeTrends.includes(mMain);
                        if (passTrend) {
                            uniqueMatchingSongs.add(mFullKey);
                        }
                    }
                }
            }
        }
    }

    // 💡【最適化2】UserMap に存在する有効なユーザーのシートのみ取得（全シート全取得を廃止）
    const validUserSet = new Set();
    for (let i = 1; i < userMap.length; i++) {
        const uName = String(userMap[i][1] || "").trim();
        if (uName) validUserSet.add(uName);
    }

    const sheetDataMap = {};
    const allSheets = ss.getSheets();
    for (let i = 0; i < allSheets.length; i++) {
        const sName = allSheets[i].getName();
        if (validUserSet.has(sName)) {
            sheetDataMap[sName] = allSheets[i].getDataRange().getValues();
        }
    }

    // ユーザー毎の集計処理
    validUserSet.forEach(name => {
        const data = sheetDataMap[name];
        if (!data) return;

        let playerCountFiltered = 0;
        let playerTotalScoreFiltered = 0;
        let playerTotalCountFiltered = 0;
        let playerValidScoreSum = 0;
        let playerValidScoreCount = 0;

        for (let j = 1; j < data.length; j++) {
            const row = data[j];
            if (!row || row.length < 7) continue;

            const songName = String(row[0] || "不明な曲").trim();
            let diff = String(row[1] || "").toUpperCase().trim();
            if (diff.includes("WORLD") || diff === "WE") diff = "WE";

            if (diffFilter.length > 0 && !diffFilter.includes(diff)) continue;

            const fullTitleKey = diff ? `${songName}_${diff}` : songName;
            const masterInfo = masterDataCache[fullTitleKey] || { title: songName, constant: parseFloat(row[2] || 0), mainTrend: "None", diff: diff };
            const cConst = masterInfo.constant; 

            if (diff !== "WE" && (cConst < minC || cConst > maxC)) continue;

            if (isTrendEnabled && activeTrends.length > 0) {
                const songMainTrend = masterInfo.mainTrend;
                if (!songMainTrend || !activeTrends.includes(songMainTrend)) continue; 
            }

            const cScore = parseFloat(row[3] || 0);
            const cRating = parseFloat(row[4] || 0);
            const cLamp = String(row[5] || "");
            const isNewSongStr = String(row[6] || "").toLowerCase().trim();

            if (!songAggregation[fullTitleKey]) {
                songAggregation[fullTitleKey] = {
                    title: songName,
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
            songAggregation[fullTitleKey].totalScoreAll += cScore;
            songAggregation[fullTitleKey].totalCountAll++;

            const scoreCutoff = (diff === "WE") ? 900000 : 990000;
            if (cScore >= scoreCutoff) {
                songAggregation[fullTitleKey].validScoreSum += cScore;
                songAggregation[fullTitleKey].validScoreCount++;
            }

            let isAchieved = (cRating >= minRating && cRating <= maxRating) && (cScore >= rMin && cScore <= limitMax);

            if (isAchieved && targetLamp !== 'all') {
                if (targetLamp === 'ajc' && !cLamp.includes('AJC')) isAchieved = false;
                else if (targetLamp === 'aj' && !cLamp.includes('AJ')) isAchieved = false;
                else if (targetLamp === 'None' && (cLamp.includes('AJ') || cLamp.includes('AJC'))) isAchieved = false;
            }

            if (isAchieved) {
                songAggregation[fullTitleKey].count++;
            }
            songAggregation[fullTitleKey].players.push({ name: name, score: cScore, isAchieved: isAchieved });

            let passTypeFilter = (typeFilter === 'all') || 
                                 (typeFilter === 'new' && isNewSongStr === 'true') || 
                                 (typeFilter === 'old' && isNewSongStr !== 'true');

            if (passTypeFilter) {
                playerTotalCountFiltered++;
                playerTotalScoreFiltered += cScore;
                
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
            allPlayCount: playerValidScoreCount,
            avgScore: playerValidScoreCount > 0 ? Math.round(playerValidScoreSum / playerValidScoreCount) : 0
        });
    });

    const songRanking = Object.keys(songAggregation).map(key => {
        const data = songAggregation[key];
        return {
            title: data.title,
            count: data.count, 
            constant: data.constant, 
            diff: data.diff, 
            players: data.players,
            avgScore: data.validScoreCount > 0 ? Math.round(data.validScoreSum / data.validScoreCount) : 0,
            totalCountAll: data.validScoreCount || 0
        };
    });

    return {
        playerRanking: results,
        songRanking: songRanking,
        theoryCount: uniqueMatchingSongs.size, 
        totalUsers: validUserSet.size
    };
}

/**
 * 💡 高速化版：特定プレイヤーの詳細データ取得
 */
function getPlayerDetailFromSheet(ss, playerName, params) {
    playerName = playerName.replace(/[\*＼\/\\\[\]\?：:]/g, "").trim();
    const sheet = ss.getSheetByName(playerName);
    if (!sheet) return [];

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];

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

    const limitMax = (filterMode === "score") ? rMax : (typeof getUpperLimitGAS === 'function' ? getUpperLimitGAS(rMax) : rMax);
    const diffFilter = Array.isArray(params.diffFilter) ? params.diffFilter.map(d => String(d).toUpperCase().trim()) : [];

    const isTrendEnabled = !!(params.trendEnable !== undefined ? params.trendEnable : params.isTrendEnabled);
    const rawTrends = Array.isArray(params.trends) ? params.trends : (Array.isArray(params.activeTrends) ? params.activeTrends : []);
    const activeTrends = rawTrends.map(t => String(t).toUpperCase().trim());

    const masterSheet = ss.getSheetByName("MasterData");
    const masterDataCache = {}; 

    if (masterSheet) {
        const masterData = masterSheet.getDataRange().getValues();
        if (masterData.length > 1) {
            const headerRow = masterData[0].map(h => String(h).toLowerCase().trim());
            
            let mainIdx = headerRow.findIndex(h => h.includes("maintrend") || h === "main");
            if (mainIdx === -1) mainIdx = 9;

            let titleIdx = headerRow.findIndex(h => h.includes("title") || h.includes("曲名"));
            if (titleIdx === -1) titleIdx = 0;

            let diffIdx = headerRow.findIndex(h => h.includes("diff") || h.includes("難易度"));
            if (diffIdx === -1) diffIdx = 1;

            for (let i = 1; i < masterData.length; i++) {
                const mRow = masterData[i];
                const mTitle = String(mRow[titleIdx] || "").trim();
                let mDiff = String(mRow[diffIdx] || "").toUpperCase().trim();

                if (mDiff.includes("WORLD") || mDiff === "WE") mDiff = "WE";
                const mFullKey = mDiff ? `${mTitle}_${mDiff}` : mTitle;

                masterDataCache[mFullKey] = {
                    constant: parseFloat(mRow[2] || 0),
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
        if (diff.includes("WORLD") || diff === "WE") diff = "WE";

        if (diffFilter.length > 0 && !diffFilter.includes(diff)) continue;

        const fullTitleKey = diff ? `${songName}_${diff}` : songName;
        const masterInfo = masterDataCache[fullTitleKey] || { constant: parseFloat(row[2] || 0), mainTrend: "None" };
        const cConst = masterInfo.constant; 

        if (diff !== "WE" && (cConst < minC || cConst > maxC)) continue;

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

        let isAchieved = (cRating >= minRating && cRating <= maxRating) && (cScore >= rMin && cScore <= limitMax);

        if (isAchieved && targetLamp !== 'all') {
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
 * 💡 ユーザーごとのシートを更新する（13列・ノーツ数保持版）
 */
function updateUserSheet(ss, name, records) {
  let sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  
  const header = ["title", "diff", "const", "score", "rating", "lamp", "isNew", "体力", "鍵盤力", "チュウニズム力", "癖力", "mainTrend", "notes"];
  let rows = [];

  if (records && records.length > 0) {
    records.sort((a, b) => b.rating - a.rating);

    rows = records.map(r => {
      let cleanTitle = String(r.title || "");
      if (/^0\d+$/.test(cleanTitle)) {
        cleanTitle = "'" + cleanTitle;
      }

      return [
        cleanTitle, 
        String(r.diff || ""),
        r.const || 0,        
        r.score || 0,
        r.rating || 0,       
        String(r.lamp || ""),
        String(r.isNew || ""),
        r.tairyoku || 0,     
        r.kenban || 0,       
        r.chuni || 0,        
        r.kuse || 0,         
        String(r.mainTrend || "None"),
        r.notes || 0 // 💡 ノーツ数を保存
      ];
    });
  }

  sheet.clear();
  sheet.appendRow(header);
  
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
  }
}

/**
 * 💡 APIから通常譜面とWORLD'S ENDレコードを取得して返す（ノーツ数保持版）
 */
function fetchAndProcessFromApi(token, ss, playerName) {
  const masterSheet = ss.getSheetByName("MasterData");
  const masterDataCache = {};
  
  const targetConstIdx = 2;   
  const targetIsNewIdx = 3;   
  const targetTairyokuIdx = 4; 
  const targetKenbanIdx = 5;   
  const targetChuniIdx = 6;    
  const targetKuseIdx = 7;     
  const targetTrendIdx = 9;    
  const targetNotesIdx = 11; // L列 (ノーツ数)

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
          mainTrend: String(mRow[targetTrendIdx] || "None").trim(),
          notes: parseInt(mRow[targetNotesIdx] || 0, 10)
        };
      }
    }
  }

  const normalApiUrl = `https://api.chunirec.net/2.0/records/showall.json?token=${token}&region=jp2`;
  const weApiUrl = `https://api.chunirec.net/2.0/records/worldsend.json?token=${token}&region=jp2`;
  
  let apiRecords = [];
  let isApiAvailable = true;

  try {
    const resNormal = UrlFetchApp.fetch(normalApiUrl, { "muteHttpExceptions": true });
    if (resNormal.getResponseCode() === 200) {
      const jsonNormal = JSON.parse(resNormal.getContentText());
      if (jsonNormal.records) apiRecords = apiRecords.concat(jsonNormal.records);
    }

    const resWe = UrlFetchApp.fetch(weApiUrl, { "muteHttpExceptions": true });
    if (resWe.getResponseCode() === 200) {
      const jsonWe = JSON.parse(resWe.getContentText());
      if (jsonWe.records) {
        const playedWe = jsonWe.records.filter(rec => rec.is_played === true);
        apiRecords = apiRecords.concat(playedWe);
      }
    }
  } catch (e) {
    console.warn("API取得中に例外が発生しました: " + e.toString());
  }

  if (!apiRecords || apiRecords.length === 0) {
    isApiAvailable = false;
    const userSheet = ss.getSheetByName(playerName);
    if (!userSheet) throw new Error("API接続失敗かつ個人シートなし");
    
    const userValues = userSheet.getDataRange().getValues();
    if (userValues.length > 1) {
      apiRecords = [];
      const uHeader = userValues[0].map(h => String(h).toLowerCase().trim());
      const uTitleIdx = uHeader.findIndex(h => h.includes("title") || h.includes("曲名"));
      const uDiffIdx = uHeader.findIndex(h => h.includes("diff") || h.includes("難易度"));
      const uScoreIdx = uHeader.findIndex(h => h.includes("score") || h.includes("スコア"));
      const uLampIdx = uHeader.findIndex(h => h.includes("lamp") || h.includes("ランプ"));
      const uNotesIdx = uHeader.findIndex(h => h.includes("notes") || h.includes("ノーツ"));

      for (let i = 1; i < userValues.length; i++) {
        const uRow = userValues[i];
        if (!uRow[uTitleIdx]) continue;
        
        apiRecords.push({
          title: String(uRow[uTitleIdx]),
          diff: String(uRow[uDiffIdx] || "MAS"),
          score: parseFloat(uRow[uScoreIdx]) || 0,
          lamp: String(uRow[uLampIdx] || ""),
          notes: uNotesIdx !== -1 ? parseInt(uRow[uNotesIdx] || 0, 10) : 0
        });
      }
    } else {
      throw new Error("API停止かつデータなし");
    }
  }

  const processedRecords = apiRecords.map(r => {
    const key = r.title + "_" + r.diff;
    
    const masterInfo = masterDataCache[key] || { 
      constant: parseFloat(r.const || 0), 
      isNew: false, 
      tairyoku: 0, 
      kenban: 0, 
      chuni: 0, 
      kuse: 0, 
      mainTrend: "None",
      notes: r.notes || 0
    };

    const c = masterInfo.constant;
    const isNewSong = masterInfo.isNew;
    const notes = masterInfo.notes || 0;

    let lamp = isApiAvailable ? (r.score >= 1010000 ? "AJC" : r.is_alljustice ? "AJ" : r.is_fullcombo ? "FC" : "") : (r.lamp || "");
    const scoreMod = calculateScoreModifier(r.score, lamp);

    return {
      title: r.title,
      diff: r.diff,
      const: c,
      score: r.score,
      rating: calculateChuniRating(r.score, c),
      lamp: lamp,
      isNew: isNewSong,
      notes: notes, // 💡 ノーツ数のみ返す
      
      tairyoku: Math.round(masterInfo.tairyoku * scoreMod * 100) / 100,
      kenban:   Math.round(masterInfo.kenban * scoreMod * 100) / 100,
      chuni:    Math.round(masterInfo.chuni * scoreMod * 100) / 100,
      kuse:     Math.round(masterInfo.kuse * scoreMod * 100) / 100,
      
      rawTairyoku: masterInfo.tairyoku,
      rawKenban:   masterInfo.kenban,
      rawChuni:    masterInfo.chuni,
      rawKuse:     masterInfo.kuse,

      mainTrend: masterInfo.mainTrend 
    };
    
  }).filter(r => {
    return r.const >= 13.5 || r.diff === "WE";
  });

  return processedRecords;
}

/**
 * 💡 スコア補正値計算（1,005,000〜1,007,500強化 / 高スコア帯マイルド化版）
 */
function calculateScoreModifier(score, lamp) {
    // ① 990,000点未満は一律 0.0 倍
    if (score < 990000) return 0.0;
    
    let modifier = 0.0;
    
    // ② 990,000 〜 1,000,000点（倍率：0.00 から 0.40 へ）
    if (score >= 990000 && score < 1000000) {
        modifier = 0.00 + (score - 990000) * (0.40 / 10000);
    }
    // ③ 1,000,000 〜 1,005,000点（倍率：0.40 から 0.60 へ）
    else if (score >= 1000000 && score < 1005000) {
        modifier = 0.40 + (score - 1000000) * (0.20 / 5000);
    }
    // ④ 1,005,000 〜 1,007,500点（倍率：0.60 から 1.40 へ【0.10底上げ】）
    else if (score >= 1005000 && score < 1007500) {
        modifier = 0.60 + (score - 1005000) * (0.80 / 2500);
    }
    // ⑤ 1,007,500 〜 1,009,000点（倍率：1.40 から 1.95 へ【上昇量を0.60→0.55に調整】）
    else if (score >= 1007500 && score < 1009000) {
        modifier = 1.40 + (score - 1007500) * (0.55 / 1500);
    }
    // ⑥ 1,009,000 〜 1,010,000点（倍率：1.95 から 2.40 へ【上昇量を0.50→0.45に調整】）
    else {
        modifier = 1.95 + (score - 1009000) * (0.45 / 1000);
    }
    
    // ⑦ AJ（All Justice / AJC含む）の時にボーナス（+0.10倍）を付与
    // 理論値（1,010,000点 2.40）＋ AJ（0.10） ＝ ぴったり 2.50倍
    const currentLamp = String(lamp || "");
    if (currentLamp.includes("AJ") || currentLamp.includes("AJC")) {
        modifier += 0.10;
    }
    
    return modifier;
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