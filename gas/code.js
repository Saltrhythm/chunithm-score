/**
==========================================================================
バックエンド処理（code.gs）- スコア管理ツール専用（新機能対応・確定版）
==========================================================================
*/

// GETリクエスト（Web APIとしてのブラウザ直アクセスやプレフライト・疎通確認用）
function doGet(e) {
  return createJsonResponse({
    status: "success",
    message: "GAS Web App is running active."
  });
}

// POSTリクエスト
function doPost(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let logSheet = ss.getSheetByName("DebugLog");
  if (!logSheet) {
    try {
      logSheet = ss.insertSheet("DebugLog");
    } catch (err) {
      // シート作成権限等のエラー回避
      logSheet = null;
    }
  }

  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("リクエストデータが空です");
    }

    // JSONパースの安全対策
    let params;
    try {
      params = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      throw new Error("POSTボディのJSONパースに失敗しました: " + parseErr.message);
    }

    const mode = String(params.mode || params.action || "checker");
    const playerName = String(params.playerName || "").trim();

    // ビンゴデータ取得（一般ユーザー用）
    if (mode === "get_bingo" || mode === "get_bingo_data") {
      return getBingoData(false, playerName);
    }

    // ビンゴデータ取得（管理者用）
    if (mode === "get_admin_bingo" || mode === "get_admin_bingo_data") {
      return getBingoData(true, playerName);
    }

    // 前回の条件（ルール・プール設定）を取得
    if (mode === "get_last_rules" || mode === "get_last_bingo_rules") {
      return getLastBingoRules();
    }

    // 全楽曲・難易度・定数データの一括取得（高速化＆堅牢化版）
    if (mode === "get_all_songs") {
      const masterSheet = ss.getSheetByName("MasterData");
      if (!masterSheet) {
        return createJsonResponse({ status: "error", message: "MasterDataシートが見つかりません" });
      }

      const lastRow = masterSheet.getLastRow();
      if (lastRow <= 1) {
        return createJsonResponse({ status: "success", data: [] });
      }

      // A~C列のみをピンポイント取得（処理時間の短縮）
      const rangeValues = masterSheet.getRange(2, 1, lastRow - 1, 3).getValues();

      const songs = rangeValues
        .filter(row => row[0] && String(row[0]).trim() !== "")
        .map(row => ({
          title: String(row[0]).trim(),
          diff: String(row[1]).trim(),
          constant: parseFloat(row[2]) || 0
        }));

      return createJsonResponse({
        status: "success",
        data: songs
      });
    }

    // ビンゴ初期化
    if (mode === "init_bingo" || mode === "init_bingo_data") {
      return withLock(() => initBingoData(params.rules, params.conditionPool, params.centerTargetScore));
    }

    if (mode === "update_free_score") {
    return updateFreeCellScore(
        params.targetScore,
        params.currentScore,
        params.songTitle,
        params.addScore,
        params.clearedList // ★ 追加
    );
}

    // ビンゴの公開 / 非公開切り替え
    if (mode === "toggle_bingo_publish" || mode === "toggle_publish") {
      return withLock(() => toggleBingoPublish(params.isPublished));
    }
    
    // 単一マスオープン処理
    if (mode === "open_bingo_cell" || mode === "open_cell") {
      const idx = parseInt(params.cellIndex, 10);
      const cellCond = params.conditionData || params.condition || (params.updatedCells && params.updatedCells[idx]) || null;

      return withLock(() => openBingoCell(
        params.cellIndex, 
        params.song, 
        params.song2 || null, 
        params.conditionPool || params.updatedConditionPool, 
        cellCond
      ));
    }

    // 全25マスの一括配信更新
    if (mode === "update_all_bingo_cells" || mode === "update_all_cells" || mode === "bulk_open_bingo_cells") {
      return withLock(() => updateAllBingoCells(
        params.cells || params.updatedCells || params.newCells, 
        params.conditionPool || params.updatedConditionPool
      ));
    }

    // ビンゴマスの達成（手動クリア）記録
    if (mode === "clear_bingo_cell") {
      return withLock(() => clearBingoCell(params.cellIndex, params.playerName, params));
    }

    // ブックマークレットからの新曲・新ULT難易度スコア更新処理
    if (mode === "update_user_newsongs") {
      return withLock(() => {
        const pName = String(params.playerName || "").trim();
        const incomingScores = params.scores || [];

        if (!pName) {
          return createJsonResponse({ status: "error", message: "プレイヤー名が指定されていません" });
        }

        if (!incomingScores || incomingScores.length === 0) {
          return createJsonResponse({ status: "error", message: "スコアデータを受信できませんでした。" });
        }

        const masterSheet = ss.getSheetByName("MasterData");
        if (!masterSheet) {
          return createJsonResponse({ status: "error", message: "MasterDataシートが見つかりません" });
        }

        const masterData = masterSheet.getDataRange().getValues();
        const masterDataCache = {};

        const targetConstIdx = 2;    // C列
        const targetIsNewIdx = 3;    // D列
        const targetTairyokuIdx = 4; // E列
        const targetKenbanIdx = 5;   // F列
        const targetChuniIdx = 6;    // G列
        const targetKuseIdx = 7;     // H列
        const targetTrendIdx = 9;    // J列
        const targetNotesIdx = 11;   // L列

        if (masterData.length > 1) {
          const headerRow = masterData[0].map(h => String(h).toLowerCase().trim());
          const titleIdx = headerRow.findIndex(h => h.includes("title") || h.includes("曲名")) !== -1 ? headerRow.findIndex(h => h.includes("title") || h.includes("曲名")) : 0;
          const diffIdx = headerRow.findIndex(h => h.includes("diff") || h.includes("難易度")) !== -1 ? headerRow.findIndex(h => h.includes("diff") || h.includes("難易度")) : 1;

          for (let i = 1; i < masterData.length; i++) {
            const mRow = masterData[i];
            const mTitle = String(mRow[titleIdx] || "").trim();
            const mDiff = String(mRow[diffIdx] || "").trim();
            const key = `${mTitle}_${mDiff}`;

            if (mTitle && mDiff) {
              masterDataCache[key] = {
                title: mTitle,
                diff: mDiff,
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

        let userSheet = ss.getSheetByName(pName);
        if (!userSheet) {
          userSheet = ss.insertSheet(pName);
          userSheet.appendRow(["Title", "Diff", "Const", "Score", "Rating", "Lamp", "isNew", "Tairyoku", "Kenban", "Chuni", "Kuse", "MainTrend", "Notes"]);
        }

        const userValues = userSheet.getDataRange().getValues();
        const recordMap = new Map();

        if (userValues.length > 1) {
          for (let i = 1; i < userValues.length; i++) {
            const uRow = userValues[i];
            const uTitle = String(uRow[0] || "").replace(/^'/, "").trim();
            const uDiff = String(uRow[1] || "").trim();

            if (uTitle && uDiff) {
              const key = `${uTitle}_${uDiff}`;
              const masterInfo = masterDataCache[key] || {};

              const rowScore = parseInt(uRow[3] || 0, 10);
              const rowLamp = String(uRow[5] || "").trim();
              const scoreMod = calculateScoreModifier(rowScore, rowLamp);

              const finalConst = masterInfo.constant || parseFloat(uRow[2]) || 0;
              const finalNotes = masterInfo.notes || parseInt(uRow[12] || 0, 10) || 0;
              const isNewVal = (masterInfo.isNew || String(uRow[6] || "").toLowerCase().trim() === "true") ? "TRUE" : "";

              let finalMainTrend = "None";
              if (masterInfo.mainTrend && masterInfo.mainTrend !== "None") {
                finalMainTrend = masterInfo.mainTrend;
              } else if (uRow[11] && String(uRow[11]).trim() !== "" && String(uRow[11]).trim() !== "None") {
                finalMainTrend = String(uRow[11]).trim();
              }

              const rawT = masterInfo.tairyoku || 0;
              const rawK = masterInfo.kenban || 0;
              const rawC = masterInfo.chuni || 0;
              const rawKu = masterInfo.kuse || 0;

              recordMap.set(key, {
                title: uTitle,
                diff: uDiff,
                const: finalConst,
                score: rowScore,
                rating: calculateChuniRating(rowScore, finalConst),
                lamp: rowLamp,
                isNew: isNewVal,
                tairyoku: rawT > 0 ? Math.round(rawT * scoreMod * 100) / 100 : (parseFloat(uRow[7]) || 0),
                kenban:   rawK > 0 ? Math.round(rawK * scoreMod * 100) / 100 : (parseFloat(uRow[8]) || 0),
                chuni:    rawC > 0 ? Math.round(rawC * scoreMod * 100) / 100 : (parseFloat(uRow[9]) || 0),
                kuse:     rawKu > 0 ? Math.round(rawKu * scoreMod * 100) / 100 : (parseFloat(uRow[10]) || 0),
                rawTairyoku: rawT,
                rawKenban: rawK,
                rawChuni: rawC,
                rawKuse: rawKu,
                mainTrend: finalMainTrend,
                notes: finalNotes
              });
            }
          }
        }

        let updatedCount = 0;
        incomingScores.forEach(inc => {
          const incTitle = String(inc.title || "").trim();
          const incDiff = String(inc.diff || "").trim();
          const key = `${incTitle}_${incDiff}`;
          const masterInfo = masterDataCache[key];

          if (masterInfo) {
            const isAlreadyExists = recordMap.has(key);
            const isNewUlt = (incDiff === "ULT" && !isAlreadyExists);

            if (masterInfo.isNew || isNewUlt) {
              const newScore = parseInt(inc.score || 0, 10);
              const newLamp = String(inc.lamp || "").trim();
              const existing = recordMap.get(key);

              const existingScore = existing ? parseInt(existing.score || 0, 10) : -1;
              const existingLamp = existing ? String(existing.lamp || "").trim() : "";

              if (!existing || newScore > existingScore || newLamp !== existingLamp) {
                const c = masterInfo.constant;
                const scoreMod = calculateScoreModifier(newScore, newLamp);
                const rating = calculateChuniRating(newScore, c);

                const rawT = masterInfo.tairyoku || 0;
                const rawK = masterInfo.kenban || 0;
                const rawC = masterInfo.chuni || 0;
                const rawKu = masterInfo.kuse || 0;

                recordMap.set(key, {
                  title: masterInfo.title,
                  diff: masterInfo.diff,
                  const: c,
                  score: newScore,
                  rating: rating,
                  lamp: newLamp,
                  isNew: masterInfo.isNew ? "TRUE" : "",
                  tairyoku: Math.round(rawT * scoreMod * 100) / 100,
                  kenban:   Math.round(rawK * scoreMod * 100) / 100,
                  chuni:    Math.round(rawC * scoreMod * 100) / 100,
                  kuse:     Math.round(rawKu * scoreMod * 100) / 100,
                  rawTairyoku: rawT,
                  rawKenban: rawK,
                  rawChuni: rawC,
                  rawKuse: rawKu,
                  mainTrend: masterInfo.mainTrend,
                  notes: masterInfo.notes || 0
                });
                updatedCount++;
              }
            }
          }
        });

        const finalRecords = Array.from(recordMap.values());
        if (updatedCount > 0) {
          updateUserSheet(ss, pName, finalRecords);
          checkAndApplyBingoClears(ss, pName, finalRecords);
        }

        return createJsonResponse({
          status: "success",
          playerName: pName,
          updatedCount: updatedCount,
          records: finalRecords,
          message: updatedCount > 0 ? `${updatedCount}件のスコアを更新しました！` : "更新なし"
        });
      });
    }

    if (mode === "get_player_data") {
      const pName = String(params.playerName || "");
      const records = getPlayerDataByName(pName);
      return createJsonResponse({ status: "success", playerName: pName, records: records });
    }

    if (mode === "get_video_history") {
      const history = getVideoHistory(ss);
      return createJsonResponse({ status: "success", data: history });
    }

    if (mode === "add_video_request") {
      const res = addVideoRequestRow(ss, params.id, params.title, params.diff, params.requester, params.comment);
      return createJsonResponse(res);
    }

    if (mode === "add_video_supply") {
      const res = addVideoSupplyRow(ss, params.id, params.title, params.diff, params.contributor, params.videoUrl, params.videoTitle);
      return createJsonResponse(res);
    }

    if (mode === "delete_video_item") {
      const res = deleteVideoItemRow(ss, params.id, params.playerName);
      return createJsonResponse(res);
    }

    if (mode === "get_ranking") {
      const t = String(params.title || "");
      const d = String(params.diff || "");
      const results = getRankingFromSheets(ss, t, d, params, logSheet);
      const songProps = getSongPropsFromMaster(ss, t, d);
      const videoList = getVideosForSong(ss, t, d);

      return createJsonResponse({ status: "success", data: results, songProps: songProps, videoList: videoList });
    }

    if (mode === "get_stats") {
      const results = getStatsFromSheets(ss, params);
      return createJsonResponse({ status: "success", data: results });
    }

    if (mode === "get_player_detail") {
      const pName = String(params.playerName || "");
      const results = getPlayerDetailFromSheet(ss, pName, params);
      return createJsonResponse({ status: "success", data: results });
    }

    if (mode === "get_vs_players") {
      const playerNames = getAllPlayerNames();
      return createJsonResponse({ status: "success", players: playerNames });
    }

    if (mode === "get_vs_data") {
      const comparisonData = getVsDataFromSheets(ss, params);
      return createJsonResponse({ status: "success", data: comparisonData });
    }

    if (mode === "checker") {
return withLock(() => {
    // 💡 1. フロントエンドから2つの生トークンを取得（互換性のため params.token と params.chunirec_token の両方をケア）
    const rawChunirecToken = String(params.chunirec_token || params.token || "").trim();
    const rawSupportToken = String(params.chuniSupportToken || "").trim();

    // どちらのトークンも入力されていない場合のみエラー
    if (!rawChunirecToken && !rawSupportToken) {
      return createJsonResponse({ status: "error", message: "トークンを入力してください。" });
    }

    const userMapSheet = ss.getSheetByName("UserMap");
    if (!userMapSheet) {
      return createJsonResponse({ status: "error", message: "UserMapシートが見つかりません。管理者に問い合わせてください。" });
    }

    const userMapData = userMapSheet.getDataRange().getValues();

    let matchedRow = null;
    let validChunirecRawToken = "";
    let validSupportRawToken = "";

    // 💡 2-a. chunirec トークンが入力されている場合、A列で照合
    if (rawChunirecToken) {
      const bytesRec = Utilities.newBlob(rawChunirecToken).getBytes();
      const hashRec = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytesRec)
        .map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('').toLowerCase();

      for (let i = 1; i < userMapData.length; i++) {
        const sheetHashA = String(userMapData[i][0] || "").trim().toLowerCase(); // A列
        if (sheetHashA === hashRec) {
          matchedRow = userMapData[i];
          validChunirecRawToken = rawChunirecToken;
          break;
        }
      }
    }

    // 💡 2-b. chunisupport トークンが入力されている場合、D列で照合（またはユーザー補填）
    if (rawSupportToken) {
      const bytesSupp = Utilities.newBlob(rawSupportToken).getBytes();
      const hashSupp = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytesSupp)
        .map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('').toLowerCase();

      if (matchedRow) {
        // すでにchunirecでユーザーが特定できている場合：D列のハッシュが一致するか検証
        const sheetHashD = String(matchedRow[3] || "").trim().toLowerCase();
        if (sheetHashD && sheetHashD === hashSupp) {
          validSupportRawToken = rawSupportToken;
        } else {
          console.warn("chunisupportトークンが入力されましたが、UserMap(D列)の照合に失敗しました。");
        }
      } else {
        // chunirecトークンがなく、chunisupportのみ入力された場合：D列でユーザー特定
        for (let i = 1; i < userMapData.length; i++) {
          const sheetHashD = String(userMapData[i][3] || "").trim().toLowerCase(); // D列
          if (sheetHashD === hashSupp) {
            matchedRow = userMapData[i];
            validSupportRawToken = rawSupportToken;
            break;
          }
        }
      }
    }

    if (!matchedRow) {
      return createJsonResponse({
        status: "error",
        message: "未承認のユーザーです。ツールを利用するには管理者に承認（UserMapへの登録）を依頼してください。"
      });
    }

    const pName = String(matchedRow[1] || "").trim();
    if (!pName) {
      return createJsonResponse({ status: "error", message: "UserMap内のユーザー名設定が不正です。" });
    }

    // 💡 3. APIからデータ取得＆処理（検証済みの生トークンを渡す）
    const result = fetchAndProcessFromApi(validChunirecRawToken, validSupportRawToken, ss, pName);
    const records = result.records;

    updateUserSheet(ss, pName, records);
    checkAndApplyBingoClears(ss, pName, records);

    // 💡 4. Responseメッセージの構築
    let responseMessage = "データの更新が完了しました。";
    if (!result.usedChuniSupport) {
      responseMessage += "\n※最新のデータが必要な場合は、chunisupportのトークンの登録を管理者にお願いしてください。";
    }

    return createJsonResponse({
      status: "success",
      message: responseMessage,
      playerName: pName,
      usedChuniSupport: result.usedChuniSupport,
      records: records
    });
  });
}

    throw new Error("無効なモードが指定されました: " + mode);

  } catch (error) {
    console.error(error);
    if (logSheet) {
      try {
        logSheet.appendRow([new Date(), "ERROR", String(error.stack || error.message || error)]);
      } catch (e) {}
    }
    return createJsonResponse({ status: "error", message: error.toString() });
  }
}

/**
 * 共通レスポンス出力用関数
 * CORS等の不具合を防ぎ、常にアプリケーションレベルで安全な JSON を返却する
 */
function createJsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==========================================
// 排他制御ヘルパー
// ==========================================
function withLock(callback) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) {
        return createJsonResponse({ status: "error", message: "サーバーが混雑しています。少し時間を置いて再度お試しください。" });
    }
    try {
        return callback();
    } finally {
        lock.releaseLock();
    }
}

