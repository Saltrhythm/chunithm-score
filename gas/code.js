function doPost(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // デバッグ用ログシート（確実に取得・作成）
  let logSheet = ss.getSheetByName("DebugLog") || ss.insertSheet("DebugLog");

  try {
    // 1. リクエストデータの存在チェック
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("リクエストデータが空です");
    }

    const params = JSON.parse(e.postData.contents);
    const mode = params.mode || "checker";
    const token = params.token || "";
    let playerName = params.playerName || "";

    // ログ記録（null回避のために String 化）
    logSheet.appendRow([new Date(), "POST受信", "Mode: " + String(mode)]);

    // 2. トークンのハッシュ化
    const hashedToken = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)
      .map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');

    // --- 3. ユーザー情報の管理 ---
    let userMapSheet = ss.getSheetByName("UserMap") || ss.insertSheet("UserMap");
    if (userMapSheet.getLastRow() === 0) {
      userMapSheet.appendRow(["token_hash", "name"]);
    }

    const userMapData = userMapSheet.getDataRange().getValues();
    let userRow = userMapData.find(row => row[0] === hashedToken);

    if (!userRow && !playerName) {
      return createJsonResponse({ status: "need_name" });
    }

    if (!userRow && playerName) {
      userMapSheet.appendRow([hashedToken, String(playerName)]);
    } else if (userRow) {
      playerName = userRow[1];
    }

    // --- モード別の処理 ---

    // A. Checker機能 (同期)
    if (mode === "checker") {
      const records = fetchAndProcessFromApi(token, ss);
      updateUserSheet(ss, playerName, records);
      return createJsonResponse({
        status: "success",
        playerName: String(playerName),
        records: records
      });
    }

    // B. Ranking機能
    if (mode === "get_ranking") {
      const targetTitle = params.title || "";
      const targetDiff = params.diff || "";

      // 重要：logSheet を第4引数として渡すように修正
      const rankingData = getRankingFromSheets(ss, targetTitle, targetDiff, logSheet);

      return createJsonResponse({
        status: "success",
        data: rankingData
      });
    }

  } catch (error) {
    logSheet.appendRow([new Date(), "エラー発生", String(error.toString())]);
    return createJsonResponse({ status: "error", message: error.toString() });
  }
}

/**
 * ランキング取得ロジック
 */
function getRankingFromSheets(ss, title, diff, logSheet) {
  const userMapSheet = ss.getSheetByName("UserMap");
  if (!userMapSheet) return [];
  
  const userMap = userMapSheet.getDataRange().getValues();
  const results = [];
  
  const normalize = (str) => String(str || "").replace(/\s+/g, "").toLowerCase();
  const targetTitle = normalize(title);
  const targetDiff = normalize(diff);

  // logSheetがある場合のみログを出力
  if (logSheet) {
    logSheet.appendRow([new Date(), "ランキング検索詳細", "Target: " + targetTitle + " / " + targetDiff]);
  }

  for (let i = 1; i < userMap.length; i++) {
    const name = userMap[i][1];
    if (!name) continue;

    const sheet = ss.getSheetByName(name);
    if (!sheet) {
      results.push({ playerName: String(name), score: "-", lamp: "-" });
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
      results.push({ 
        playerName: String(name), 
        // インデックス3:score, 5:lamp (updateUserSheetの書き込み順に準拠)
        score: match[3] !== undefined && match[3] !== null ? match[3] : "-", 
        lamp: match[5] !== undefined && match[5] !== null ? String(match[5]) : "-"
      });
    } else {
      results.push({ playerName: String(name), score: "-", lamp: "-" });
    }
  }

  return results.sort((a, b) => {
    const sA = (a.score === "-" || !a.score) ? -1 : parseFloat(a.score);
    const sB = (b.score === "-" || !b.score) ? -1 : parseFloat(b.score);
    return sB - sA;
  });
}

// --- その他の補助関数 (fetchAndProcessFromApi, calculateChuniRating, updateUserSheet, createJsonResponse) は既存のものを維持 ---
// ※ updateUserSheet 内の records.map 部分でも String() で保護することをお勧めします。

function updateUserSheet(ss, name, records) {
  let sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  sheet.clear();

  const header = ["title", "diff", "const", "score", "rating", "lamp"];
  sheet.appendRow(header);

  if (records && records.length > 0) {
    records.sort((a, b) => b.rating - a.rating);
    const rows = records.map(r => [
      String(r.title || ""),
      String(r.diff || ""),
      r.const || 0,
      r.score || 0,
      r.rating || 0,
      String(r.lamp || "")
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
  const json = JSON.parse(res.getContentText());
  if (!json.records) throw new Error("API取得失敗");

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