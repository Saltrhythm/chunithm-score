function doPost(e) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let logSheet = ss.getSheetByName("DebugLog") || ss.insertSheet("DebugLog");

    try {
        if (!e || !e.postData || !e.postData.contents) {
            throw new Error("リクエストデータが空です");
        }

        const params = JSON.parse(e.postData.contents);
        const mode = String(params.mode || "checker");

        // ログ記録
        logSheet.appendRow([new Date(), "POST受信", "Mode: " + mode]);

        // 1. ランキング取得モード（特定の曲の順位表）
        if (mode === "get_ranking") {
            const t = String(params.title || "");
            const d = String(params.diff || "");
            const results = getRankingFromSheets(ss, t, d, logSheet);
            return createJsonResponse({ status: "success", data: results });
        }

        // 2. 統計取得モード（条件に合う曲数のランキング）
        if (mode === "get_stats") {
            const results = getStatsFromSheets(ss, params);
            return createJsonResponse({ status: "success", data: results });
        }

        // 3. 同期/認証モード (checker)
        const token = String(params.token || "");
        let playerName = String(params.playerName || "");

        // 先にAPIからデータを取得（失敗すればここで中断）
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
            // トークンが見つからない場合、次に「同じプレイヤー名」が既に登録されていないか確認
            const sameNameIndex = userMapData.findIndex(row => row[1] === playerName);

            if (sameNameIndex !== -1) {
                // 【上書き処理】同じ名前が見つかった場合、その行のトークンハッシュを更新する
                userMapSheet.getRange(sameNameIndex + 1, 1).setValue(hashedToken);
                userRowIndex = sameNameIndex; // 既存ユーザーとして扱う
            } else if (!playerName) {
                // 名前も未入力なら入力を促す
                return createJsonResponse({ status: "need_name" });
            } else {
                // 名前もトークンも新しい場合、新規登録
                userMapSheet.appendRow([hashedToken, playerName]);
            }
        } else {
            // 既存のトークンが見つかった場合
            playerName = userMapData[userRowIndex][1];
        }

        // シートの作成・更新
        updateUserSheet(ss, playerName, records);

        return createJsonResponse({ status: "success", playerName: playerName, records: records });

    } catch (error) {
        logSheet.appendRow([new Date(), "ERROR", String(error.message || error)]);
        return createJsonResponse({ status: "error", message: error.toString() });
    }
}

/**
 * ランキング取得ロジック（徹底したnullガード版）
 */