// ==========================================
// ビンゴ機能 バックエンド処理（中央24マス抽選対応版）
// ==========================================

/**
 * ビンゴデータ取得
 */
function getBingoData(isAdmin = false, playerName = "") {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const prop = PropertiesService.getScriptProperties().getProperty("BINGO_STATE");
  const state = prop ? JSON.parse(prop) : null;

  if (!state) {
    return createJsonResponse({ status: "success", data: null });
  }

  if (state.isPublished === undefined) {
    state.isPublished = false;
  }

  const userBestAvg = playerName ? getPlayerBestAvgFromUserMap(ss, playerName) : 0;

  // 管理者アクセス、または公開済みの場合は完全なデータを返却
  if (isAdmin || state.isPublished) {
    return createJsonResponse({
      status: "success",
      data: {
        ...state,
        userBestAvg: userBestAvg
      }
    });
  }

  // 一般ユーザーかつ非公開状態の場合のマスク処理
  const maskedCells = state.cells ? state.cells.map(cell => {
    // 中央の協力マスおよび通常のFREEマスは非公開時でもそのまま表示
    if (cell.isCenter || cell.id === 12 || cell.isFree) {
      return {
        ...cell,
        // FREEマスであっても非公開時は他者の達成者情報を秘匿したい場合はここで制御（現状はFREEマス情報を開示）
        clearedList: cell.clearedList || []
      };
    }

    // 未公開の通常マス・デカビンゴマスのマスク処理
    return {
      id: cell.id,
      isCenter: false,
      isFree: false,
      minConst1: cell.minConst1 !== undefined ? cell.minConst1 : (cell.minConst || 0),
      maxConst1: cell.maxConst1 !== undefined ? cell.maxConst1 : (cell.maxConst || 0),
      minConst2: cell.minConst2 !== undefined ? cell.minConst2 : null,
      maxConst2: cell.maxConst2 !== undefined ? cell.maxConst2 : null,
      condition: cell.condition || "",
      condition1: cell.condition1 || cell.condition || "",
      condition2: cell.condition2 || cell.condition || "",
      maxBestAvg: cell.maxBestAvg !== undefined ? cell.maxBestAvg : null,
      song: null,          // 非公開時は隠す
      song2: null,         // 非公開時は隠す
      songTitle: "",
      diff: "",
      const: 0,
      isOpened: Boolean(cell.isOpened),
      isCleared: Boolean(cell.isCleared),
      isBigCleared: Boolean(cell.isBigCleared),
      clearedList: []     // 非公開時は達成者情報をマスク
    };
  }) : [];

  return createJsonResponse({
    status: "success",
    data: {
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      isPublished: false,
      userBestAvg: userBestAvg,
      bingoCount: state.bingoCount || 0,
      bigBingoCount: state.bigBingoCount || 0,
      cells: maskedCells,
      conditionPool: state.conditionPool || []
    }
  });
}

