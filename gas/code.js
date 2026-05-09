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
 * 統計情報を取得
 */
function getStatsFromSheets(ss, params) {
  const userMapSheet = ss.getSheetByName("UserMap");
  if (!userMapSheet) return [];
  
  const userMap = userMapSheet.getDataRange().getValues();
  const results = [];

  const minC = parseFloat(params.minConst || 0);
  const maxC = parseFloat(params.maxConst || 16.0);
  const minR = parseFloat(params.minRate || 0);
  const maxR = parseFloat(params.maxRate || 99.99);
  const targetRank = params.rankFilter; 
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
    let count = 0;

    for (let j = 1; j < data.length; j++) {
      const row = data[j];
      const cConst = parseFloat(row[2] || 0); 
      const cScore = parseFloat(row[3] || 0); 
      const cRating = parseFloat(row[4] || 0);
      const cLamp = String(row[5] || "");     
      const isNewSong = !!row[6];

      if (cConst < minC || cConst > maxC) continue;
      if (cRating < minR || cRating > maxR) continue;
      if (typeFilter === 'new' && !isNewSong) continue;
      if (typeFilter === 'old' && isNewSong) continue;

      // ランクフィルタ (数値化して「以上」を判定)
      if (targetRank && targetRank !== 'all') {
        // 現在の行のスコアをランク数値に変換
        let currentRankValue = 0;
        if (cScore >= 1009000)      currentRankValue = 6; // sssplus
        else if (cScore >= 1007500) currentRankValue = 5; // sss
        else if (cScore >= 1005000) currentRankValue = 4; // ssplus
        else if (cScore >= 1000000) currentRankValue = 3; // ss
        else if (cScore >= 990000)  currentRankValue = 2; // splus
        else if (cScore >= 970000)  currentRankValue = 1; // s
        
        // ターゲット（選択されたランク）を数値に変換
        let targetRankValue = 0;
        switch(targetRank) {
          case 'sssplus': targetRankValue = 6; break;
          case 'sss':     targetRankValue = 5; break;
          case 'ssplus':  targetRankValue = 4; break;
          case 'ss':      targetRankValue = 3; break;
          case 'splus':   targetRankValue = 2; break;
          case 's':       targetRankValue = 1; break;
        }

        // 選択したランクの数値より低い場合は除外（「以上」の判定）
        if (currentRankValue < targetRankValue) continue;
      }

      // ランプフィルタ
      if (targetLamp && targetLamp !== 'all') {
        if (targetLamp === 'ajc' && !cLamp.includes('AJC')) continue;
        if (targetLamp === 'aj' && !cLamp.includes('AJ')) continue;
        if (targetLamp === 'None' && cLamp.includes('AJ')) continue;
      }

      count++;
    }
    results.push({ playerName: name, count: count });
  }
  return {
    ranking: results.sort((a, b) => b.count - a.count),
    theoryCount: totalMatchingSongs
  };
}

// --- その他の補助関数 (fetchAndProcessFromApi, calculateChuniRating, updateUserSheet, createJsonResponse) は既存のものを維持 ---
// ※ updateUserSheet 内の records.map 部分でも String() で保護することをお勧めします。

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