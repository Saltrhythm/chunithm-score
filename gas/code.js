function doPost(e) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let logSheet = ss.getSheetByName("DebugLog") || ss.insertSheet("DebugLog");

    try {
        if (!e || !e.postData || !e.postData.contents) {
            throw new Error("リクエストデータが空です");
        }

        const params = JSON.parse(e.postData.contents);
        const mode = String(params.mode || "checker");

        // 1. ランキング取得モード（読み取り専用：ロックなしで並列実行OK）
        if (mode === "get_ranking") {
            const t = String(params.title || "");
            const d = String(params.diff || "");
            const results = getRankingFromSheets(ss, t, d, logSheet);
            return createJsonResponse({ status: "success", data: results });
        }

        // 2. 統計取得モード（読み取り専用：ロックなしで並列実行OK）
        if (mode === "get_stats") {
            const results = getStatsFromSheets(ss, params);
            return createJsonResponse({ status: "success", data: results });
        }

        // 3. 特定のプレイヤーの全プレイデータ取得（読み取り専用：ロックなしで並列実行OK）
        if (mode === "get_player_detail") {
            const playerName = String(params.playerName || "");
            const results = getPlayerDetailFromSheet(ss, playerName, params);
            return createJsonResponse({ status: "success", data: results });
        }

        // =================================================================
        // 4. 同期/認証モード (checker) 
        // =================================================================
        const lock = LockService.getScriptLock();
        // 他の人が同期中の場合、最大15秒間順番待ちをする
        if (!lock.tryLock(15000)) {
            return createJsonResponse({ status: "error", message: "サーバーが混雑しています。少し時間を置いて再度お試しください。" });
        }

        try {
            const token = String(params.token || "");
            let playerName = String(params.playerName || "");
            
            // ★修正ポイント4：プレイヤー名からシート名の禁止文字（/, \, ?, *, [, ], :, ：）を自動除去
            playerName = playerName.replace(/[\*＼\/\\\[\]\?：:]/g, "").trim();

            // 先にAPIからデータを取得
            const records = fetchAndProcessFromApi(token, ss);

            // API取得に成功した場合のみ、以下の登録/更新処理に進む
            const hashedToken = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)
                .map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');

            let userMapSheet = ss.getSheetByName("UserMap") || ss.insertSheet("UserMap");
            if (userMapSheet.getLastRow() === 0) userMapSheet.appendRow(["token_hash", "name"]);

            const userMapData = userMapSheet.getDataRange().getValues();

            // トークンハッシュで既存ユーザーを検索
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
                // 仕様通り：名前変更は反映せず既存の名前を維持
                playerName = userMapData[userRowIndex][1];
            }

            // シートの作成・更新（ここが最重要の書き込み部分）
            updateUserSheet(ss, playerName, records);

            return createJsonResponse({ status: "success", playerName: playerName, records: records });

        } finally {
            lock.releaseLock();
        }

    } catch (error) {
        logSheet.appendRow([new Date(), "ERROR", String(error.message || error)]);
        return createJsonResponse({ status: "error", message: error.toString() });
    }
}

/**
 * ランキング取得ロジック（高速化版）
 */
function getRankingFromSheets(ss, title, diff, logSheet) {
    const userMapSheet = ss.getSheetByName("UserMap");
    if (!userMapSheet) return [];

    const userMap = userMapSheet.getDataRange().getValues();
    const results = [];

    const normalize = (str) => String(str || "").replace(/\s+/g, "").toLowerCase();
    const targetTitle = normalize(title);
    const targetDiff = normalize(diff);

    // 全シートのデータを最初に1回だけで一括取得し、メモリにマップ化する
    const allSheets = ss.getSheets();
    const sheetDataMap = {};
    allSheets.forEach(sheet => {
        const sName = sheet.getName();
        // ★修正ポイント1：除外リストに "NewSongs" を追加してメモリ負荷を軽減
        if (sName !== "UserMap" && sName !== "MasterData" && sName !== "DebugLog" && sName !== "NewSongs") {
            sheetDataMap[sName] = sheet.getDataRange().getValues();
        }
    });

    for (let i = 1; i < userMap.length; i++) {
        const name = String(userMap[i][1] || "");
        if (!name) continue;

        // スプレッドシートではなく、メモリ（オブジェクト）からデータを取得
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
            results.push({ playerName: name, score: "-", lamp: "-" });
        }
    }

    return results.sort((a, b) => {
        const sA = (a.score === "-" || !a.score) ? -1 : parseFloat(a.score);
        const sB = (b.score === "-" || !b.score) ? -1 : parseFloat(b.score);
        return sB - sA;
    });
}