/**
 * 前回の条件（設定済みルール）を取得
 */
function getLastBingoRules() {
  const prop = PropertiesService.getScriptProperties().getProperty("LAST_BINGO_RULES");
  const lastRules = prop ? JSON.parse(prop) : null;
  return createJsonResponse({ status: "success", data: lastRules });
}

/**
 * ビンゴ初期化
 */
function initBingoData(rules, conditionPool, centerTargetScore = 10000000) {
  if (!rules || !Array.isArray(rules) || rules.length !== 24) {
    return createJsonResponse({
      status: "error",
      message: "24マス分の条件（ルール）を配列で正しく設定してください。"
    });
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. 全プレイヤーの初期ハイスコアを BingoBaseline に保存
  let baseSheet = ss.getSheetByName("BingoBaseline");
  if (baseSheet) {
    baseSheet.clearContents();
  } else {
    baseSheet = ss.insertSheet("BingoBaseline");
  }
  baseSheet.appendRow(["PlayerName", "Key", "Score", "Lamp"]);

  const playerNames = getAllPlayerNames();
  const baselineRows = [];

  playerNames.forEach(pName => {
    const userSheet = ss.getSheetByName(pName);
    if (userSheet) {
      const values = userSheet.getDataRange().getValues();
      for (let i = 1; i < values.length; i++) {
        const title = String(values[i][0] || "").replace(/^'/, "").trim();
        const diff = String(values[i][1] || "").trim();
        const score = parseInt(values[i][3] || 0, 10);
        const lamp = String(values[i][5] || "").trim();
        if (title && diff) {
          baselineRows.push([pName, `${title}_${diff}`, score, lamp]);
        }
      }
    }
  });

  if (baselineRows.length > 0) {
    baseSheet.getRange(2, 1, baselineRows.length, 4).setValues(baselineRows);
  }

  // 2. 25マスの生成
  const cells = [];
  let ruleIdx = 0;

  for (let i = 0; i < 25; i++) {
    if (i === 12) {
      // 中央（インデックス12）：FREE協力マス
      const centerCell = {
        id: 12,
        isCenter: true,
        isFree: true,
        songTitle: "全員協力マス",
        diff: "",
        const: 0,
        isOpened: true,
        isCleared: true,
        isBigCleared: true,
        freeCurrentScore: 0,
        freeTargetScore: parseFloat(centerTargetScore) || 10000000,
        clearedList: [{ playerName: "SYSTEM", songIndex: "1", clearedAt: "FREE", isManual: true }]
      };
      if (typeof evaluateCellStatus === "function") {
        evaluateCellStatus(centerCell);
      }
      cells.push(centerCell);
    } else {
      const rule = rules[ruleIdx++];
      const isFreeCell = Boolean(rule.isFree);
      const cell = {
        id: i,
        isCenter: false,
        isFree: isFreeCell,
        minConst1: parseFloat(rule.minConst1 ?? rule.minConst ?? 0),
        maxConst1: parseFloat(rule.maxConst1 ?? rule.maxConst ?? 0),
        minConst2: (rule.minConst2 !== undefined && rule.minConst2 !== null && rule.minConst2 !== "") ? parseFloat(rule.minConst2) : null,
        maxConst2: (rule.maxConst2 !== undefined && rule.maxConst2 !== null && rule.maxConst2 !== "") ? parseFloat(rule.maxConst2) : null,
        condition: String(rule.condition || rule.condition1 || "SSS"),
        condition1: String(rule.condition1 || rule.condition || "SSS"),
        condition2: String(rule.condition2 || rule.condition || "SSS"),
        maxBestAvg: (rule.maxBestAvg !== undefined && rule.maxBestAvg !== null && rule.maxBestAvg !== "") ? parseFloat(rule.maxBestAvg) : null,
        song: null,
        song2: null,
        songTitle: isFreeCell ? "FREEマス" : "",
        diff: "",
        const: 0,
        isOpened: isFreeCell,
        isCleared: isFreeCell,
        isBigCleared: isFreeCell,
        clearedList: isFreeCell ? [{ playerName: "SYSTEM", songIndex: "1", clearedAt: "FREE", isManual: true }] : []
      };
      if (typeof evaluateCellStatus === "function") {
        evaluateCellStatus(cell);
      }
      cells.push(cell);
    }
  }

  const state = {
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isPublished: false,
    cells: cells,
    conditionPool: conditionPool || []
  };

  if (typeof reevaluateBingoState === "function") {
    reevaluateBingoState(state);
  }

  PropertiesService.getScriptProperties().setProperty("BINGO_STATE", JSON.stringify(state));
  PropertiesService.getScriptProperties().setProperty("LAST_BINGO_RULES", JSON.stringify({ rules, conditionPool }));

  return createJsonResponse({ status: "success", data: state });
}

/**
 * 全25マスの一括配信更新（中央マスは保持）
 */
function updateAllBingoCells(newCells, updatedConditionPool) {
  if (!newCells || !Array.isArray(newCells) || newCells.length !== 25) {
    return createJsonResponse({ status: "error", message: "25マス分のデータが不正です" });
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return createJsonResponse({ status: "error", message: "サーバーが混雑しています" });
  }

  try {
    const prop = PropertiesService.getScriptProperties().getProperty("BINGO_STATE");
    if (!prop) return createJsonResponse({ status: "error", message: "BINGO_STATEが存在しません。先にビンゴを初期化してください。" });

    const state = JSON.parse(prop);

    // 全マスの状態を一括マージ（中央マスは保持）
    state.cells = state.cells.map((cell, idx) => {
      if (idx === 12 || cell.isCenter) {
        return cell;
      }
      const inc = newCells[idx] || {};
      const min1 = inc.minConst1 ?? inc.minConst ?? cell.minConst1;
      const max1 = inc.maxConst1 ?? inc.maxConst ?? cell.maxConst1;

      const mergedCell = {
        ...cell,
        ...inc,
        minConst1: parseFloat(min1 || 0),
        maxConst1: parseFloat(max1 || 0),
        minConst2: inc.minConst2 !== undefined ? inc.minConst2 : cell.minConst2,
        maxConst2: inc.maxConst2 !== undefined ? inc.maxConst2 : cell.maxConst2,
        song: inc.song !== undefined ? inc.song : cell.song,
        song2: inc.song2 !== undefined ? inc.song2 : cell.song2,
        songTitle: inc.songTitle !== undefined ? String(inc.songTitle) : cell.songTitle,
        diff: inc.diff !== undefined ? String(inc.diff) : cell.diff,
        const: inc.const !== undefined ? parseFloat(inc.const || 0) : cell.const,
        isOpened: inc.isOpened !== undefined ? Boolean(inc.isOpened) : cell.isOpened
      };

      if (typeof evaluateCellStatus === "function") {
        evaluateCellStatus(mergedCell);
      }
      return mergedCell;
    });

    if (updatedConditionPool && Array.isArray(updatedConditionPool)) {
      state.conditionPool = updatedConditionPool;
    }

    if (typeof reevaluateBingoState === "function") {
      reevaluateBingoState(state);
    }

    state.updatedAt = new Date().toISOString();
    PropertiesService.getScriptProperties().setProperty("BINGO_STATE", JSON.stringify(state));

    return createJsonResponse({ status: "success", data: state });
  } catch (e) {
    return createJsonResponse({ status: "error", message: e.message });
  } finally {
    lock.releaseLock();
  }
}

/**
 * 公開 / 非公開状態切り替え
 */
function toggleBingoPublish(isPublished) {
  const prop = PropertiesService.getScriptProperties().getProperty("BINGO_STATE");
  if (!prop) return createJsonResponse({ status: "error", message: "BINGO_STATEが存在しません。" });

  const state = JSON.parse(prop);
  state.isPublished = Boolean(isPublished);
  state.updatedAt = new Date().toISOString();

  PropertiesService.getScriptProperties().setProperty("BINGO_STATE", JSON.stringify(state));
  return createJsonResponse({ status: "success", data: state });
}

/**
 * 単一マスのオープン処理（中央マス・FREEマスをガード）
 */
function openBingoCell(cellIndex, song, song2, updatedConditionPool, conditionData) {
  const idx = parseInt(cellIndex, 10);
  if (idx === 12) {
    return createJsonResponse({ status: "error", message: "中央マスは曲の個別設定対象外です" });
  }

  const prop = PropertiesService.getScriptProperties().getProperty("BINGO_STATE");
  if (!prop) return createJsonResponse({ status: "error", message: "BINGO_STATEが存在しません" });

  const state = JSON.parse(prop);
  const targetCell = state.cells ? state.cells[idx] : null;

  if (!targetCell) {
    return createJsonResponse({ status: "error", message: "指定されたマスが見つかりません" });
  }

  if (targetCell.isFree) {
    return createJsonResponse({ status: "error", message: "FREEマスは楽曲設定の対象外です" });
  }

  if (!song || !song.title) {
    return createJsonResponse({ status: "error", message: "1曲目の楽曲情報が不正です" });
  }

  // 条件データの安全な書き換え・保持
  if (conditionData && typeof conditionData === 'object' && !Array.isArray(conditionData)) {
    const minC1 = conditionData.minConst1 ?? conditionData.minConst;
    const maxC1 = conditionData.maxConst1 ?? conditionData.maxConst;
    const minC2 = conditionData.minConst2;
    const maxC2 = conditionData.maxConst2;

    targetCell.minConst1 = minC1 != null ? parseFloat(minC1) : 0;
    targetCell.maxConst1 = maxC1 != null ? parseFloat(maxC1) : 0;
    targetCell.minConst2 = (minC2 != null && minC2 !== "") ? parseFloat(minC2) : null;
    targetCell.maxConst2 = (maxC2 != null && maxC2 !== "") ? parseFloat(maxC2) : null;
    
    const cond1 = conditionData.condition1 || conditionData.condition || targetCell.condition1 || targetCell.condition || "";
    const cond2 = conditionData.condition2 || conditionData.condition || targetCell.condition2 || targetCell.condition || cond1;

    targetCell.condition = cond1;
    targetCell.condition1 = cond1;
    targetCell.condition2 = cond2;

    targetCell.maxBestAvg = conditionData.maxBestAvg ?? null;
    targetCell.conditionId = conditionData.id !== undefined ? conditionData.id : (targetCell.conditionId || null);
    targetCell.isWE = conditionData.isWE !== undefined ? Boolean(conditionData.isWE) : false;
    targetCell.isWE2 = conditionData.isWE2 !== undefined ? Boolean(conditionData.isWE2) : false;
  }

  // 1曲目設定
  targetCell.song = {
    title: String(song.title),
    diff: String(song.diff),
    const: parseFloat(song.const || 0)
  };
  
  // 2曲目設定（デカビンゴマスの場合）
  if (song2 && song2.title) {
    targetCell.song2 = {
      title: String(song2.title),
      diff: String(song2.diff),
      const: parseFloat(song2.const || 0)
    };
  } else {
    targetCell.song2 = null;
  }

  // 互換用フィールド
  targetCell.songTitle = String(song.title);
  targetCell.diff = String(song.diff);
  targetCell.const = parseFloat(song.const || 0);
  
  targetCell.isOpened = true;

  if (typeof evaluateCellStatus === "function") {
    evaluateCellStatus(targetCell);
  }

  // 残り条件プールの更新
  if (updatedConditionPool && Array.isArray(updatedConditionPool)) {
    state.conditionPool = updatedConditionPool;
  }

  if (typeof reevaluateBingoState === "function") {
    reevaluateBingoState(state);
  }

  state.updatedAt = new Date().toISOString();

  PropertiesService.getScriptProperties().setProperty("BINGO_STATE", JSON.stringify(state));
  return createJsonResponse({ status: "success", data: state });
}

/**
 * FREEマス（中央マス）のテキスト・目標・累計スコア・プレイヤーリストを一括更新
 */
function updateFreeCellScore(targetScore, currentScore, songTitle = "", addScore = null, clearedList = null) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return createJsonResponse({ status: "error", message: "処理が混雑しています" });
  }

  try {
    const prop = PropertiesService.getScriptProperties().getProperty("BINGO_STATE");
    if (!prop) return createJsonResponse({ status: "error", message: "BINGO_STATEが存在しません" });

    const state = JSON.parse(prop);
    const centerCell = state.cells ? state.cells[12] : null;

    if (!centerCell) return createJsonResponse({ status: "error", message: "中央マスが存在しません" });

    // 1. タイトル/課題名の更新
    if (songTitle) {
      centerCell.songTitle = String(songTitle);
      centerCell.title = String(songTitle);
    }

    // 2. 目標スコアの更新
    if (targetScore !== undefined && targetScore !== null) {
      centerCell.freeTargetScore = parseFloat(targetScore);
    }

    // 3. スコアの加算または上書き
    if (addScore !== undefined && addScore !== null) {
      const current = parseFloat(centerCell.freeCurrentScore || 0);
      centerCell.freeCurrentScore = current + parseFloat(addScore);
    } else if (currentScore !== undefined && currentScore !== null) {
      centerCell.freeCurrentScore = parseFloat(currentScore);
    }

    // 4. ★追加：clearedList（プレイヤー成果ログ）の更新
    if (clearedList && Array.isArray(clearedList)) {
      centerCell.clearedList = clearedList;
    }

    // 5. クリア判定と全体ビンゴ状態の再評価
    reevaluateBingoState(state);

    PropertiesService.getScriptProperties().setProperty("BINGO_STATE", JSON.stringify(state));

    return createJsonResponse({ status: "success", data: state });
  } catch (e) {
    return createJsonResponse({ status: "error", message: e.message });
  } finally {
    lock.releaseLock();
  }
}