function getRankingFromSheets(ss, title, diff, logSheet) {
    const userMapSheet = ss.getSheetByName("UserMap");
    if (!userMapSheet) return [];

    const userMap = userMapSheet.getDataRange().getValues();
    const results = [];

    const normalize = (str) => String(str || "").replace(/\s+/g, "").toLowerCase();
    const targetTitle = normalize(title);
    const targetDiff = normalize(diff);

    if (logSheet) {
        logSheet.appendRow([new Date(), "ランキング検索詳細", "Target: " + targetTitle + " / " + targetDiff]);
    }

    for (let i = 1; i < userMap.length; i++) {
        const name = String(userMap[i][1] || "");
        if (!name) continue;

        const sheet = ss.getSheetByName(name);
        if (!sheet) {
            results.push({ playerName: name, score: "-", lamp: "-" });
            continue;
        }

        const data = sheet.getDataRange().getValues();
        let match = null;

        for (let j = 1; j < data.length; j++) {
            if (normalize(data[j][0]) === targetTitle && normalize(data[j][1]) === targetDiff) {
                match = data[j];
                break;
            }
        }

        if (match) {
            // インデックス3:score, 5:lamp
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
 * 統計情報を取得
 */
function getStatsFromSheets(ss, params) {
    const userMapSheet = ss.getSheetByName("UserMap");
    if (!userMapSheet) return [];

    const userMap = userMapSheet.getDataRange().getValues();
    const results = [];

    // 楽曲別の集計用オブジェクト (key: 曲名, value: {count: 人数, const: 定数})
    const songAggregation = {};

    const minC = parseFloat(params.minConst || 0);
    const maxC = parseFloat(params.maxConst || 16.0);
    const minR = parseFloat(params.minRate || 0);
    const maxR = parseFloat(params.maxRate || 99.99);
    const rMin = parseFloat(params.rankMin || 0);
    const rMax = parseFloat(params.rankMax || 1010000);

    const targetLamp = params.lampFilter;
    const typeFilter = params.typeFilter;

    const masterSheet = ss.getSheetByName("MasterData"); // MasterDataシートから全曲数を計算
    let totalMatchingSongs = 0;

    if (masterSheet) {
        const masterData = masterSheet.getDataRange().getValues();
        const minC = parseFloat(params.minConst);
        const maxC = parseFloat(params.maxConst);
        const typeFilter = params.typeFilter;

        for (let i = 1; i < masterData.length; i++) {
            const cConst = parseFloat(masterData[i][2]); // 定数
            const isNew = masterData[i][3] === true || masterData[i][3] === "true"; // 新曲フラグ

            if (cConst >= minC && cConst <= maxC) {
                if (typeFilter === 'all') totalMatchingSongs++;
                else if (typeFilter === 'new' && isNew) totalMatchingSongs++;
                else if (typeFilter === 'old' && !isNew) totalMatchingSongs++;
            }
        }
    }

    for (let i = 1; i < userMap.length; i++) {
        const name = String(userMap[i][1] || "");
        const sheet = ss.getSheetByName(name);
        if (!sheet) continue;

        const data = sheet.getDataRange().getValues();
        let playerCount = 0;

        for (let j = 1; j < data.length; j++) {
            const row = data[j];
            const songName = String(row[0] || "不明な曲"); // A列がタイトル
            const diff = String(row[1] || "");           // B列が難易度

            // 集計用のキーを作成（例：Garakuta Doll Play [MAS]）
            const fullTitle = diff ? `${songName} [${diff}]` : songName;

            const cConst = parseFloat(row[2] || 0);
            const cScore = parseFloat(row[3] || 0);
            const cRating = parseFloat(row[4] || 0);
            const cLamp = String(row[5] || "");
            const isNewSong = !!row[6];

            if (cConst < minC || cConst > maxC) continue;
            if (cRating < minR || cRating > maxR) continue;
            if (typeFilter === 'new' && !isNewSong) continue;
            if (typeFilter === 'old' && isNewSong) continue;

            // ★修正：ランク範囲判定（スコア比較）
            // 下限以上、かつ上限区分の最大値（getUpperLimitGAS）以下
            if (cScore < rMin || cScore > getUpperLimitGAS(rMax)) continue;

            // ランプフィルタ
            if (targetLamp && targetLamp !== 'all') {
                if (targetLamp === 'ajc' && !cLamp.includes('AJC')) continue;
                if (targetLamp === 'aj' && !cLamp.includes('AJ')) continue;
                if (targetLamp === 'None' && cLamp.includes('AJ')) continue;
            }

            playerCount++;

            // ★楽曲別のカウンターを加算
            if (!songAggregation[fullTitle]) {
                songAggregation[fullTitle] = { count: 0, constant: cConst };
            }
            songAggregation[fullTitle].count++;
        }
        results.push({ playerName: name, count: playerCount });
    }

    // 楽曲別ランキングを配列に変換してソート
    const songRanking = Object.keys(songAggregation).map(t => {
        return { title: t, count: songAggregation[t].count, constant: songAggregation[t].constant };
    }).sort((a, b) => b.count - a.count);

    return {
        playerRanking: results.sort((a, b) => b.count - a.count), // 個人別
        songRanking: songRanking, // 楽曲別
        theoryCount: totalMatchingSongs, // 条件に合う全曲数
        totalUsers: userMap.length - 1   // 全ユーザー数
    };
}

/**
 * 補助関数：基準スコアのランク区分の「上限」を返す（GAS用）
 */
function getUpperLimitGAS(score) {
    if (score >= 1010000) return 1010001; // 理論値
    if (score >= 1009900) return 1010000; // 99AJ
    if (score >= 1009000) return 1009899; // SSS+
    if (score >= 1007500) return 1008999; // SSS
    if (score >= 1007000) return 1007499; // 7000
    if (score >= 1005000) return 1006999; // SS+
    if (score >= 1000000) return 1004999; // SS
    if (score >= 990000) return 999999;  // S+
    if (score >= 970000) return 989999;  // S
    return 969999;
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

    // --- 修正箇所：エラーハンドリングの強化 ---
    const res = UrlFetchApp.fetch(apiUrl, { "muteHttpExceptions": true });
    const responseCode = res.getResponseCode();

    if (responseCode !== 200) {
        // 403や401などのエラーコードが返ってきた場合、具体的なメッセージを投げる
        throw new Error("chunirec API接続失敗 (Status: " + responseCode + ")。トークンが正しいか確認してください。");
    }

    const json = JSON.parse(res.getContentText());
    if (!json.records) {
        throw new Error("API取得失敗: レコードが見つかりません。トークンを確認してください。");
    }
    // ---------------------------------------

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
    return 0; // 簡易化
}

function createJsonResponse(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj))
        .setMimeType(ContentService.MimeType.JSON);
}