/**
 * 統計情報を取得（高速化版）
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

    // 最初に全プレイヤーのシートデータを一括ロードしてメモリに載せる
    const allSheets = ss.getSheets();
    const sheetDataMap = {};
    allSheets.forEach(sheet => {
        const sName = sheet.getName();
        // ★修正ポイント1：除外リストに "NewSongs" を追加してメモリ負荷を軽減
        if (sName !== "UserMap" && sName !== "MasterData" && sName !== "DebugLog" && sName !== "NewSongs") {
            sheetDataMap[sName] = sheet.getDataRange().getValues();
        }
    });

    // --- 各ユーザーの集計 ---
    for (let i = 1; i < userMap.length; i++) {
        const name = String(userMap[i][1] || "");
        
        // メモリからデータを引き出す
        const data = sheetDataMap[name];
        if (!data) continue;

        let playerCountFiltered = 0;
        let playerTotalScoreFiltered = 0;
        let playerTotalCountFiltered = 0;

        for (let j = 1; j < data.length; j++) {
            const row = data[j];
            if (!row || row.length < 7) continue;

            const cConst = parseFloat(row[2] || 0);
            const cScore = parseFloat(row[3] || 0);
            const cRating = parseFloat(row[4] || 0);
            const cLamp = String(row[5] || "");
            const isNewSongStr = String(row[6] || "").toLowerCase().trim();

            if (cConst < minC || cConst > maxC) continue;

            const songName = String(row[0] || "不明な曲");
            const diff = String(row[1] || "");
            const fullTitle = diff ? `${songName} [${diff}]` : songName;

            if (!songAggregation[fullTitle]) {
                songAggregation[fullTitle] = {
                    count: 0, constant: cConst, players: [],
                    totalScoreAll: 0, totalCountAll: 0
                };
            }
            songAggregation[fullTitle].totalScoreAll += cScore;
            songAggregation[fullTitle].totalCountAll++;

            let isAchieved = true;
            if (cRating < minRating || cRating > maxRating) isAchieved = false;
            if (cScore < rMin || cScore > getUpperLimitGAS(rMax)) isAchieved = false;
            if (targetLamp !== 'all') {
                if (targetLamp === 'ajc' && !cLamp.includes('AJC')) isAchieved = false;
                else if (targetLamp === 'aj' && !cLamp.includes('AJ')) isAchieved = false;
                else if (targetLamp === 'None' && (cLamp.includes('AJ') || cLamp.includes('AJC'))) isAchieved = false;
            }

            if (isAchieved) {
                songAggregation[fullTitle].count++;
            }
            songAggregation[fullTitle].players.push({
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

    // 理論値（theoryCount）計算用のMasterDataループ
    let totalMatchingSongs = 0;
    const masterSheet = ss.getSheetByName("MasterData");
    if (masterSheet) {
        const masterData = masterSheet.getDataRange().getValues();
        for (let i = 1; i < masterData.length; i++) {
            const cConst = parseFloat(masterData[i][2]);
            const isNewStr = String(masterData[i][3] || "").toLowerCase().trim();
            if (cConst >= minC && cConst <= maxC) {
                if (typeFilter === 'all') totalMatchingSongs++;
                else if (typeFilter === 'new' && isNewStr === 'true') totalMatchingSongs++;
                else if (typeFilter === 'old' && isNewStr !== 'true') totalMatchingSongs++;
            }
        }
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
 * 特定のプレイヤーの詳細データを取得する
 */
function getPlayerDetailFromSheet(ss, playerName, params) {
    // ★修正ポイント4：詳細取得の際も名前の禁止文字を除去して検索できるように統一
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

    for (let j = 1; j < data.length; j++) {
        const row = data[j];
        if (!row || row.length < 7) continue;

        const cConst = parseFloat(row[2] || 0);
        const cScore = parseFloat(row[3] || 0);
        const cRating = parseFloat(row[4] || 0);
        const cLamp = String(row[5] || "");
        const isNewSongStr = String(row[6] || "").toLowerCase().trim();

        if (cConst < minC || cConst > maxC) continue;

        let passType = (typeFilter === 'all') || 
                       (typeFilter === 'new' && isNewSongStr === 'true') || 
                       (typeFilter === 'old' && isNewSongStr !== 'true');
        if (!passType) continue;

        let isAchieved = true;
        if (cRating < minRating || cRating > maxRating) isAchieved = false;
        if (cScore < rMin || cScore > getUpperLimitGAS(rMax)) isAchieved = false;
        if (targetLamp !== 'all') {
            if (targetLamp === 'ajc' && !cLamp.includes('AJC')) isAchieved = false;
            else if (targetLamp === 'aj' && !cLamp.includes('AJ')) isAchieved = false;
            else if (targetLamp === 'None' && (cLamp.includes('AJ') || cLamp.includes('AJC'))) isAchieved = false;
        }

        const songName = String(row[0] || "");
        const diff = String(row[1] || "");

        details.push({
            title: diff ? `${songName} [${diff}]` : songName,
            score: cScore,
            isAchieved: isAchieved
        });
    }
    return details.sort((a, b) => b.score - a.score);
}

function updateUserSheet(ss, name, records) {
    let sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    sheet.clear();

    const header = ["title", "diff", "const", "score", "rating", "lamp", "isNew"];
    sheet.appendRow(header);

    if (records && records.length > 0) {
        records.sort((a, b) => b.rating - a.rating);
        const rows = records.map(r => [
            String(r.title || ""),
            String(r.diff || ""),
            r.const || 0,
            r.score || 0,
            r.rating || 0,
            String(r.lamp || ""),
            String(r.isNew || "")
        ]);
        sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
    }
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
        throw new Error("chunirec API接続失敗 (Status: " + responseCode + ")。トークンが正しいか確認してください。");
    }

    const json = JSON.parse(res.getContentText());
    if (!json.records) {
        throw new Error("API取得失敗: レコードが見つかりません。トークンを確認してください。");
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