/**
 * 手動クリア操作処理
 */
function clearBingoCell(cellIndex, playerName, params) {
  const idx = parseInt(cellIndex, 10);
  const pName = String(playerName || "").trim();

  if (isNaN(idx) || idx < 0 || idx > 24) {
    return createJsonResponse({ status: "error", message: "無効なマス番号（0〜24）です" });
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return createJsonResponse({ status: "error", message: "サーバーが混雑しています" });
  }

  try {
    const prop = PropertiesService.getScriptProperties().getProperty("BINGO_STATE");
    if (!prop) return createJsonResponse({ status: "error", message: "BINGO_STATEが存在しません" });

    const state = JSON.parse(prop);
    const cell = state.cells ? state.cells[idx] : null;

    if (!cell) return createJsonResponse({ status: "error", message: "指定されたマスが存在しません" });
    if (cell.isCenter || idx === 12) return createJsonResponse({ status: "error", message: "中央マスは updateFreeCellScore 関数をご利用ください" });

    cell.clearedList = cell.clearedList || [];

    const action = params && params.action ? params.action : 'add';
    const songIndex = String(params && params.songIndex ? params.songIndex : "1");

    const existingIdx = cell.clearedList.findIndex(item => {
      return String(item.playerName || "").trim().toLowerCase() === pName.toLowerCase() &&
             String(item.songIndex) === songIndex;
    });

    if (action === 'add') {
      const nowJst = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
      const newRecord = {
        playerName: pName,
        songIndex: songIndex,
        clearedAt: nowJst,
        songTitle: params && params.songTitle ? params.songTitle : "手動達成",
        diff: params && params.diff ? params.diff : "-",
        score: params && params.score ? parseInt(params.score, 10) : 0,
        lamp: params && params.lamp ? params.lamp : "MANUAL",
        isManual: true
      };

      if (existingIdx !== -1) {
        cell.clearedList[existingIdx] = newRecord;
      } else {
        cell.clearedList.push(newRecord);
      }
    } else if (action === 'remove') {
      if (existingIdx !== -1) {
        cell.clearedList.splice(existingIdx, 1);
      }
    }

    reevaluateBingoState(state);

    PropertiesService.getScriptProperties().setProperty("BINGO_STATE", JSON.stringify(state));

    return createJsonResponse({ status: "success", data: state });

  } catch (e) {
    return createJsonResponse({ status: "error", message: e.message });
  } finally {
    lock.releaseLock();
  }
}

