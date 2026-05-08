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

    if (mode === "get_ranking") {
      // タイトルと難易度が空の場合のガード
      const t = String(params.title || "");
      const d = String(params.diff || "");
      
      const results = getRankingFromSheets(ss, t, d, logSheet);
      return createJsonResponse({ status: "success", data: results });
    }

    // --- 同期モード (checker) ---
    const token = String(params.token || "");
    let playerName = String(params.playerName || "");

    const hashedToken = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)
      .map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');

    let userMapSheet = ss.getSheetByName("UserMap") || ss.insertSheet("UserMap");
    if (userMapSheet.getLastRow() === 0) userMapSheet.appendRow(["token_hash", "name"]);

    const userMapData = userMapSheet.getDataRange().getValues();
    let userRow = userMapData.find(row => row[0] === hashedToken);

    if (!userRow && !playerName) {
      return createJsonResponse({ status: "need_name" });
    }

    if (!userRow && playerName) {
      userMapSheet.appendRow([hashedToken, playerName]);
    } else if (userRow) {
      playerName = userRow[1];
    }

    const records = fetchAndProcessFromApi(token, ss);
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
 * 残りの補助関数 (既存のまま)
 */
function fetchAndProcessFromApi(token, ss) {
  const apiUrl = `https://api.chunirec.net/2.0/records/showall.json?token=${token}&region=jp2`;
  const res = UrlFetchApp.fetch(apiUrl, { "muteHttpExceptions": true });
  const json = JSON.parse(res.getContentText());
  if (!json.records) return [];

  // NewSongs判定ロジックなどは以前のものを継承してください
  return json.records.map(r => ({
    title: r.title,
    diff: r.diff,
    const: parseFloat(r.const || 0),
    score: r.score,
    rating: 0, // 必要に応じて計算関数を呼ぶ
    lamp: r.score >= 1010000 ? "AJC" : r.is_alljustice ? "AJ" : r.is_fullcombo ? "FC" : "",
    isNew: false
  }));
}

function updateUserSheet(ss, name, records) {
  let sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  sheet.clear();
  const header = ["title", "diff", "const", "score", "rating", "lamp"];
  sheet.appendRow(header);
  if (records && records.length > 0) {
    const rows = records.map(r => [
      String(r.title || ""), String(r.diff || ""), r.const || 0, 
      r.score || 0, r.rating || 0, String(r.lamp || "")
    ]);
    sheet.getRange(2, 1, rows.length, 6).setValues(rows);
  }
}

function createJsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}