/**
 * 達成条件判定ロジック
 */
function checkBingoConditionMet(condition, score, lamp) {
  if (score < 0) return false;
  const l = String(lamp || "").toUpperCase().trim();
  const isAJ = l.includes("AJ") || l.includes("ALL JUSTICE");

  switch (condition) {
    case "THEORY":   return score >= 1010000;
    case "AJ_995":   return isAJ && score >= 1009950;
    case "AJ_99":    return isAJ && score >= 1009900;
    case "AJ":       return isAJ;
    case "SSS_PLUS": return score >= 1009000;
    case "8500":
    case "SSS_8500": return score >= 1008500;
    case "8000":
    case "SSS_8000": return score >= 1008000;
    case "SSS":      return score >= 1007500;
    case "7000":     return score >= 1007000;
    case "5000":
    case "SS_PLUS":  return score >= 1005000;
    case "SS":       return score >= 1000000;
    default:         return false;
  }
}

/**
 * スコア自動同期時のクリア判定処理
 */
function checkAndApplyBingoClears(ss, playerName, updatedScores) {
  const prop = PropertiesService.getScriptProperties().getProperty("BINGO_STATE");
  if (!prop) return;

  const state = JSON.parse(prop);
  if (!state.cells) return;

  const playerBestAvg = getPlayerBestAvgFromUserMap(ss, playerName);
  let stateChanged = false;

  const baseSheet = ss.getSheetByName("BingoBaseline");
  const baseData = baseSheet ? baseSheet.getDataRange().getValues() : [];

  const baseMap = new Map();
  for (let i = 1; i < baseData.length; i++) {
    const pName = String(baseData[i][0]).trim();
    const key = String(baseData[i][1]).trim();
    if (pName === playerName) {
      baseMap.set(key, {
        score: parseInt(baseData[i][2] || 0, 10),
        lamp: String(baseData[i][3] || "").trim()
      });
    }
  }

  const nowJst = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

  state.cells.forEach((cell, idx) => {
    if (cell.isFree || cell.isCenter || idx === 12 || !cell.isOpened) return;

    if (cell.maxBestAvg && playerBestAvg > parseFloat(cell.maxBestAvg)) return;

    cell.clearedList = cell.clearedList || [];

    const song1 = cell.song || (cell.songTitle ? { title: cell.songTitle, diff: cell.diff } : null);
    const song2 = cell.song2 || null;

    const songs = [];
    if (song1 && song1.title) songs.push({ ...song1, cond: cell.condition1 || cell.condition, songIndex: "1" });
    if (song2 && song2.title) songs.push({ ...song2, cond: cell.condition2 || cell.condition, songIndex: "2" });

    songs.forEach(song => {
      const matchInc = updatedScores.find(inc =>
        String(inc.title || "").trim() === String(song.title || "").trim() &&
        String(inc.diff || "").trim() === String(song.diff || "").trim()
      );

      if (matchInc) {
        const currentScore = parseInt(matchInc.score || 0, 10);
        const currentLamp = String(matchInc.lamp || "").trim();

        const targetKey = `${song.title}_${song.diff}`;
        const baseInfo = baseMap.get(targetKey) || { score: -1, lamp: "" };

        const isMetNow = checkBingoConditionMet(song.cond, currentScore, currentLamp);
        const isNewRecord = currentScore > baseInfo.score;

        if (isMetNow && isNewRecord) {
          const existingIdx = cell.clearedList.findIndex(item =>
            String(item.playerName || "").trim().toLowerCase() === playerName.toLowerCase() &&
            String(item.songIndex) === String(song.songIndex)
          );

          const newRecord = {
            playerName: playerName,
            clearedAt: nowJst,
            songTitle: song.title,
            diff: song.diff,
            score: currentScore,
            lamp: currentLamp,
            songIndex: String(song.songIndex)
          };

          if (existingIdx !== -1) {
            if (currentScore > (cell.clearedList[existingIdx].score || 0)) {
              cell.clearedList[existingIdx] = newRecord;
              stateChanged = true;
            }
          } else {
            cell.clearedList.push(newRecord);
            stateChanged = true;
          }
        }
      }
    });

    const oldCleared = cell.isCleared;
    const oldBigCleared = cell.isBigCleared;
    evaluateCellStatus(cell);

    if (oldCleared !== cell.isCleared || oldBigCleared !== cell.isBigCleared) {
      stateChanged = true;
    }
  });

  if (stateChanged) {
    reevaluateBingoState(state);
    PropertiesService.getScriptProperties().setProperty("BINGO_STATE", JSON.stringify(state));
  }
}

/**
 * 1つのマスのクリア状態（isCleared / isBigCleared）を評価・更新
 */
function evaluateCellStatus(cell) {
  // 1. 中央協力マスの判定
  if (cell.isCenter || cell.id === 12) {
    const target = parseFloat(cell.freeTargetScore || 0);
    const current = parseFloat(cell.freeCurrentScore || 0);
    const isMet = target > 0 && current >= target;

    cell.isCleared = true;     // 通常クリアは常時ON
    cell.isBigCleared = isMet; // 目標スコア達成でデカクリア
    return;
  }

  // 2. 通常のFREEマスの判定
  if (cell.isFree) {
    cell.isCleared = true;
    cell.isBigCleared = true;
    return;
  }

  // 3. 通常マスの判定
  const clearedList = cell.clearedList || [];
  const hasSong1Clear = clearedList.some(item => String(item.songIndex) === "1");
  const hasSong2Clear = clearedList.some(item => String(item.songIndex) === "2");
  const hasSong2Configured = Boolean(cell.song2 && cell.song2.title);

  // 【クリア】1曲でも達成者がいればOK
  cell.isCleared = clearedList.length > 0;

  // 【デカクリア】全設定曲の達成者が揃えばOK
  if (hasSong2Configured) {
    cell.isBigCleared = hasSong1Clear && hasSong2Clear;
  } else {
    cell.isBigCleared = hasSong1Clear;
  }
}

/**
 * 盤面全体のビンゴ・デカビンゴの達成ライン数を算出
 */
function calculateBingoStats(cells) {
  if (!cells || cells.length !== 25) return { bingoCount: 0, bigBingoCount: 0 };

  const lines = [
    // 横5行
    [0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13, 14], [15, 16, 17, 18, 19], [20, 21, 22, 23, 24],
    // 縦5列
    [0, 5, 10, 15, 20], [1, 6, 11, 16, 21], [2, 7, 12, 17, 22], [3, 8, 13, 18, 23], [4, 9, 14, 19, 24],
    // 斜め2本
    [0, 6, 12, 18, 24], [4, 8, 12, 16, 20]
  ];

  let bingoCount = 0;
  let bigBingoCount = 0;

  lines.forEach(line => {
    const isBingoLine = line.every(idx => cells[idx] && cells[idx].isCleared);
    const isBigBingoLine = line.every(idx => cells[idx] && cells[idx].isBigCleared);

    if (isBingoLine) bingoCount++;
    if (isBigBingoLine) bigBingoCount++;
  });

  return { bingoCount, bigBingoCount };
}

/**
 * [内部用] 盤面全体のマス評価とビンゴ数を一括再計算
 */
function reevaluateBingoState(state) {
  if (!state || !state.cells) return;
  
  state.cells.forEach(cell => evaluateCellStatus(cell));
  const stats = calculateBingoStats(state.cells);
  state.bingoCount = stats.bingoCount;
  state.bigBingoCount = stats.bigBingoCount;
  state.updatedAt = new Date().toISOString();
}

/**
 * 補助関数：UserMapシートのB列(playerName)を検索し、C列(ベスト枠平均)を取得
 */
function getPlayerBestAvgFromUserMap(ss, playerName) {
    const mapSheet = ss.getSheetByName("UserMap");
    if (!mapSheet) return 0;

    const data = mapSheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
        const pName = String(data[i][1] || "").trim(); // B列 (インデックス 1)
        if (pName === playerName) {
            return parseFloat(data[i][2] || 0);      // C列 (インデックス 2)
        }
    }
    return 0;
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
    const userSheet = ss.getSheetByName(playerName);
    if (!userSheet) return [];

    // MasterDataから最新のノーツ数、Trend、および生の能力定数をキャッシュ
    const masterSheet = ss.getSheetByName("MasterData");
    const masterCache = {};
    if (masterSheet) {
        const masterData = masterSheet.getDataRange().getValues();
        if (masterData.length > 1) {
            for (let i = 1; i < masterData.length; i++) {
                const mRow = masterData[i];
                const mTitle = String(mRow[0] || "").trim();
                const mDiff = String(mRow[1] || "").trim();
                const key = `${mTitle}_${mDiff}`;
                
                masterCache[key] = {
                    notes: parseInt(mRow[11] || 0, 10), // 💡 L列(index 11) = ノーツ数
                    mainTrend: String(mRow[9] || "None").trim(), // 💡 J列(index 9) = mainTrend
                    isNew: (String(mRow[3] || "").toLowerCase().trim() === "true"), // 💡 D列(index 3) = isNew
                    // 💡 追加: 生の能力定数 (E列〜H列: index 4〜7)
                    rawTairyoku: parseFloat(mRow[4] || 0),
                    rawKenban:   parseFloat(mRow[5] || 0),
                    rawChuni:    parseFloat(mRow[6] || 0),
                    rawKuse:     parseFloat(mRow[7] || 0)
                };
            }
        }
    }

    const values = userSheet.getDataRange().getValues();
    if (values.length <= 1) return [];

    const records = [];
    for (let i = 1; i < values.length; i++) {
        const row = values[i];
        const title = String(row[0] || "").replace(/^'/, "").trim();
        const diff = String(row[1] || "").trim();
        const key = `${title}_${diff}`;
        const masterInfo = masterCache[key] || {};

        records.push({
            title: title,
            diff: diff,
            const: parseFloat(row[2]) || 0,
            score: parseInt(row[3] || 0, 10),
            rating: parseFloat(row[4]) || 0,
            lamp: String(row[5] || "").trim(),
            isNew: masterInfo.isNew !== undefined ? (masterInfo.isNew ? "TRUE" : "") : String(row[6] || ""),
            tairyoku: parseFloat(row[7]) || 0,
            kenban: parseFloat(row[8]) || 0,
            chuni: parseFloat(row[9]) || 0,
            kuse: parseFloat(row[10]) || 0,
            // 💡 追加: 生定数をレスポンスに含める
            rawTairyoku: masterInfo.rawTairyoku || 0,
            rawKenban:   masterInfo.rawKenban || 0,
            rawChuni:    masterInfo.rawChuni || 0,
            rawKuse:     masterInfo.rawKuse || 0,
            mainTrend: masterInfo.mainTrend || String(row[11] || "None"),
            notes: masterInfo.notes || parseInt(row[12] || 0, 10) || 0
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
 * 💡 ユーザーシートの更新
 */
function updateUserSheet(ss, playerName, records) {
    let sheet = ss.getSheetByName(playerName);
    if (!sheet) {
        sheet = ss.insertSheet(playerName);
    }

    if (sheet.getLastRow() === 0) {
        sheet.appendRow([
            "Title", "Diff", "Const", "Score", "Rating", "Lamp", 
            "isNew", "Tairyoku", "Kenban", "Chuni", "Kuse", "MainTrend", "Notes"
        ]);
    }

    const rows = records.map(r => [
        "'" + r.title,
        r.diff,
        r.const || 0,
        r.score || 0,
        r.rating || 0,
        r.lamp || "",
        r.isNew || "",
        r.tairyoku || 0,
        r.kenban || 0,
        r.chuni || 0,
        r.kuse || 0,
        r.mainTrend || "None",
        r.notes || 0 // 13列目(M列)にノーツ数を保存
    ]);

    if (sheet.getLastRow() > 1) {
        sheet.getRange(2, 1, sheet.getLastRow() - 1, 13).clearContent();
    }
    
    if (rows.length > 0) {
        sheet.getRange(2, 1, rows.length, 13).setValues(rows);
    }
}

/**
 * 💡 通常譜面は chunisupport（優先）/ chunirec、WORLD'S END は chunirec から取得
 */
function fetchAndProcessFromApi(chunirecToken, chuniSupportToken, ss, playerName) {
  const masterSheet = ss.getSheetByName("MasterData");
  const masterDataCache = {};
  
  const targetConstIdx = 2;    
  const targetIsNewIdx = 3;    
  const targetTairyokuIdx = 4; 
  const targetKenbanIdx = 5;   
  const targetChuniIdx = 6;    
  const targetKuseIdx = 7;     
  const targetTrendIdx = 9;    
  const targetNotesIdx = 11;

  // 1. MasterData の取得とキャッシュ化
  if (masterSheet) {
    const masterData = masterSheet.getDataRange().getValues();
    if (masterData.length > 1) {
      const headerRow = masterData[0].map(h => String(h).toLowerCase().trim());
      const titleIdx = headerRow.findIndex(h => h.includes("title") || h.includes("曲名")) !== -1 ? headerRow.findIndex(h => h.includes("title") || h.includes("曲名")) : 0;
      const diffIdx = headerRow.findIndex(h => h.includes("diff") || h.includes("難易度")) !== -1 ? headerRow.findIndex(h => h.includes("diff") || h.includes("難易度")) : 1;

      for (let i = 1; i < masterData.length; i++) {
        const mRow = masterData[i];
        const mTitle = String(mRow[titleIdx] || "").trim();
        const mDiff = String(mRow[diffIdx] || "").trim();
        const mFullKey = mDiff ? `${mTitle}_${mDiff}` : mTitle;

        if (mTitle && mDiff) {
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
  }

  let apiRecords = [];
  let isApiAvailable = false;
  let usedChuniSupport = false;

  // 2-a. 通常譜面: 検証済み chunisupport トークンがあれば最優先で取得
  if (chuniSupportToken) {
    const chunisupportUrl = "https://api.chunisupport.net/compat/chunirec/2.0/records/showall";
    try {
      const resSupport = UrlFetchApp.fetch(chunisupportUrl, {
        "method": "GET",
        "headers": {
          "Authorization": "Bearer " + chuniSupportToken
        },
        "muteHttpExceptions": true
      });

      if (resSupport.getResponseCode() === 200) {
        const jsonSupport = JSON.parse(resSupport.getContentText());
        if (jsonSupport.records && Array.isArray(jsonSupport.records)) {
          apiRecords = apiRecords.concat(jsonSupport.records);
          usedChuniSupport = true;
          isApiAvailable = true;
        }
      } else {
        console.warn("chunisupport API Error: " + resSupport.getResponseCode() + " / " + resSupport.getContentText());
      }
    } catch (e) {
      console.warn("chunisupport API取得例外: " + e.toString());
    }
  }

  // 2-b. 通常譜面: chunisupport で取得できなかった場合、かつ chunirec トークンがある場合は chunirec から代替取得
  if (!usedChuniSupport && chunirecToken) {
    const normalApiUrl = `https://api.chunirec.net/2.0/records/showall.json?token=${chunirecToken}&region=jp2`;
    try {
      const resNormal = UrlFetchApp.fetch(normalApiUrl, { "muteHttpExceptions": true });
      if (resNormal.getResponseCode() === 200) {
        const jsonNormal = JSON.parse(resNormal.getContentText());
        if (jsonNormal.records && Array.isArray(jsonNormal.records)) {
          apiRecords = apiRecords.concat(jsonNormal.records);
          isApiAvailable = true;
        }
      }
    } catch (e) {
      console.warn("chunirec 通常譜面API取得例外: " + e.toString());
    }
  }

  // 3. WORLD'S END（WE）譜面: chunirec トークンがある場合のみ取得
  if (chunirecToken) {
    const weApiUrl = `https://api.chunirec.net/2.0/records/worldsend.json?token=${chunirecToken}&region=jp2`;
    try {
      const resWe = UrlFetchApp.fetch(weApiUrl, { "muteHttpExceptions": true });
      if (resWe.getResponseCode() === 200) {
        const jsonWe = JSON.parse(resWe.getContentText());
        if (jsonWe && jsonWe.records && Array.isArray(jsonWe.records)) {
          const playedWe = jsonWe.records.filter(rec => rec.is_played === true);
          apiRecords = apiRecords.concat(playedWe);
          isApiAvailable = true;
        }
      } else {
        console.warn(`WE譜面取得スキップ (ステータスコード: ${resWe.getResponseCode()})`);
      }
    } catch (e) {
      console.warn("WE譜面取得中に例外発生（通常譜面の処理は続行します）: " + e.toString());
    }
  }

  // 4. API障害時のフォールバック処理 (どちらのAPIも成功しなかった場合)
  if (!isApiAvailable || apiRecords.length === 0) {
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

  // 5. API取得レコードの整形
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

    const c = masterInfo.constant || parseFloat(r.const || 0);
    const isNewSong = masterInfo.isNew;
    const notes = masterInfo.notes || r.notes || 0;

    let lamp = isApiAvailable 
      ? (r.score >= 1010000 ? "AJC" : r.is_alljustice ? "AJ" : r.is_fullcombo ? "FC" : "") 
      : (r.lamp || "");

    const scoreMod = calculateScoreModifier(r.score, lamp);

    return {
      title: r.title,
      diff: r.diff,
      const: c,
      score: r.score,
      rating: calculateChuniRating(r.score, c),
      lamp: lamp,
      isNew: isNewSong ? "TRUE" : "",
      notes: notes,
      
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

  // 6. 個人シートからの既存データ復元 ＆ MasterDataによる欠損情報の補填マージ
  const userSheet = ss.getSheetByName(playerName);
  const mergedMap = new Map();

  if (userSheet) {
    const userValues = userSheet.getDataRange().getValues();
    if (userValues.length > 1) {
      for (let i = 1; i < userValues.length; i++) {
        const uRow = userValues[i];
        const uTitle = String(uRow[0] || "").replace(/^'/, "").trim();
        const uDiff = String(uRow[1] || "").trim();

        if (uTitle && uDiff) {
          const key = `${uTitle}_${uDiff}`;
          const masterInfo = masterDataCache[key] || {};

          const rowScore = parseInt(uRow[3] || 0, 10);
          const rowLamp = String(uRow[5] || "");
          const scoreMod = calculateScoreModifier(rowScore, rowLamp);

          const finalConst = masterInfo.constant || parseFloat(uRow[2]) || 0;
          const finalNotes = masterInfo.notes || parseInt(uRow[12] || 0, 10) || 0;
          const isNewVal = (masterInfo.isNew || String(uRow[6] || "").toLowerCase().trim() === "true") ? "TRUE" : "";
          
          let finalMainTrend = "None";
          if (masterInfo.mainTrend && masterInfo.mainTrend !== "None") {
            finalMainTrend = masterInfo.mainTrend;
          } else if (uRow[11] && String(uRow[11]).trim() !== "" && String(uRow[11]).trim() !== "None") {
            finalMainTrend = String(uRow[11]).trim();
          }

          const rawT = masterInfo.tairyoku || 0;
          const rawK = masterInfo.kenban || 0;
          const rawC = masterInfo.chuni || 0;
          const rawKu = masterInfo.kuse || 0;

          mergedMap.set(key, {
            title: uTitle,
            diff: uDiff,
            const: finalConst,
            score: rowScore,
            rating: calculateChuniRating(rowScore, finalConst),
            lamp: rowLamp,
            isNew: isNewVal,
            tairyoku: rawT > 0 ? Math.round(rawT * scoreMod * 100) / 100 : (parseFloat(uRow[7]) || 0),
            kenban:   rawK > 0 ? Math.round(rawK * scoreMod * 100) / 100 : (parseFloat(uRow[8]) || 0),
            chuni:    rawC > 0 ? Math.round(rawC * scoreMod * 100) / 100 : (parseFloat(uRow[9]) || 0),
            kuse:     rawKu > 0 ? Math.round(rawKu * scoreMod * 100) / 100 : (parseFloat(uRow[10]) || 0),
            rawTairyoku: rawT,
            rawKenban: rawK,
            rawChuni: rawC,
            rawKuse: rawKu,
            mainTrend: finalMainTrend,
            notes: finalNotes
          });
        }
      }
    }
  }

  // 7. API取得の最新データで上書き
  processedRecords.forEach(r => {
    const key = `${r.title}_${r.diff}`;
    mergedMap.set(key, r);
  });

  return {
    records: Array.from(mergedMap.values()),
    usedChuniSupport: usedChuniSupport
  };
}

/**
 * 💡 スコア補正値計算（④の2段階加速 ＆ 1,007,500手前強化版）
 */
function calculateScoreModifier(score, lamp) {
    // ① 990,000点未満は一律 0.0 倍
    if (score < 990000) return 0.0;
    
    let modifier = 0.0;
    
    // ② 990,000 〜 1,000,000点（倍率：0.00 から 0.10 へ）
    if (score >= 990000 && score < 1000000) {
        modifier = 0.00 + (score - 990000) * (0.10 / 10000);
    }
    // ③ 1,000,000 〜 1,005,000点（倍率：0.10 から 0.40 へ）
    else if (score >= 1000000 && score < 1005000) {
        modifier = 0.10 + (score - 1000000) * (0.30 / 5000);
    }
    // ④-a 1,005,000 〜 1,006,250点（倍率：0.40 から 0.95 へ【上昇幅: 0.55】）
    else if (score >= 1005000 && score < 1006250) {
        modifier = 0.40 + (score - 1005000) * (0.55 / 1250);
    }
    // ④-b 1,006,250 〜 1,007,500点（倍率：0.95 から 1.60 へ【上昇幅: 0.65 に加速】）
    else if (score >= 1006250 && score < 1007500) {
        modifier = 0.95 + (score - 1006250) * (0.65 / 1250);
    }
    // ⑤ 1,007,500 〜 1,009,000点（倍率：1.60 から 2.10 へ【上昇幅を 0.55 → 0.50 にわずかに減少】）
    else if (score >= 1007500 && score < 1009000) {
        modifier = 1.60 + (score - 1007500) * (0.50 / 1500);
    }
    // ⑥ 1,009,000 〜 1,010,000点（倍率：2.10 から 2.45 へ【上昇幅を 0.40 → 0.35 にわずかに減少】）
    else {
        modifier = 2.10 + (score - 1009000) * (0.35 / 1000);
    }
    
    // ⑦ AJ（All Justice / AJC含む）の時にボーナス（+0.05倍）を付与（理論値AJで 2.50倍）
    const currentLamp = String(lamp || "");
    if (currentLamp.includes("AJ") || currentLamp.includes("AJC")) {
        modifier += 0.05;
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
 * 💡 [管理者用] 全プレイヤーシートの「能力値4列 (H〜K列)」のみを高速＆正確に一括更新
 */
function updateAllPlayerAbilitiesOnly() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. UserMapから対象プレイヤー名の一覧を取得
  const playerNames = getAllPlayerNames();
  if (playerNames.length === 0) {
    Logger.log("⚠️ 更新対象のプレイヤーが存在しません (UserMapシートを確認してください)。");
    return;
  }

  // 2. MasterData から生定数を読み込み、Map構造体（高速ルックアップ用）に格納
  const masterSheet = ss.getSheetByName("MasterData");
  if (!masterSheet) {
    Logger.log("❌ MasterData シートが見つかりません。");
    return;
  }

  const masterData = masterSheet.getDataRange().getValues();
  if (masterData.length <= 1) return;

  // 💡 連想配列ではなく ES6 Map を使用してループ内の検索処理を高速化
  const masterMap = new Map();
  for (let i = 1; i < masterData.length; i++) {
    const mRow = masterData[i];
    const mTitle = String(mRow[0] || "").trim();
    const mDiff = String(mRow[1] || "").trim();
    
    if (mTitle && mDiff) {
      const key = `${mTitle}_${mDiff}`;
      masterMap.set(key, {
        tairyoku: parseFloat(mRow[4] || 0), // E列
        kenban:   parseFloat(mRow[5] || 0), // F列
        chuni:    parseFloat(mRow[6] || 0), // G列
        kuse:     parseFloat(mRow[7] || 0)  // H列
      });
    }
  }

  let updatedCount = 0;

  // 3. 取得したプレイヤー一覧に基づいて順番に更新処理
  playerNames.forEach(playerName => {
    const sheet = ss.getSheetByName(playerName);
    
    // シートが存在しない場合はログを出して安全にスキップ
    if (!sheet) {
      Logger.log(`⚠️ シート「${playerName}」が見つからないためスキップしました。`);
      return;
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return; // データ行が無い場合はスキップ

    // 💡 読み込み範囲を必要な 1〜11列（A列 Title ～ K列 Kuse）だけに限定して通信量を削減
    const range = sheet.getRange(2, 1, lastRow - 1, 11);
    const values = range.getValues();

    const abilityRows = [];

    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      const title = String(row[0] || "").replace(/^'/, "").trim(); // A列: Title
      const diff = String(row[1] || "").trim();                   // B列: Diff
      const score = parseInt(row[3] || 0, 10);                    // D列: Score
      const lamp = String(row[5] || "").trim();                   // F列: Lamp

      const key = `${title}_${diff}`;
      const masterInfo = masterMap.get(key);

      // 既存の能力値をデフォルト保持（fallback）
      let newTairyoku = parseFloat(row[7]) || 0; // H列
      let newKenban   = parseFloat(row[8]) || 0; // I列
      let newChuni    = parseFloat(row[9]) || 0; // J列
      let newKuse     = parseFloat(row[10]) || 0;// K列

      // MasterDataに情報が存在する場合のみ最新の倍率で再計算
      if (masterInfo) {
        const scoreMod = calculateScoreModifier(score, lamp);
        
        if (masterInfo.tairyoku > 0) newTairyoku = Math.round(masterInfo.tairyoku * scoreMod * 100) / 100;
        if (masterInfo.kenban > 0)   newKenban   = Math.round(masterInfo.kenban   * scoreMod * 100) / 100;
        if (masterInfo.chuni > 0)    newChuni    = Math.round(masterInfo.chuni    * scoreMod * 100) / 100;
        if (masterInfo.kuse > 0)     newKuse     = Math.round(masterInfo.kuse     * scoreMod * 100) / 100;
      }

      abilityRows.push([newTairyoku, newKenban, newChuni, newKuse]);
    }

    // 💡 H列(8列目)〜K列(11列目) の4列分だけを一括書き込み
    if (abilityRows.length > 0) {
      sheet.getRange(2, 8, abilityRows.length, 4).setValues(abilityRows);
      updatedCount++;
      Logger.log(`[更新完了] プレイヤー: ${playerName} (${abilityRows.length}件)`);
    }
  });

  Logger.log(`=== 全プレイヤーの能力値更新が完了しました (計 ${updatedCount} 名) ===`);
}

/**
 * 管理者用：全プレイヤーのベスト枠平均（BEST 30）を計算して UserMap シートの C列 に保存
 */
function updateAllPlayersBest30Avg() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const userMapSheet = ss.getSheetByName("UserMap");
    if (!userMapSheet) {
        throw new Error("UserMapシートが見つかりません。");
    }

    const mapValues = userMapSheet.getDataRange().getValues();
    if (mapValues.length <= 1) return;

    // C1セル（ヘッダー）を設定
    userMapSheet.getRange(1, 3).setValue("Best30Avg");

    const results = [];

    // 2行目以降のB列（playerName）を処理
    for (let i = 1; i < mapValues.length; i++) {
        const playerName = String(mapValues[i][1] || "").trim();
        if (!playerName) {
            results.push([""]);
            continue;
        }

        const best30Avg = calculateSinglePlayerBest30Avg(ss, playerName);
        results.push([best30Avg]);
    }

    // C2セル以降に結果を一括書き込み
    if (results.length > 0) {
        userMapSheet.getRange(2, 3, results.length, 1).setValues(results);
    }
}

/**
 * 単一プレイヤーのベスト枠平均計算用ヘルパー
 * 構成: E列(index 4) = Rating, G列(index 6) = isNew
 */
function calculateSinglePlayerBest30Avg(ss, playerName) {
    const userSheet = ss.getSheetByName(playerName);
    if (!userSheet) return 0;

    const values = userSheet.getDataRange().getValues();
    if (values.length <= 1) return 0;

    const bestRatings = [];

    for (let i = 1; i < values.length; i++) {
        const row = values[i];
        
        // G列(index 6): isNew 判定（"TRUE" や true 以外は旧曲扱い）
        const rawIsNew = row[6];
        const isNew = isNewSongCheckGas(rawIsNew);

        // 旧曲のみを抽出
        if (!isNew) {
            // E列(index 4): Rating（単曲レート）
            const rawRating = parseFloat(row[4] || 0);
            if (!isNaN(rawRating) && rawRating > 0) {
                bestRatings.push(floorTo2ndGas(rawRating));
            }
        }
    }

    // 単曲レートが高い順にソート
    bestRatings.sort((a, b) => b - a);

    // 上位30曲を切り出し
    const top30 = bestRatings.slice(0, 30);
    if (top30.length === 0) return 0;

    // 30で除算して平均を算出（小数点第4位まで切り捨て）
    const sum = top30.reduce((acc, val) => acc + val, 0);
    return floorTo4thGas(sum / 30);
}

// --- 数値処理ヘルパー関数 ---
function floorTo2ndGas(num) {
    return (!num || isNaN(num)) ? 0 : Math.floor((num + 0.0000001) * 100) / 100;
}

function floorTo4thGas(num) {
    return (!num || isNaN(num)) ? 0 : Math.floor((num + 0.0000001) * 10000) / 10000;
}

function isNewSongCheckGas(isNewVal) {
    if (typeof isNewVal === 'boolean') return isNewVal;
    if (typeof isNewVal === 'number') return isNewVal === 1;
    if (typeof isNewVal === 'string') {
        const s = isNewVal.trim().toLowerCase();
        return s === 'true' || s === '1' || s === 'new';
    }
    return false;
}

/**
 * 💡 スプレッドシートを開いたときに、手動実行用のカスタムメニューを追加する
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🛠️ 管理者メニュー')
    .addItem('最新のMasterDataを同期（アンケートツールから）', 'syncMasterData')
    .addSeparator() // 1つ目の区切り線（MasterData系とプレイヤー計算系の区切り）
    .addItem('全プレイヤーの能力値(H〜K列)を一括再計算', 'updateAllPlayerAbilitiesOnly')
    .addSeparator() // 2つ目の区切り線（能力値計算とレート/ベスト枠計算の区切り）
    .addItem('全プレイヤーのベスト枠平均を計算 (UserMap C列)', 'updateAllPlayersBest30Avg')
    .addToUi();
}