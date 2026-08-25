const GAS_URL = "https://script.google.com/macros/s/AKfycbyIWfCCHa1u_MtCRa98FolWlv3VzdYRSIFN0asP5y8-Dv_ca_Vadu3MPeAXArYT48dm/exec"

let myCurrentRecords = [];
let currentRanking = [];
let rateThresholds = { best30: 0, new20: 0 };
let currentTypeFilter = 'all'; // 'all', 'old', 'new' を保持
let currentSortKey = 'rating'; // デフォルトのソート順をRatingに設定

let currentMinScore = 1000000; // デフォルトはSS
const MAX_SCORE = 1010000;

const rankThresholds = {
    '99aj': 1009900,
    'sssplus': 1009000,
    'sss': 1007500,
    'nearsss': 1007000,
    'ssplus': 1005000,
    'ss': 1000000,
    'splus': 990000,
    's': 970000,
    'none': 0
};

let currentStatsData = null;      // GASから取得した生のリスト
let currentStatsMode = 'song';    // 'player' または 'song'
let currentDisplayType = 'count'; // 'count' (数) または 'avg' (平均)
let currentDenominator = 0;       // 母数（達成率計算用）
let lastStatsResponse = null; // GASの結果を保持する


/**
 * 強制ログアウト処理（端末のキャッシュを完全消去してログイン画面へ戻す）
 */
function clearUserCache() {
    // ローカルストレージ内の全データを削除
    localStorage.removeItem('chunirec_token');
    localStorage.removeItem('chunirec_scores');
    localStorage.removeItem('chunirec_player_name');
    localStorage.removeItem('chunirec_cache_time');

    // トークン入力フォームも空にする
    const tokenInput = document.getElementById('token-input');
    if (tokenInput) tokenInput.value = '';

    // メイン画面を隠して、ログイン（トークン入力）画面を表示
    const mainScreen = document.getElementById("main-screen");
    const tokenScreen = document.getElementById("token-screen");
    if (mainScreen) mainScreen.style.display = "none";
    if (tokenScreen) tokenScreen.style.display = "block";
}

function toggleTokenVisibility() {
    const input = document.getElementById("token-input");
    const btn = document.getElementById("toggle-token");

    if (!input || !btn) {
        console.error("要素が見つかりません。IDが正しいか確認してください。");
        return;
    }

    if (input.type === "password") {
        input.type = "text";
        btn.innerText = "🔒";
    } else {
        input.type = "password";
        btn.innerText = "👁️";
    }
}


/**
 * HTMLエスケープ処理関数
 */
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// --------------------------------------------------------------------------
// グローバル変数定義（最上部に配置）
// --------------------------------------------------------------------------
let allScores = []; // スプレッドシート(MasterData)から取得した楽曲データベース
let adminConditionPool = [];
let currentBingoState = null;

document.addEventListener('DOMContentLoaded', async () => {
    // 💡 1. フィルターの初期設定（0件表示エラーを防ぐため最初に実行）
    if (typeof initFilters === 'function') {
        initFilters();
    }

    const urlParams = new URLSearchParams(window.location.search);
    const targetPlayerFromUrl = urlParams.get("player");
    const savedToken = localStorage.getItem('chunirec_token');

    const tokenInput = document.getElementById('token-input');
    if (tokenInput && savedToken) {
        tokenInput.value = savedToken;
    }

    if (!savedToken) {
        console.warn("トークン未登録のため利用をブロックしました。");
        if (targetPlayerFromUrl) {
            window.history.replaceState({}, document.title, window.location.pathname);
        }
        document.getElementById("token-screen")?.style.setProperty('display', 'block');
        document.getElementById("main-screen")?.style.setProperty('display', 'none');
        alert("【エラー】トークンが設定されていません。");
        return;
    }

    // トークンが存在する場合：メイン画面を表示
    document.getElementById("token-screen")?.style.setProperty('display', 'none');
    document.getElementById("main-screen")?.style.setProperty('display', 'block');

    if (targetPlayerFromUrl) {
        localStorage.removeItem('chunirec_scores');
        localStorage.setItem('chunirec_player_name', targetPlayerFromUrl);
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    // 💡 2. 保存済みスコア（LocalStorage）を復元して画面に再描画
    if (typeof loadSavedScoresFromLocalStorage === 'function') {
        loadSavedScoresFromLocalStorage();
    }

    // 💡 3. キャッシュからビンゴ状態を読み込み（無ければGASから取得）
    if (typeof loadBingoDataFromCache === 'function') {
        if (!loadBingoDataFromCache() && typeof fetchBingoData === 'function') {
            fetchBingoData().catch(err => console.error("ビンゴデータ初期読み込みエラー:", err));
        }
    }
});

/**
 * 💡 保存済みスコア（LocalStorage）を復元して再描画する関数
 */
function loadSavedScoresFromLocalStorage() {
    const savedScoresStr = localStorage.getItem('chunirec_scores');
    const savedPlayerName = localStorage.getItem('chunirec_player_name');

    if (savedScoresStr) {
        try {
            // グローバル変数のスコア配列を復元
            myCurrentRecords = JSON.parse(savedScoresStr);

            // プレイヤー選択セレクトボックスの表示合わせ
            const playerSelect = document.getElementById("playerSelect");
            if (playerSelect && savedPlayerName) {
                playerSelect.value = savedPlayerName;
            }

            // レート計算
            if (typeof calculatechuniRate === 'function' && savedPlayerName) {
                calculatechuniRate(savedPlayerName);
            }

            // スコア一覧の再描画
            if (typeof updateFilters === 'function') {
                updateFilters();
            } else if (typeof displayScores === 'function') {
                displayScores(myCurrentRecords);
            }
        } catch (e) {
            console.error("保存済みスコアデータの復元に失敗しました:", e);
        }
    }
}

const BINGO_CURRENT_CARD_STATE_KEY = "BINGO_CURRENT_CARD_STATE";

/**
 * ビンゴの全状態（条件プール ＋ 各セルの開栓状態・2楽曲情報）を一元保存
 * @param {Object} [state] 保存するステート（指定がない場合は currentBingoState を使用）
 */
function saveBingoStateToStorage(state = currentBingoState) {
    try {
        if (!state) return;

        // adminConditionPool が設定されている場合は最新化して保持
        const stateToSave = {
            ...state,
            conditionPool: (Array.isArray(adminConditionPool) && adminConditionPool.length > 0)
                ? adminConditionPool
                : (state.conditionPool || [])
        };

        localStorage.setItem(BINGO_CURRENT_CARD_STATE_KEY, JSON.stringify(stateToSave));

        // 互換性のために旧キー（条件用）側も同時に最新化
        if (typeof BINGO_CONDITION_STORAGE_KEY !== "undefined") {
            localStorage.setItem(BINGO_CONDITION_STORAGE_KEY, JSON.stringify(stateToSave.conditionPool));
        }
    } catch (e) {
        console.error("ビンゴ状態の一元保存に失敗しました:", e);
    }
}

/**
 * 保持されている前回データ（条件プール ＋ 各セルの開栓状態・2楽曲情報）を一元復元
 */
function loadPreviousBingoState() {
    try {
        let savedData = localStorage.getItem(BINGO_CURRENT_CARD_STATE_KEY);
        let parsedState = savedData ? JSON.parse(savedData) : null;

        if (!parsedState && typeof BINGO_CONDITION_STORAGE_KEY !== "undefined") {
            const legacyCondition = localStorage.getItem(BINGO_CONDITION_STORAGE_KEY);
            if (legacyCondition) {
                parsedState = { conditionPool: JSON.parse(legacyCondition), cells: [] };
            }
        }

        if (!parsedState) {
            if (currentBingoState && currentBingoState.conditionPool) {
                parsedState = currentBingoState;
            } else {
                alert("保持されている前回のデータが見つかりませんでした。");
                return false;
            }
        }

        // 💡 データの正規化とセット（2曲構成・NULL許容の整合性を確保）
        currentBingoState = {
            ...parsedState,
            cells: (parsedState.cells || []).map(cell => ({
                ...cell,
                isOpened: cell.isOpened || false,
                song: cell.song || null,       // 曲1 (title, diff, const)
                song2: cell.song2 || null,     // 曲2 (title, diff, const)
                condition: cell.condition || cell.condition1 || "",
                condition1: cell.condition1 || cell.condition || "",
                condition2: cell.condition2 || cell.condition || "",
                minConst1: cell.minConst1 ?? cell.minConst ?? 0,
                maxConst1: cell.maxConst1 ?? cell.maxConst ?? 0,
                minConst2: cell.minConst2 !== undefined ? cell.minConst2 : null,
                maxConst2: cell.maxConst2 !== undefined ? cell.maxConst2 : null,
                isWE: Boolean(cell.isWE),
                isWE2: Boolean(cell.isWE2)
            })),
            conditionPool: (parsedState.conditionPool || []).map(item => {
                const min1 = item.minConst1 ?? item.minConst ?? 0;
                const max1 = item.maxConst1 ?? item.maxConst ?? 0;
                return {
                    ...item,
                    minConst1: min1,
                    maxConst1: max1,
                    minConst: min1,
                    maxConst: max1,
                    minConst2: item.minConst2 !== undefined ? item.minConst2 : null,
                    maxConst2: item.maxConst2 !== undefined ? item.maxConst2 : null,
                    condition: item.condition || item.condition1 || "",
                    condition1: item.condition1 || item.condition || "",
                    condition2: item.condition2 || item.condition || "",
                    maxBestAvg: item.maxBestAvg || item.maxRatingLimit || null,
                    count: item.total || item.count || 0,
                    isWE: Boolean(item.isWE),
                    isWE2: Boolean(item.isWE2)
                };
            })
        };

        // 管理フォーム用の変数も同時同期
        adminConditionPool = currentBingoState.conditionPool;

        // 画面の再描画を一括実行（関数名の揺れに対応）
        if (typeof renderUserBingoBoard === "function") renderUserBingoBoard(currentBingoState);
        if (typeof renderAdminBingoBoard === "function") renderAdminBingoBoard(currentBingoState);
        if (typeof renderAdminRulesForm === "function") renderAdminRulesForm();

        if (typeof updateAdminClearSongOptions === "function") updateAdminClearSongOptions();

        alert("前回保存されたデータ（条件設定および選出楽曲情報）を復元しました。");
        return true;

    } catch (e) {
        console.error("ビンゴ状態の復元に失敗しました:", e);
        alert("データの復元中にエラーが発生しました。");
        return false;
    }
}

async function fetchAllSongMaster() {
    try {
        const response = await fetch(GAS_URL, {
            method: "POST",
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ mode: "get_all_songs" })
        });

        const result = await response.json();
        const songList = result.data || result.songs;

        if (result.status === "success" && Array.isArray(songList)) {
            allScores = songList;
            console.log("楽曲マスター(GASから取得完了):", allScores.length, "件");
        } else {
            console.warn("楽曲マスターの取得に失敗、またはデータが空です:", result.message);
        }
    } catch (e) {
        console.error("楽曲マスター通信エラー:", e);
    }
}

// ==========================================================================
// ビンゴ機能 コア処理
// ==========================================================================

// 共通ヘルパー: WE（WORLD'S END）難易度判定
function isWEDiff(diff) {
    if (!diff) return false;
    const d = String(diff).toUpperCase();
    return d === "WE" || d === "WORLD'S END" || d === "WORLDS END";
}

/**
 * 💡 キャッシュ（LocalStorage）からビンゴ状態を読み込んで描画する（通信なし）
 */
function loadBingoDataFromCache() {
    const cachedDataStr = localStorage.getItem('bingo_data_cache');
    if (!cachedDataStr) return false;

    try {
        const cachedData = JSON.parse(cachedDataStr);
        currentBingoState = cachedData;

        // グローバル変数 adminConditionPool にも確実に同期
        if (cachedData.conditionPool && Array.isArray(cachedData.conditionPool)) {
            adminConditionPool = cachedData.conditionPool;
            if (typeof saveConditionPoolToStorage === "function") {
                saveConditionPoolToStorage(cachedData.conditionPool);
            }
        }

        renderUserBingoBoard(cachedData);
        renderAdminBingoBoard(cachedData);

        if (typeof updateAdminPublishStatusUI === "function") {
            updateAdminPublishStatusUI(cachedData.isPublished);
        }
        return true;
    } catch (e) {
        console.error("ビンゴキャッシュデータの読み込みに失敗しました:", e);
        return false;
    }
}

/**
 * 💡 GASから最新のビンゴデータを取得し、画面を再描画する
 */
async function fetchBingoData() {
    const refreshBtn = document.querySelector('button[onclick="fetchBingoData()"]');
    const originalBtnText = refreshBtn ? refreshBtn.innerText : "";

    try {
        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.innerText = "更新中...";
        }

        if (typeof GAS_URL === 'undefined' || !GAS_URL) {
            throw new Error("GAS_URL が定義されていません。");
        }

        const playerName = localStorage.getItem('chunirec_player_name') || "";

        const response = await fetch(GAS_URL, {
            method: "POST",
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                mode: "get_admin_bingo_data",
                isAdmin: true,
                playerName: playerName
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const result = await response.json();

        if (result.status === "success" && result.data) {
            currentBingoState = result.data;

            // グローバルプール変数も最新化
            if (result.data.conditionPool && Array.isArray(result.data.conditionPool)) {
                adminConditionPool = result.data.data ? result.data.conditionPool : result.data.conditionPool;
                if (typeof saveConditionPoolToStorage === "function") {
                    saveConditionPoolToStorage(result.data.conditionPool);
                }
            }

            localStorage.setItem('bingo_data_cache', JSON.stringify(result.data));
            saveBingoStateToStorage(result.data);

            // ★ 管理画面のFREEマス入力フォームに最新データをセット・保持
            syncAdminFreeFormInputs(result.data);

            // --- 画面描画処理 ---
            updateAdminPublishStatusUI(result.data.isPublished);

            if (typeof renderAdminRulesForm === "function") {
                renderAdminRulesForm();
            }

            if (typeof renderUserBingoBoard === "function") {
                renderUserBingoBoard(result.data);
            }
            if (typeof renderAdminBingoBoard === "function") {
                renderAdminBingoBoard(result.data);
            }

            if (typeof showToast === "function") {
                showToast("最新のビンゴデータを読み込みました！");
            }

        } else {
            currentBingoState = null;
            localStorage.removeItem('bingo_data_cache');

            const boardContainer = document.getElementById("bingo-board");
            if (boardContainer) {
                boardContainer.innerHTML = "<p style='grid-column: 1 / -1; text-align:center; padding:20px;'>現在有効なビンゴカードがありません。</p>";
            }
            alert("有効なビンゴデータが取得できませんでした: " + (result.message || "データなし"));
        }
    } catch (error) {
        console.error("ビンゴデータの取得に失敗しました:", error);
        alert(`データの更新に失敗しました:\n${error.message}`);

        if (typeof loadBingoDataFromCache === "function") {
            loadBingoDataFromCache();
        }
    } finally {
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.innerText = originalBtnText;
        }
    }
}

/**
 * ビンゴデータ取得時に管理画面フォームへFREEマスの最新状態を保持・セットする
 * @param {Object} bingoState - GASから返されたビンゴ状態データ
 */
function syncAdminFreeFormInputs(bingoState) {
    if (!bingoState || !bingoState.cells) return;

    // 中央のFREE協力マス（index 12）を取得
    const centerCell = bingoState.cells[12] || bingoState.cells.find(c => c.isCenter);
    if (!centerCell) return;

    const titleInput = document.getElementById("admin-free-song-title");
    const targetInput = document.getElementById("admin-free-target-score");
    const currentInput = document.getElementById("admin-free-current-score");

    // 曲名・設定テキストの保持
    if (titleInput) {
        titleInput.value = centerCell.songTitle || centerCell.title || "";
    }
    // 目標スコアの保持
    if (targetInput && centerCell.freeTargetScore !== undefined) {
        targetInput.value = centerCell.freeTargetScore ?? "";
    }
    // 現在の累計スコアの保持（入力欄またはプレースホルダー）
    if (currentInput && centerCell.freeCurrentScore !== undefined) {
        currentInput.value = centerCell.freeCurrentScore ?? 0;
        currentInput.placeholder = `現在: ${Number(centerCell.freeCurrentScore).toLocaleString()} pt`;
    }
}

/**
 * 一般画面用 ビンゴボード描画（GASのBINGO_STATE構造に完全準拠）
 */
function renderUserBingoBoard(bingoState) {
    const boardContainer = document.getElementById("bingo-board");
    if (!boardContainer || !bingoState || !bingoState.cells) return;

    boardContainer.innerHTML = "";

    if (!bingoState.isPublished) {
        boardContainer.innerHTML = `
            <div style="grid-column: 1 / -1; text-align:center; padding: 20px 10px; background: #f5f5f5; border: 1px solid #cccccc; color: #666666; border-radius: 8px;">
                <div style="font-size: 0.95rem; font-weight: bold; margin-bottom: 4px;">ビンゴカード準備中</div>
                <div style="font-size: 0.75rem;">現在管理者がビンゴカードを作成・抽選中です。<br>公開まで今しばらくお待ちください。</div>
            </div>
        `;
        return;
    }

    // ★ モーダル表示・描画時は常に「ビンゴ: X本」をアクティブ状態に初期化
    window.currentBingoViewMode = 'bingo';

    // --- 上部サマリー（外枠・背景色を除去） ---
    const bingoCount = bingoState.bingoCount || 0;
    const bigBingoCount = bingoState.bigBingoCount || 0;

    const isBingoActive = currentBingoViewMode === 'bingo';
    const isBigActive = currentBingoViewMode === 'big';

    const headerEl = document.createElement("div");
    headerEl.className = "bingo-header-summary";
    headerEl.style.cssText = "grid-column: 1 / -1; margin-bottom: 12px; padding: 4px 0; display: flex; justify-content: center; align-items: center;";

    headerEl.innerHTML = `
        <div style="display: flex; gap: 12px; font-weight: bold; font-size: 0.85rem; width: 100%; justify-content: center;">
            <button onclick="setBingoViewMode('bingo')" class="bingo-toggle-btn ${isBingoActive ? 'active' : ''}" style="flex: 1; max-width: 180px; padding: 8px 12px; border-radius: 6px; border: 1.5px solid #ff9800; background: ${isBingoActive ? '#ff9800' : '#fff'}; color: ${isBingoActive ? '#fff' : '#e65100'}; cursor: pointer; font-weight: bold; font-size: 0.9rem; transition: all 0.2s; box-shadow: ${isBingoActive ? '0 2px 4px rgba(255,152,0,0.3)' : 'none'};">
                ビンゴ: ${bingoCount} 本
            </button>
            <button onclick="setBingoViewMode('big')" class="bingo-toggle-btn ${isBigActive ? 'active' : ''}" style="flex: 1; max-width: 180px; padding: 8px 12px; border-radius: 6px; border: 1.5px solid #ab47bc; background: ${isBigActive ? 'linear-gradient(135deg, #ec407a, #8e24aa)' : '#fff'}; color: ${isBigActive ? '#fff' : '#4a148c'}; cursor: pointer; font-weight: bold; font-size: 0.9rem; transition: all 0.2s; box-shadow: ${isBigActive ? '0 2px 4px rgba(171,71,188,0.3)' : 'none'};">
                大ビンゴ: ${bigBingoCount} 本
            </button>
        </div>
    `;
    boardContainer.appendChild(headerEl);

    const titleStyle = "display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; word-break: break-all; line-height: 1.1; vertical-align: middle;";
    const userBestAvg = parseFloat(bingoState.userBestAvg || 0);

    bingoState.cells.forEach((cell, index) => {
        const cellEl = document.createElement("div");
        cellEl.style.position = "relative";

        // GAS側の計算結果フラグを参照
        const isCleared = Boolean(cell.isCleared);
        const isBigCleared = Boolean(cell.isBigCleared);
        const clearedList = cell.clearedList || [];
        const clearCount = clearedList.length;

        // 表示モード別の判定
        const isBigMode = currentBingoViewMode === 'big';
        let activeCleared = false;
        let statusClass = "unopened";

        if (isBigMode) {
            activeCleared = isBigCleared;
            if (activeCleared) {
                statusClass = "big-cleared cleared";
            } else if (cell.isOpened) {
                statusClass = "opened";
            }
        } else {
            activeCleared = isCleared;
            if (activeCleared) {
                statusClass = "cleared";
            } else if (cell.isOpened) {
                statusClass = "opened";
            }
        }

        // べ枠平均上限判定
        const rawMaxAvg = cell.maxBestAvg ?? cell.maxRatingLimit;
        let badgeNum = "1";
        let badgeTitle = "べ枠平均上限なし";
        let limitAvg = null;

        if (rawMaxAvg !== null && rawMaxAvg !== undefined && rawMaxAvg !== "") {
            const numAvg = parseFloat(rawMaxAvg);
            if (!isNaN(numAvg) && numAvg > 0) {
                limitAvg = numAvg;
                if (limitAvg <= 17.20) {
                    badgeNum = "3";
                    badgeTitle = "べ枠平均上限: ～17.20";
                } else if (limitAvg <= 17.40) {
                    badgeNum = "2";
                    badgeTitle = "べ枠平均上限: ～17.40";
                }
            }
        }

        // 無効化判定
        let isDisabled = false;
        if (!isCleared && !cell.isFree && !cell.isCenter && index !== 12 && limitAvg !== null && userBestAvg > 0) {
            if (userBestAvg > limitAvg) isDisabled = true;
        }

        const isCenterCell = cell.isCenter || index === 12;
        const freeClass = (cell.isFree || isCenterCell) ? " free-cell" : "";
        cellEl.className = `bingo-cell ${statusClass}${freeClass}${isDisabled ? " is-disabled" : ""}`;

        cellEl.onclick = () => onBingoCellClick(index);

        const avgBadgeHtml = (cell.isFree || isCenterCell) ? "" : `
            <div style="position: absolute; top: 2px; left: 4px; font-size: 13px; font-weight: 900; color: ${isDisabled ? '#888888' : '#212121'}; line-height: 1; z-index: 2;" title="${badgeTitle}">
                ${badgeNum}
            </div>
        `;

        // --- FREEマス描画処理部 ---
        if (cell.isFree || isCenterCell) {
            const freeTextColor = activeCleared ? (isBigMode ? "#8e24aa" : "#e65100") : "#d32f2f";

            let innerContentHtml = "";

            if (!isBigMode) {
                // 通常（ビンゴ）モード時は「FREE」と大きく表示
                innerContentHtml = `
                    <div style="display:flex; justify-content:center; align-items:center; height:calc(100% - 14px);">
                        <span style="font-size: 16px; font-weight: 900; color: #e65100; letter-spacing: 1px;">FREE</span>
                    </div>
                `;
            } else {
                // 大ビンゴモード時は楽曲名・目標スコア・CLEARバッジを表示
                const freeSongTitle = cell.songTitle || cell.title || "全員協力マス";
                const current = Number(cell.freeCurrentScore || 0);
                const target = Number(cell.freeTargetScore || 0);

                let scoreText = "";
                if (target > 0) {
                    scoreText = `${current.toLocaleString()} / ${target.toLocaleString()}`;
                } else if (current > 0) {
                    scoreText = `${current.toLocaleString()} pt`;
                }

                const clearBadgeText = "BIG CLEAR";
                const clearBadgeHtml = activeCleared ? `<div class="clear-badge" style="margin-top:2px;">${clearBadgeText}</div>` : "";

                innerContentHtml = `
                    <div style="display:flex; flex-direction:column; justify-content:center; align-items:center; height:calc(100% - 14px); padding:0 2px;">
                        <div style="font-size:10px; font-weight:bold; color:#212121; line-height:1.1; margin-bottom:2px; text-align:center; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;" title="${escapeHTML(freeSongTitle)}">
                            ${escapeHTML(freeSongTitle)}
                        </div>
                        ${scoreText ? `<div style="font-size:10px; font-weight:bold; color:${freeTextColor}; line-height:1;">${scoreText}</div>` : ""}
                        ${clearBadgeHtml}
                    </div>
                `;
            }

            cellEl.innerHTML = `
                <div style="font-weight:bold; color:${freeTextColor}; font-size:9px; line-height: 1; margin: 0; text-align:center;">No.${index + 1}</div>
                ${innerContentHtml}
            `;
            boardContainer.appendChild(cellEl);
            return;
        }

        // 通常マス描画
        if (!cell.isOpened) {
            cellEl.innerHTML = `
                ${avgBadgeHtml}
                <div style="font-weight:bold; color:${isDisabled ? '#9e9e9e' : '#d32f2f'}; font-size:9px; line-height: 1; margin: 0; text-align:center;">No.${index + 1}</div>
                <div style="margin: 2px 0 0 0; color: #9e9e9e; font-size:9px; text-align:center; font-weight:bold;">未確定</div>
            `;
        } else {
            const s1 = cell.song || { title: cell.songTitle, diff: cell.diff };
            const s2 = cell.song2;

            const badge1 = s1.diff ? `<span class="diff-badge ${escapeHTML(s1.diff || '')}">${escapeHTML(s1.diff || '')}</span>` : "";
            const badge2 = (s2 && s2.diff) ? `<span class="diff-badge ${escapeHTML(s2.diff || '')}">${escapeHTML(s2.diff || '')}</span>` : "";

            let songHtml = `
                <div class="song-block" style="margin: 0; line-height: 1.1;">
                    ${badge1}<strong class="song-title" style="${titleStyle}" title="${escapeHTML(s1.title || '')}">${escapeHTML(s1.title || '')}</strong>
                </div>
            `;

            if (s2 && s2.title) {
                songHtml += `
                    <div style="font-size:7px; color:${activeCleared ? (isBigMode ? '#4a148c' : '#e65100') : '#0a0a0a'}; font-weight:bold; margin: 0; text-align:center; scale: 0.85; line-height: 1;">ー OR ー</div>
                    <div class="song-block" style="margin: 0; line-height: 1.1;">
                        ${badge2}<strong class="song-title" style="${titleStyle}" title="${escapeHTML(s2.title || '')}">${escapeHTML(s2.title || '')}</strong>
                    </div>
                `;
            }

            const conditionText = getFormattedConditionText(cell);
            const clearBadgeText = isBigMode ? `BIG CLEAR (${clearCount}件)` : `CLEAR (${clearCount}件)`;
            const clearBadgeHtml = activeCleared ? `<div class="clear-badge">${clearBadgeText}</div>` : "";

            cellEl.innerHTML = `
                ${avgBadgeHtml}
                <div style="font-weight:bold; color:${activeCleared ? (isBigMode ? '#4a148c' : '#e65100') : (isDisabled ? '#888888' : '#0f0f0f')}; font-size:9px; line-height: 1; margin: 0; text-align:center;">No.${index + 1}</div>
                ${songHtml}
                <div class="condition" style="margin-top:1px; padding-top:1px;">
                    ${escapeHTML(conditionText)}
                </div>
                ${clearBadgeHtml}
            `;
        }

        boardContainer.appendChild(cellEl);
    });
}


// 簡易トースト通知用ヘルパー
function showToast(message) {
    if (typeof toastr !== "undefined") {
        toastr.success(message);
    } else {
        console.log(message);
    }
}

// 表示モード保持用グローバル変数 ('all' | 'normal' | 'big')
let currentBingoViewMode = 'all';

/**
 * 条件コード・文字列を画面表示用ラベルに変換
 */
function formatCondition(conditionCode) {
    if (!conditionCode) return "";

    const labelMap = {
        "THEORY": "理論値",
        "AJ_995": "995AJ",
        "AJ_99": "99AJ",
        "AJ": "AJ",
        "SSS_PLUS": "SSS+",
        "8500": "8500",
        "SSS_8500": "8500",
        "8000": "8000",
        "SSS_8000": "8000",
        "SSS": "SSS",
        "7000": "7000",
        "5000": "SS+",
        "SS_PLUS": "SS+",
        "SS": "SS",
        "SSS+": "SSS+",
        "理論値": "理論値",
        "995AJ": "995AJ",
        "99AJ": "99AJ"
    };

    return labelMap[conditionCode] || conditionCode;
}

/**
 * マス目描画用の条件テキスト生成ヘルパー
 */
function getFormattedConditionText(cell) {
    const cond1 = cell.condition1 || cell.condition || "";
    const cond2 = cell.condition2 || cond1;

    let condFormatted = formatCondition(cond1);
    if (cell.song2 && cond1 !== cond2) {
        condFormatted = `①${formatCondition(cond1)} / ②${formatCondition(cond2)}`;
    }
    return condFormatted;
}

/**
 * ビューモード切り替え用関数（タブ切り替えボタンから呼び出し想定）
 */
function setBingoViewMode(mode) {
    if (!['bingo', 'big'].includes(mode)) return;
    window.currentBingoViewMode = mode;
    // 現在のビンゴデータで再描画
    if (typeof currentBingoState !== "undefined" && currentBingoState) {
        // 再描画時は初期化されないよう一時フラグで防ぐか、ビュー固定再描画を実施
        renderUserBingoBoardModeKeep(currentBingoState);
    }
}

/**
 * タブ切り替え専用（モードを維持したまま再描画する内部関数）
 */
function renderUserBingoBoardModeKeep(bingoState) {
    const savedMode = window.currentBingoViewMode;
    renderUserBingoBoard(bingoState);
    window.currentBingoViewMode = savedMode; // モードを再復元
}

/**
 * 表示モード切り替え処理
 */
function setBingoViewMode(mode) {
    currentBingoViewMode = mode;
    if (currentBingoState && typeof renderUserBingoBoard === "function") {
        renderUserBingoBoard(currentBingoState);
    }
}

/**
 * ビンゴマスをクリックした際の統合ハンドラ
 */
function onBingoCellClick(index) {
    if (!currentBingoState || !currentBingoState.cells) return;
    const cell = currentBingoState.cells[index];
    if (!cell) return;

    // ★ FREEマス・中央マスの場合はFREEマス用モーダルを表示
    if (cell.isFree || cell.isCenter || index === 12) {
        openFreeCellModal(index);
        return;
    }

    // 未確定マスはクリック無効
    if (!cell.isOpened) return;

    const clearedList = cell.clearedList || [];

    if (clearedList.length > 0 || cell.isCleared) {
        showBingoClearedModal(index);
    } else {
        if (typeof openManualClearModal === "function") {
            openManualClearModal(index);
        }
    }
}

/**
 * 達成者一覧モーダルの表示処理（2曲左右分け＆スコア降順対応）
 */
function showBingoClearedModal(cellIndex) {
    if (!currentBingoState || !currentBingoState.cells) return;
    const cell = currentBingoState.cells[cellIndex];
    if (!cell) return;

    const modal = document.getElementById("bingo-cleared-modal");
    const titleEl = document.getElementById("cleared-modal-title");
    const listEl = document.getElementById("cleared-players-list");
    if (!modal || !listEl) return;

    if (titleEl) titleEl.textContent = `No.${cellIndex + 1} マス 達成情報一覧`;

    const clearedList = cell.clearedList || [];

    // --- A. スコア降順ソート関数 ---
    const sortByScoreDesc = (list) => {
        return [...list].sort((a, b) => {
            const scoreA = (a.score !== undefined && a.score !== null) ? Number(a.score) : -1;
            const scoreB = (b.score !== undefined && b.score !== null) ? Number(b.score) : -1;
            return scoreB - scoreA;
        });
    };

    // --- B. 1リスト分のHTML生成関数 ---
    const renderListItems = (items) => {
        if (items.length === 0) {
            return `<li class="cleared-list-item" style="text-align:center; color:#888; padding:15px 0;">達成記録なし</li>`;
        }
        return items.map(item => {
            const displayScore = (item.score !== undefined && item.score !== null)
                ? Number(item.score).toLocaleString()
                : '-';

            const isManualTag = item.isManual ? `<span style="font-size:0.65rem; background:#757575; color:#fff; padding:1px 4px; border-radius:3px; margin-left:4px;">手動</span>` : '';

            return `
                <li class="cleared-list-item" style="margin-bottom: 8px; padding: 8px; background: #f9f9f9; border-radius: 6px; list-style: none; border-left: 3px solid ${item.isManual ? '#757575' : '#1976d2'};">
                    <div class="cleared-user-row" style="display: flex; justify-content: space-between; font-weight: bold; font-size: 0.9rem;">
                        <span class="cleared-user-name">${escapeHTML(item.playerName || '匿名')}${isManualTag}</span>
                        <span class="cleared-user-score" style="color: #d32f2f;">${displayScore}</span>
                    </div>
                    <div class="cleared-detail-info" style="font-size: 0.75rem; color: #666; margin-top: 4px; display: flex; justify-content: space-between;">
                        <span>ランプ: <b>${escapeHTML(item.lamp || '-')}</b></span>
                        <span class="cleared-user-time">${escapeHTML(item.clearedAt || '')}</span>
                    </div>
                </li>
            `;
        }).join("");
    };

    // 1曲構成・FREEマス・中央マスの処理
    const s1 = cell.song || { title: cell.songTitle, diff: cell.diff };
    const s2 = cell.song2;

    if (cell.isFree || cell.isCenter || cellIndex === 12 || !s2 || !s2.title) {
        const sortedList = sortByScoreDesc(clearedList);
        listEl.innerHTML = `<ul style="padding: 0; margin: 0;">${renderListItems(sortedList)}</ul>`;
    } else {
        // --- C. 2曲存在する場合の左右分割処理 ---
        const title1 = (s1.title || "").trim();
        const title2 = (s2.title || "").trim();

        // 1曲目と2曲目に振り分け (songIndexの文字列・数値の型不一致を考慮)
        const list1 = clearedList.filter(item => {
            if (item.songIndex !== undefined && item.songIndex !== null) {
                return String(item.songIndex) === "1";
            }
            const itemTitle = String(item.songTitle || item.title || "").trim();
            return itemTitle === title1;
        });

        const list2 = clearedList.filter(item => {
            if (item.songIndex !== undefined && item.songIndex !== null) {
                return String(item.songIndex) === "2";
            }
            const itemTitle = String(item.songTitle || item.title || "").trim();
            return itemTitle === title2;
        });

        const sortedList1 = sortByScoreDesc(list1);
        const sortedList2 = sortByScoreDesc(list2);

        listEl.innerHTML = `
            <div style="display: flex; gap: 12px; width: 100%; box-sizing: border-box; flex-wrap: wrap;">
                <!-- 左カラム: 1曲目 -->
                <div style="flex: 1; min-width: 200px; background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px;">
                    <div style="font-weight: bold; font-size: 0.85rem; border-bottom: 2px solid #1976d2; padding-bottom: 4px; margin-bottom: 8px; color: #1976d2; text-align: center;">
                        ${s1.diff ? `[${escapeHTML(s1.diff)}] ` : ''}${escapeHTML(s1.title || '楽曲1')}
                        <span style="font-size:0.75rem; color:#666;">(${sortedList1.length}件)</span>
                    </div>
                    <ul style="padding: 0; margin: 0;">
                        ${renderListItems(sortedList1)}
                    </ul>
                </div>

                <!-- 右カラム: 2曲目 -->
                <div style="flex: 1; min-width: 200px; background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px;">
                    <div style="font-weight: bold; font-size: 0.85rem; border-bottom: 2px solid #e65100; padding-bottom: 4px; margin-bottom: 8px; color: #e65100; text-align: center;">
                        ${s2.diff ? `[${escapeHTML(s2.diff)}] ` : ''}${escapeHTML(s2.title || '楽曲2')}
                        <span style="font-size:0.75rem; color:#666;">(${sortedList2.length}件)</span>
                    </div>
                    <ul style="padding: 0; margin: 0;">
                        ${renderListItems(sortedList2)}
                    </ul>
                </div>
            </div>
        `;
    }

    modal.style.display = "flex";
}

/**
 * 達成者一覧モーダルを閉じる
 */
function closeBingoClearedModal() {
    const modal = document.getElementById("bingo-cleared-modal");
    if (modal) modal.style.display = "none";
}

/**
 * FREEマス専用 モーダル表示（達成度 + スコア降順一覧）
 */
function openFreeCellModal(cellIndex) {
    if (!currentBingoState || !currentBingoState.cells) return;
    const cell = currentBingoState.cells[cellIndex];
    if (!cell) return;

    const modal = document.getElementById("bingo-cleared-modal");
    const titleEl = document.getElementById("cleared-modal-title");
    const listEl = document.getElementById("cleared-players-list");
    if (!modal || !listEl) return;

    if (titleEl) titleEl.textContent = `No.${cellIndex + 1} FREE協力マス スコア一覧`;

    // clearedList の安全な抽出（SYSTEMデータのみ除外）
    const rawList = cell.clearedList || [];
    const clearedList = rawList.filter(item => {
        if (!item) return false;
        const name = item.playerName || item.name || "";
        return name !== "SYSTEM";
    });

    const sortedList = [...clearedList].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));

    const current = Number(cell.freeCurrentScore || 0);
    const target = Number(cell.freeTargetScore || 0);

    // 達成率（%）の計算（グラデーション塗りの領域計算用・上限100%）
    const progressPercent = target > 0 ? Math.min(100, (current / target) * 100) : 0;

    // 1. 上部：達成度表示ヘッダー（背景をグラデーションでローディングバー風に設定）
    const headerHtml = `
        <div style="
            position: relative;
            margin-bottom: 15px; 
            padding: 12px; 
            background: linear-gradient(to right, #e3f2fd ${progressPercent}%, #f0f4f8 ${progressPercent}%);
            border-radius: 8px; 
            border: 1px solid #d0d7de; 
            text-align: center;
            overflow: hidden;
            transition: background 0.3s ease;
        ">
            <div style="font-size: 0.8rem; color: #57606a; margin-bottom: 2px; position: relative; z-index: 1;">現在の達成度</div>
            <div style="font-weight: bold; color: #1976d2; font-size: 1.1rem; position: relative; z-index: 1;">
                ${current.toLocaleString()} / ${target > 0 ? target.toLocaleString() : "---"}
            </div>
        </div>
    `;

    // 2. リスト項目HTML
    const listItemsHtml = sortedList.length === 0
        ? `<li style="text-align:center; color:#888; padding:20px 0; list-style: none;">まだスコア登録はありません</li>`
        : sortedList.map((item, idx) => {
            const name = item.playerName || item.name || '匿名';
            const score = Number(item.score || 0);

            return `
                <li class="cleared-list-item" style="margin-bottom: 8px; padding: 10px 12px; background: #f9f9f9; border-radius: 6px; list-style: none; display: flex; justify-content: space-between; align-items: center; border-left: 4px solid #1976d2;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 0.8rem; font-weight: bold; color: #666; width: 20px;">${idx + 1}.</span>
                        <span style="font-weight: bold; font-size: 0.95rem; color: #333;">${escapeHTML(name)}</span>
                    </div>
                    <span style="color: #d32f2f; font-weight: bold; font-size: 1rem;">${score.toLocaleString()}</span>
                </li>
            `;
        }).join('');

    listEl.innerHTML = headerHtml + `<ul style="padding: 0; margin: 0;">${listItemsHtml}</ul>`;
    modal.style.display = "flex";
}

/**
 * 管理画面のボード描画（Big Clear表示・中央マス対応）
 */
function renderAdminBingoBoard(bingoState) {
    const adminBoardContainer = document.getElementById("admin-bingo-board");
    if (!adminBoardContainer || !bingoState || !bingoState.cells) return;

    adminBoardContainer.innerHTML = "";
    adminBoardContainer.className = "bingo-grid-container";

    bingoState.cells.forEach((cell, index) => {
        const cellEl = document.createElement("div");
        cellEl.style.position = "relative";
        cellEl.style.cursor = "pointer";

        const isCenterCell = cell.isCenter || index === 12;

        // ★ 1. FREEマス または 中央協力マスの処理
        if (cell.isFree || isCenterCell) {
            const isBigCleared = Boolean(cell.isBigCleared);
            const activeCleared = Boolean(cell.isCleared) || isBigCleared;
            cellEl.className = `bingo-cell cleared free-cell${isBigCleared ? " big-cleared" : ""}`;

            // 曲名/課題名（songTitle）の取得
            const freeSongTitle = cell.songTitle || cell.title || "全員協力マス";
            const current = Number(cell.freeCurrentScore || 0);
            const target = Number(cell.freeTargetScore || 0);

            // スコア表示テキストの生成
            let scoreText = "";
            if (target > 0) {
                scoreText = `${current.toLocaleString()} / ${target.toLocaleString()}`;
            } else if (current > 0) {
                scoreText = `${current.toLocaleString()} pt`;
            }

            const freeTextColor = isBigCleared ? '#e65100' : (activeCleared ? '#2e7d32' : '#1976d2');

            cellEl.innerHTML = `
                <div style="font-weight:bold; color:#212121; font-size:10px; line-height: 1; margin: 0; text-align:center;">No.${index + 1}</div>
                <div style="display:flex; flex-direction:column; justify-content:center; align-items:center; height:calc(100% - 14px); padding:0 2px;">
                    <div style="font-size:10px; font-weight:bold; color:#212121; line-height:1.1; margin-bottom:2px; text-align:center; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;" title="${escapeHTML(freeSongTitle)}">
                        ${escapeHTML(freeSongTitle)}
                    </div>
                    ${scoreText ? `<div style="font-size:10px; font-weight:bold; color:${freeTextColor}; line-height:1;">${scoreText}</div>` : ""}
                </div>
            `;

            // FREEマスをクリックした際にスコア確認モーダルを開く
            cellEl.onclick = () => {
                if (typeof openFreeCellModal === "function") {
                    openFreeCellModal(index);
                }
            };

            adminBoardContainer.appendChild(cellEl);
            return;
        }

        // ★ 2. べ枠平均上限の数値判定
        const maxAvg = cell.maxBestAvg ?? cell.maxRatingLimit;
        let badgeNum = "1";
        let badgeTitle = "べ枠平均上限なし";

        if (maxAvg !== null && maxAvg !== undefined && maxAvg !== "") {
            const numAvg = parseFloat(maxAvg);
            if (!isNaN(numAvg)) {
                if (numAvg <= 17.20) {
                    badgeNum = "3";
                    badgeTitle = "べ枠平均上限: ～17.20";
                } else if (numAvg <= 17.40) {
                    badgeNum = "2";
                    badgeTitle = "べ枠平均上限: ～17.40";
                }
            }
        }

        // ★ 3. 左上バッジHTML
        const avgBadgeHtml = `
            <div style="position: absolute; top: 2px; left: 4px; font-size: 13px; font-weight: 900; color: #212121; line-height: 1; z-index: 2;" title="${escapeHTML(badgeTitle)}">
                ${badgeNum}
            </div>
        `;

        // ★ 4. クリア / Big Clear / 確定 / 未確定 のクラス分け
        const isCleared = Boolean(cell.isCleared);
        const isBigCleared = Boolean(cell.isBigCleared);

        let statusClass = "unopened";
        if (isBigCleared) {
            statusClass = "big-cleared cleared";
        } else if (isCleared) {
            statusClass = "cleared";
        } else if (cell.isOpened) {
            statusClass = "opened";
        }

        cellEl.className = `bingo-cell ${statusClass}`;

        if (cell.isOpened) {
            const s1 = cell.song || { title: cell.songTitle, diff: cell.diff };
            const s2 = cell.song2;

            const badge1 = s1 && s1.diff ? `<span class="diff-badge ${escapeHTML(s1.diff || '')}">${escapeHTML(s1.diff || '')}</span>` : "";
            const badge2 = (s2 && s2.diff) ? `<span class="diff-badge ${escapeHTML(s2.diff || '')}">${escapeHTML(s2.diff || '')}</span>` : "";

            const titleStyle = "display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; word-break: break-all; line-height: 1.1; vertical-align: middle;";

            let songHtml = `
                <div style="margin: 0; line-height: 1.1;">
                    ${badge1}<strong class="song-title" style="${titleStyle}" title="${escapeHTML(s1.title || '')}">${escapeHTML(s1.title || '')}</strong>
                </div>
            `;

            if (s2 && s2.title) {
                songHtml += `
                    <div style="font-size:7px; color:#d32f2f; font-weight:bold; margin: 0; text-align:center; scale: 0.85; line-height: 1;">ー OR ー</div>
                    <div style="margin: 0; line-height: 1.1;">
                        ${badge2}<strong class="song-title" style="${titleStyle}" title="${escapeHTML(s2.title || '')}">${escapeHTML(s2.title || '')}</strong>
                    </div>
                `;
            }

            const conditionText = typeof getFormattedConditionText === "function" ? getFormattedConditionText(cell) : (cell.condition || "");

            let statusLabel = "[確定]";
            let statusColor = "#212121";
            if (isBigCleared) {
                statusLabel = "[BIG CLEAR!]";
                statusColor = "#e65100";
            } else if (isCleared) {
                statusLabel = "[CLEAR!]";
                statusColor = "#2e7d32";
            }

            cellEl.innerHTML = `
                ${avgBadgeHtml}
                <div style="font-weight:bold; color:${statusColor}; font-size:10px; line-height: 1; margin: 0; text-align: center;">No.${index + 1} ${statusLabel}</div>
                ${songHtml}
                <div class="condition" style="margin-top:1px; padding-top:1px;">
                    ${escapeHTML(conditionText)}
                </div>
            `;
        } else {
            cellEl.innerHTML = `
                ${avgBadgeHtml}
                <div style="font-weight:bold; color:#212121; font-size:10px; line-height: 1; margin: 0; text-align: center;">No.${index + 1} [未確定]</div>
                <div style="font-weight:bold; color:#1976d2; font-size:12px; margin: 2px 0 0 0; text-align: center;">ランダム抽選</div>
            `;
        }

        cellEl.onclick = () => handleAdminCellClick(index);
        adminBoardContainer.appendChild(cellEl);
    });

    if (typeof updateAdminClearFormState === "function") {
        updateAdminClearFormState();
    }
}

// 通信重複防止用Promise保持変数
let fetchSongMasterPromise = null;

/**
 * 管理画面からのセルクリック（開栓済みマスの自動再抽選判定付き）
 */
async function handleAdminCellClick(cellIndex, isReSpin = false) {
    if (!currentBingoState || !currentBingoState.conditionPool) {
        alert("ビンゴデータまたは条件プールが存在しません。");
        return;
    }

    const targetCell = currentBingoState.cells ? currentBingoState.cells[cellIndex] : null;

    // ★ 1. FREEマスおよび中央協力マス（No.13/index 12）の場合はルーレットを行わない
    if (targetCell && (targetCell.isFree || targetCell.isCenter || cellIndex === 12)) return;

    // ★ 2. 自動判定: 開栓済み（isOpened === true）かつ明示的に false の場合は isReSpin を true に変更
    if (targetCell && targetCell.isOpened) {
        isReSpin = true;
    }

    // ★ 3. 再抽選時の確認ダイアログ
    if (isReSpin) {
        const confirmRetry = confirm(`マス No.${cellIndex + 1} は開栓済みです。もう一度ルーレットを回して楽曲を上書きしますか？`);
        if (!confirmRetry) return;
    }

    // ★ 4. allScores の安全な取得処理
    if (typeof allScores === "undefined" || !Array.isArray(allScores) || allScores.length === 0) {
        if (typeof fetchAllSongMaster === "function") {
            if (!fetchSongMasterPromise) {
                fetchSongMasterPromise = fetchAllSongMaster();
            }
            await fetchSongMasterPromise;
            fetchSongMasterPromise = null;
        }
    }

    if (typeof allScores === "undefined" || !Array.isArray(allScores) || allScores.length === 0) {
        alert("楽曲データベースが読み込まれていません。");
        return;
    }

    let pickedCondition = null;
    let pickedPoolIndex = -1;

    // ★ 5. 条件の取得
    if (isReSpin && targetCell && (targetCell.condition || targetCell.condition1 || targetCell.minConst1 !== undefined || targetCell.minConst !== undefined)) {
        pickedCondition = {
            id: targetCell.conditionId || targetCell.id || null,
            minConst1: targetCell.minConst1 ?? targetCell.minConst ?? 0,
            maxConst1: targetCell.maxConst1 ?? targetCell.maxConst ?? 0,
            minConst2: targetCell.minConst2 ?? targetCell.minConst1 ?? targetCell.minConst ?? 0,
            maxConst2: targetCell.maxConst2 ?? targetCell.maxConst1 ?? targetCell.maxConst ?? 0,
            minConst: targetCell.minConst1 ?? targetCell.minConst ?? 0,
            maxConst: targetCell.maxConst1 ?? targetCell.maxConst ?? 0,
            condition: targetCell.condition || targetCell.condition1 || "",
            condition1: targetCell.condition1 || targetCell.condition || "",
            condition2: targetCell.condition2 || targetCell.condition || "",
            isWE: targetCell.isWE || false,
            isWE2: targetCell.isWE2 || targetCell.isWE || false,
            maxBestAvg: targetCell.maxBestAvg ?? targetCell.conditionObj?.maxBestAvg ?? null
        };
    } else {
        let expandedPool = [];
        currentBingoState.conditionPool.forEach((p, poolIndex) => {
            const rem = p.remaining !== undefined ? p.remaining : (p.count || 0);
            for (let r = 0; r < rem; r++) {
                expandedPool.push({ conditionObj: p, poolIndex: poolIndex });
            }
        });

        if (expandedPool.length === 0) {
            alert("使用可能な残り条件がありません。すべて開栓済みです。");
            return;
        }

        const pickedItem = expandedPool[Math.floor(Math.random() * expandedPool.length)];
        pickedCondition = pickedItem.conditionObj;
        pickedPoolIndex = pickedItem.poolIndex;
    }

    // ★ 6. 重複回避キーの作成
    const assignedKeys = new Set();
    if (currentBingoState && currentBingoState.cells) {
        currentBingoState.cells.forEach((c, idx) => {
            if (idx === cellIndex) return;
            if (!c.isOpened || c.isFree || c.isCenter) return;

            if (c.song && c.song.title) assignedKeys.add(`${c.song.title}_${c.song.diff}`);
            if (c.song2 && c.song2.title) assignedKeys.add(`${c.song2.title}_${c.song2.diff}`);
        });
    }

    const minC1 = parseFloat(pickedCondition.minConst1 ?? pickedCondition.minConst ?? 0);
    const maxC1 = parseFloat(pickedCondition.maxConst1 ?? pickedCondition.maxConst ?? 0);
    const minC2 = parseFloat(pickedCondition.minConst2 ?? minC1);
    const maxC2 = parseFloat(pickedCondition.maxConst2 ?? maxC1);

    const cond1 = pickedCondition.condition1 || pickedCondition.condition || "";
    const cond2 = pickedCondition.condition2 || pickedCondition.condition || cond1;

    const condStrUpper = String(pickedCondition.condition || "").toUpperCase();
    const isWE1 = Boolean(pickedCondition.isWE) || condStrUpper.includes("WE") || condStrUpper.includes("WORLD");
    const isWE2 = Boolean(pickedCondition.isWE2 ?? pickedCondition.isWE) || condStrUpper.includes("WE") || condStrUpper.includes("WORLD");

    const candidates1 = allScores.filter(s => {
        const title = s.title || s.songTitle;
        const c = parseFloat(s.constant || s.const || 0);
        const isSongWE = typeof isWEDiff === "function" ? isWEDiff(s.diff) : (String(s.diff).toUpperCase() === "WE" || String(s.diff).includes("WORLD"));

        if (isWE1 !== isSongWE) return false;
        return c >= minC1 && c <= maxC1 && !assignedKeys.has(`${title}_${s.diff}`);
    });

    if (candidates1.length === 0) {
        alert(`該当する条件の楽曲候補（1曲目）がありません。\n条件: ${cond1 || "指定なし"}\n指定定数: ${minC1} ～ ${maxC1}\nWE判定: ${isWE1}`);
        return;
    }

    const candidates2 = allScores.filter(s => {
        const title = s.title || s.songTitle;
        const c = parseFloat(s.constant || s.const || 0);
        const isSongWE = typeof isWEDiff === "function" ? isWEDiff(s.diff) : (String(s.diff).toUpperCase() === "WE" || String(s.diff).includes("WORLD"));

        if (isWE2 !== isSongWE) return false;
        return c >= minC2 && c <= maxC2 && !assignedKeys.has(`${title}_${s.diff}`);
    });

    const candidatePool = {
        pool1: candidates1,
        pool2: candidates2.length > 0 ? candidates2 : candidates1
    };

    const targetMaxBestAvg = pickedCondition.maxBestAvg ?? null;

    const constRules = {
        minConst1: minC1,
        maxConst1: maxC1,
        minConst2: minC2,
        maxConst2: maxC2,
        maxBestAvg: targetMaxBestAvg,
        condition1: cond1,
        condition2: cond2
    };

    // ★ 7. ルーレット開始
    spinBingoCellRoulette(cellIndex, candidatePool, async (idx, sel1, sel2) => {
        if (!sel1) return;

        const song1Data = {
            title: sel1.title || sel1.songTitle,
            diff: sel1.diff,
            const: parseFloat(sel1.constant || sel1.const || 0)
        };

        const song2Data = sel2 ? {
            title: sel2.title || sel2.songTitle,
            diff: sel2.diff,
            const: parseFloat(sel2.constant || sel2.const || 0)
        } : null;

        const conditionData = {
            id: pickedCondition.id || null,
            minConst: minC1,
            maxConst: maxC1,
            minConst1: minC1,
            maxConst1: maxC1,
            minConst2: minC2,
            maxConst2: maxC2,
            condition: cond1,
            condition1: cond1,
            condition2: cond2,
            isWE: isWE1,
            isWE2: isWE2,
            maxBestAvg: targetMaxBestAvg
        };

        let updatedConditionPool = currentBingoState.conditionPool;
        if (!isReSpin && pickedPoolIndex !== -1) {
            updatedConditionPool = currentBingoState.conditionPool.map((poolItem, pIdx) => {
                if (pIdx === pickedPoolIndex) {
                    const rem = poolItem.remaining !== undefined ? poolItem.remaining : poolItem.count;
                    return { ...poolItem, remaining: Math.max(0, rem - 1) };
                }
                return poolItem;
            });
        }

        await openBingoCell(cellIndex, song1Data, song2Data, updatedConditionPool, conditionData);
    }, constRules);
}

/**
 * 開栓APIの送信
 */
async function openBingoCell(cellIndex, song1, song2, updatedConditionPool, conditionData) {
    try {
        const idx = parseInt(cellIndex, 10);
        const updatedCells = JSON.parse(JSON.stringify(currentBingoState.cells || []));

        if (updatedCells[idx]) {
            const targetCondition1 = conditionData?.condition1 ?? conditionData?.condition ?? updatedCells[idx].condition1 ?? updatedCells[idx].condition ?? "";
            const targetCondition2 = conditionData?.condition2 ?? conditionData?.condition ?? updatedCells[idx].condition2 ?? updatedCells[idx].condition ?? targetCondition1;

            const targetMaxBestAvg = conditionData ? (conditionData.maxBestAvg ?? null) : (updatedCells[idx].maxBestAvg ?? null);

            const minC1 = conditionData?.minConst1 ?? conditionData?.minConst ?? updatedCells[idx].minConst1 ?? updatedCells[idx].minConst ?? 0;
            const maxC1 = conditionData?.maxConst1 ?? conditionData?.maxConst ?? updatedCells[idx].maxConst1 ?? updatedCells[idx].maxConst ?? 0;
            const minC2 = conditionData?.minConst2 ?? conditionData?.minConst ?? updatedCells[idx].minConst2 ?? updatedCells[idx].minConst ?? minC1;
            const maxC2 = conditionData?.maxConst2 ?? conditionData?.maxConst ?? updatedCells[idx].maxConst2 ?? updatedCells[idx].maxConst ?? maxC1;

            updatedCells[idx] = {
                ...updatedCells[idx],
                song: song1,
                song2: song2,
                songTitle: song1.title,
                diff: song1.diff,
                const: song1.const,
                isOpened: true,
                conditionId: conditionData?.id ?? updatedCells[idx].conditionId ?? null,
                condition: targetCondition1,
                condition1: targetCondition1,
                condition2: targetCondition2,
                maxBestAvg: targetMaxBestAvg,
                minConst: minC1,
                maxConst: maxC1,
                minConst1: minC1,
                maxConst1: maxC1,
                minConst2: minC2,
                maxConst2: maxC2,
                isWE: conditionData?.isWE ?? updatedCells[idx].isWE ?? false,
                isWE2: conditionData?.isWE2 ?? updatedCells[idx].isWE2 ?? false
            };
        }

        const response = await fetch(GAS_URL, {
            method: "POST",
            headers: {
                "Content-Type": "text/plain;charset=utf-8"
            },
            body: JSON.stringify({
                mode: "open_bingo_cell",
                cellIndex: cellIndex,
                song: song1,
                song2: song2,
                conditionPool: updatedConditionPool,
                conditionData: conditionData,
                updatedCells: updatedCells
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const result = await response.json();

        if (result.status === "success" && result.data) {
            currentBingoState = result.data;
            renderUserBingoBoard(result.data);
            renderAdminBingoBoard(result.data);
            if (typeof renderAdminRulesForm === "function") renderAdminRulesForm();
        } else {
            alert("開栓失敗: " + (result.message || "エラーが発生しました"));
        }
    } catch (error) {
        console.error("開栓エラー:", error);
        alert("通信エラーが発生しました。");
    }
}

/**
 * ルーレット演出関数（豪華エフェクト追加版）
 */
function spinBingoCellRoulette(cellIndex, candidatePool, onConfirmedCallback, constRules = {}) {
    let pool1 = [];
    let pool2 = [];

    if (Array.isArray(candidatePool)) {
        pool1 = candidatePool;
        pool2 = candidatePool;
    } else if (candidatePool && typeof candidatePool === 'object') {
        pool1 = candidatePool.pool1 || [];
        pool2 = candidatePool.pool2 || [];
    }

    if (!pool1 || pool1.length === 0) {
        alert("該当する条件の楽曲候補（1曲目）がありません。");
        return;
    }

    // 1曲目決定
    const shuffled1 = shuffleArray(pool1);
    const finalSong1 = shuffled1[0];

    // 2曲目決定
    let finalSong2 = null;
    if (pool2 && pool2.length > 0) {
        const filteredPool2 = pool2.filter(s => (s.title || s.songTitle) !== (finalSong1.title || finalSong1.songTitle));
        const targetPool2 = filteredPool2.length > 0 ? filteredPool2 : pool2;
        const shuffled2 = shuffleArray(targetPool2);
        finalSong2 = shuffled2[0];
    }

    // 定数表示用文字列の生成関数
    function formatConstText(minVal, maxVal) {
        const min = (minVal !== undefined && minVal !== null && minVal !== "") ? Number(minVal) : null;
        const max = (maxVal !== undefined && maxVal !== null && maxVal !== "") ? Number(maxVal) : null;

        if (min !== null && max !== null) {
            if (min === max) {
                return `${min.toFixed(1)}`;
            }
            return `${min.toFixed(1)} 〜 ${max.toFixed(1)}`;
        } else if (min !== null) {
            return `${min.toFixed(1)} 以上`;
        } else if (max !== null) {
            return `${max.toFixed(1)} 以下`;
        }
        return "全範囲";
    }

    const const1Text = formatConstText(
        constRules.minConst1 ?? candidatePool.minConst1,
        constRules.maxConst1 ?? candidatePool.maxConst1
    );
    const const2Text = formatConstText(
        constRules.minConst2 ?? candidatePool.minConst2,
        constRules.maxConst2 ?? candidatePool.maxConst2
    );

    const cond1Badge = constRules.condition1 ? `<span style="font-size: 0.8rem; background: rgba(255, 235, 59, 0.2); color: #fff176; padding: 2px 8px; border-radius: 10px; border: 1px solid rgba(255, 235, 59, 0.4); font-weight: bold;">条件: ${escapeHTML(formatCondition(constRules.condition1))}</span>` : "";
    const cond2Badge = constRules.condition2 ? `<span style="font-size: 0.8rem; background: rgba(255, 235, 59, 0.2); color: #fff176; padding: 2px 8px; border-radius: 10px; border: 1px solid rgba(255, 235, 59, 0.4); font-weight: bold;">条件: ${escapeHTML(formatCondition(constRules.condition2))}</span>` : "";

    const limitHeaderHtml = constRules.maxBestAvg
        ? `<div style="font-size: 0.95rem; color: #ffca28; margin-top: 4px; font-weight: bold;">【ベスト枠平均上限: ～${parseFloat(constRules.maxBestAvg).toFixed(2)}】</div>`
        : "";

    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0, 0, 0, 0.92); z-index: 100000;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        color: white; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        backdrop-filter: blur(8px);
    `;

    overlay.innerHTML = `
        <div style="text-align: center; margin-bottom: 20px;">
            <div style="font-size: 1.3rem; color: #27ae60; font-weight: bold; letter-spacing: 2px;">
                DUAL ROULETTE CELL #${cellIndex + 1}
            </div>
            ${limitHeaderHtml}
        </div>
        
        <div style="display: flex; gap: 20px; align-items: center; justify-content: center; max-width: 900px; width: 90%; flex-wrap: wrap;">
            
            <!-- 1枠目 CHOICE 1 -->
            <div id="roulette-card-1" style="flex: 1; min-width: 280px; background: rgba(255, 255, 255, 0.05); padding: 15px; border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.1); text-align: center; transition: all 0.3s ease;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; gap: 4px;">
                    <span style="font-size: 0.85rem; color: #4fc3f7; font-weight: bold;">[ CHOICE 1 ]</span>
                    <div style="display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end;">
                        <span style="font-size: 0.8rem; background: rgba(79, 195, 247, 0.2); color: #81d4fa; padding: 2px 8px; border-radius: 10px; border: 1px solid rgba(79, 195, 247, 0.4); font-weight: bold;">
                            定数: ${const1Text}
                        </span>
                        ${cond1Badge}
                    </div>
                </div>
                <div id="roulette-title-1" style="font-size: 1.5rem; font-weight: bold; min-height: 2.5em; display: flex; align-items: center; justify-content: center; line-height: 1.2; transition: all 0.3s ease;"></div>
                <div id="roulette-diff-1" style="display: inline-block; padding: 4px 16px; border-radius: 15px; font-weight: bold; font-size: 1rem; margin-top: 8px; transition: all 0.3s ease;"></div>
            </div>

            <div style="font-size: 1.2rem; font-weight: bold; color: #ffeb3b;">OR</div>

            <!-- 2枠目 CHOICE 2 -->
            <div id="roulette-card-2" style="flex: 1; min-width: 280px; background: rgba(255, 255, 255, 0.05); padding: 15px; border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.1); text-align: center; transition: all 0.3s ease;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; gap: 4px;">
                    <span style="font-size: 0.85rem; color: #ffb74d; font-weight: bold;">[ CHOICE 2 ]</span>
                    <div style="display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end;">
                        <span style="font-size: 0.8rem; background: rgba(255, 183, 77, 0.2); color: #ffe0b2; padding: 2px 8px; border-radius: 10px; border: 1px solid rgba(255, 183, 77, 0.4); font-weight: bold;">
                            定数: ${const2Text}
                        </span>
                        ${cond2Badge}
                    </div>
                </div>
                <div id="roulette-title-2" style="font-size: 1.5rem; font-weight: bold; min-height: 2.5em; display: flex; align-items: center; justify-content: center; line-height: 1.2; transition: all 0.3s ease;"></div>
                <div id="roulette-diff-2" style="display: inline-block; padding: 4px 16px; border-radius: 15px; font-weight: bold; font-size: 1rem; margin-top: 8px; transition: all 0.3s ease;"></div>
            </div>

        </div>

        <div id="roulette-action-area" style="margin-top: 35px; min-height: 60px; display: flex; justify-content: center; align-items: center;"></div>
    `;
    document.body.appendChild(overlay);

    const titleEl1 = document.getElementById('roulette-title-1');
    const diffEl1 = document.getElementById('roulette-diff-1');
    const titleEl2 = document.getElementById('roulette-title-2');
    const diffEl2 = document.getElementById('roulette-diff-2');
    const cardEl1 = document.getElementById('roulette-card-1');
    const cardEl2 = document.getElementById('roulette-card-2');

    const diffColors = { 'EXP': '#ff4d4d', 'MAS': '#9966ff', 'ULT': '#2b2b2b' };

    function applyDiffStyle(targetEl, diffStr, itemObj) {
        if (!targetEl || !diffStr) return;
        const dUpper = String(diffStr || "").toUpperCase();
        if (dUpper === 'WE') {
            const attr = itemObj.weAttr || itemObj.attribute || "";
            targetEl.innerText = `WORLD'S END ${attr ? `【${attr}】` : ""}`;
            targetEl.style.background = 'linear-gradient(45deg, #ff3366, #ff9933, #33cc66, #3399ff, #9933ff)';
            targetEl.style.color = '#fff';
        } else {
            targetEl.innerText = diffStr;
            targetEl.style.background = diffColors[dUpper] || '#555';
            targetEl.style.color = '#fff';
        }
    }

    // Web Audio API による確定用ファンファーレ音源
    function playFanfareSound() {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;
            const ctx = new AudioContext();

            const notes = [
                { f: 523.25, t: 0.00, d: 0.12 }, // C5
                { f: 659.25, t: 0.12, d: 0.12 }, // E5
                { f: 783.99, t: 0.24, d: 0.12 }, // G5
                { f: 1046.50, t: 0.36, d: 0.40 } // C6 (長め)
            ];

            notes.forEach(n => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();

                osc.type = 'triangle';
                osc.frequency.setValueAtTime(n.f, ctx.currentTime + n.t);

                gain.gain.setValueAtTime(0.3, ctx.currentTime + n.t);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + n.t + n.d);

                osc.connect(gain);
                gain.connect(ctx.destination);

                osc.start(ctx.currentTime + n.t);
                osc.stop(ctx.currentTime + n.t + n.d);
            });
        } catch (e) {
            console.warn("Audio playback not supported or blocked by browser policy.", e);
        }
    }

    // 紙吹雪（コンフェッティ）パーティクル作成
    function triggerConfetti() {
        const colors = ['#f1c40f', '#e74c3c', '#3498db', '#2ecc71', '#9b59b6'];
        const confettiContainer = document.createElement('div');
        confettiContainer.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            pointer-events: none; z-index: 100002; overflow: hidden;
        `;
        document.body.appendChild(confettiContainer);

        for (let i = 0; i < 40; i++) {
            const particle = document.createElement('div');
            const color = colors[Math.floor(Math.random() * colors.length)];
            const size = Math.random() * 8 + 6;
            const startX = Math.random() * 100;
            const endX = startX + (Math.random() * 20 - 10);
            const duration = Math.random() * 1.5 + 1.2;

            particle.style.cssText = `
                position: absolute; top: -20px; left: ${startX}vw;
                width: ${size}px; height: ${size}px; background: ${color};
                border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
                opacity: 0.9;
                transform: rotate(${Math.random() * 360}deg);
                animation: confettiFall ${duration}s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
            `;
            confettiContainer.appendChild(particle);
        }

        // キーフレーム挿入
        if (!document.getElementById('confetti-style')) {
            const style = document.createElement('style');
            style.id = 'confetti-style';
            style.innerHTML = `
                @keyframes confettiFall {
                    0% { transform: translateY(0) rotate(0deg); opacity: 1; }
                    100% { transform: translateY(105vh) rotate(720deg); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }

        setTimeout(() => {
            if (document.body.contains(confettiContainer)) {
                document.body.removeChild(confettiContainer);
            }
        }, 3000);
    }

    let currentStep = 0;
    const totalSteps = 26;
    let delay = 55;

    function step() {
        if (currentStep < totalSteps - 1) {
            const temp1 = pool1[Math.floor(Math.random() * pool1.length)];
            const temp2 = (pool2 && pool2.length > 0) ? pool2[Math.floor(Math.random() * pool2.length)] : null;

            titleEl1.innerText = temp1.title || temp1.songTitle;
            applyDiffStyle(diffEl1, temp1.diff, temp1);

            if (temp2) {
                titleEl2.innerText = temp2.title || temp2.songTitle;
                applyDiffStyle(diffEl2, temp2.diff, temp2);
            } else {
                titleEl2.innerText = "ー";
            }
        } else {
            titleEl1.innerText = finalSong1.title || finalSong1.songTitle;
            applyDiffStyle(diffEl1, finalSong1.diff, finalSong1);

            if (finalSong2) {
                titleEl2.innerText = finalSong2.title || finalSong2.songTitle;
                applyDiffStyle(diffEl2, finalSong2.diff, finalSong2);
            } else {
                titleEl2.innerText = "（該当曲なし）";
            }
        }

        currentStep++;

        if (currentStep < totalSteps) {
            if (currentStep > totalSteps - 5) delay += 70;
            else if (currentStep > totalSteps - 10) delay += 30;
            setTimeout(step, delay);
        } else {
            finishSelection();
        }
    }

    step();

    function finishSelection() {
        // 音源再生
        playFanfareSound();

        // 紙吹雪エフェクト
        triggerConfetti();

        // フラッシュ演出
        const flash = document.createElement('div');
        flash.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: white; z-index: 100001; opacity: 1;
            transition: opacity 0.5s ease-out; pointer-events: none;
        `;
        document.body.appendChild(flash);

        // 決定時カードズームアップ & 発光ポップ演出
        cardEl1.style.transform = "scale(1.05)";
        cardEl1.style.borderColor = "rgba(241, 196, 15, 0.8)";
        cardEl1.style.boxShadow = "0 0 25px rgba(241, 196, 15, 0.4)";

        titleEl1.style.color = "#f1c40f";
        titleEl1.style.textShadow = "0 0 15px #f1c40f";
        diffEl1.style.boxShadow = `0 0 20px ${diffEl1.style.backgroundColor}`;

        if (finalSong2) {
            cardEl2.style.transform = "scale(1.05)";
            cardEl2.style.borderColor = "rgba(241, 196, 15, 0.8)";
            cardEl2.style.boxShadow = "0 0 25px rgba(241, 196, 15, 0.4)";

            titleEl2.style.color = "#f1c40f";
            titleEl2.style.textShadow = "0 0 15px #f1c40f";
            diffEl2.style.boxShadow = `0 0 20px ${diffEl2.style.backgroundColor}`;
        }

        requestAnimationFrame(() => {
            flash.style.opacity = "0";
            setTimeout(() => {
                if (document.body.contains(flash)) document.body.removeChild(flash);
            }, 500);
        });

        // ボタンのポップイン表示
        const actionArea = document.getElementById('roulette-action-area');
        if (actionArea) {
            const nextBtn = document.createElement('button');
            nextBtn.innerText = "この楽曲で確定する（次へ）";
            nextBtn.style.cssText = `
                padding: 12px 36px;
                font-size: 1.1rem;
                font-weight: bold;
                color: #ffffff;
                background: linear-gradient(135deg, #27ae60, #2ecc71);
                border: none;
                border-radius: 30px;
                cursor: pointer;
                box-shadow: 0 4px 15px rgba(39, 174, 96, 0.4);
                transform: scale(0.8);
                opacity: 0;
                transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            `;

            setTimeout(() => {
                nextBtn.style.transform = "scale(1)";
                nextBtn.style.opacity = "1";
            }, 150);

            nextBtn.onmouseover = () => { nextBtn.style.transform = "scale(1.08)"; };
            nextBtn.onmouseout = () => { nextBtn.style.transform = "scale(1)"; };

            nextBtn.onclick = () => {
                if (document.body.contains(overlay)) {
                    document.body.removeChild(overlay);
                }
                if (typeof onConfirmedCallback === 'function') {
                    onConfirmedCallback(cellIndex, finalSong1, finalSong2);
                }
            };

            actionArea.appendChild(nextBtn);
        }
    }
}

// Fisher-Yates シャッフル関数ヘルパー
function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}


/**
 * 全マス一括抽選（FREEマス対応版）
 */
async function bulkDrawAllBingoCells() {
    if (!currentBingoState || !currentBingoState.cells) return;
    if (!confirm("未開栓の全マスを一括で抽選して開きますか？")) return;

    if (typeof allScores === "undefined" || !Array.isArray(allScores) || allScores.length === 0) {
        if (typeof fetchAllSongMaster === "function") await fetchAllSongMaster();
    }

    const targetBtn = document.activeElement;
    const originalText = targetBtn && targetBtn.tagName === "BUTTON" ? targetBtn.innerText : "";
    if (targetBtn && targetBtn.tagName === "BUTTON") {
        targetBtn.disabled = true;
        targetBtn.innerText = "一括抽選中...";
    }

    try {
        let updatedCells = JSON.parse(JSON.stringify(currentBingoState.cells));
        let updatedPool = JSON.parse(JSON.stringify(currentBingoState.conditionPool || []));

        const getSongKey = (title, diff) => `${title}_${diff}`;

        let expandedPool = [];
        updatedPool.forEach((p, poolIndex) => {
            const rem = p.remaining !== undefined ? p.remaining : (p.count || 0);
            for (let r = 0; r < rem; r++) {
                expandedPool.push({
                    conditionObj: p,
                    poolIndex: poolIndex
                });
            }
        });

        expandedPool = shuffleArray(expandedPool);

        const assignedKeys = new Set();
        updatedCells.forEach(c => {
            if (c.isOpened && !c.isFree) {
                if (c.song && c.song.title) assignedKeys.add(getSongKey(c.song.title, c.song.diff));
                if (c.song2 && c.song2.title) assignedKeys.add(getSongKey(c.song2.title, c.song2.diff));
                if (c.songTitle && c.diff) assignedKeys.add(getSongKey(c.songTitle, c.diff));
            }
        });

        for (let i = 0; i < updatedCells.length; i++) {
            let cell = updatedCells[i];

            // ★ 開栓済み、またはFREEマスはスキップ
            if (cell.isOpened || cell.isFree) continue;

            if (expandedPool.length === 0) {
                console.warn(`マス No.${i + 1}: 使用可能な条件プールが残っていません。`);
                continue;
            }

            const pickedItem = expandedPool.shift();
            const pickedCondition = pickedItem.conditionObj;
            const pickedPoolIndex = pickedItem.poolIndex;

            const minC1 = parseFloat(pickedCondition.minConst1 ?? pickedCondition.minConst ?? 0);
            const maxC1 = parseFloat(pickedCondition.maxConst1 ?? pickedCondition.maxConst ?? 0);
            const minC2 = parseFloat(pickedCondition.minConst2 ?? minC1);
            const maxC2 = parseFloat(pickedCondition.maxConst2 ?? maxC1);
            const conditionStr = pickedCondition.condition || "";

            const condForWE = pickedCondition;
            const isWE1 = String(condForWE.condition || "").includes("WE") || Boolean(condForWE.isWE);
            const isWE2 = String(condForWE.condition || "").includes("WE") || Boolean(condForWE.isWE2 ?? condForWE.isWE);

            const c1 = allScores.filter(s => {
                const title = s.title || s.songTitle;
                const c = parseFloat(s.constant || s.const || 0);
                const isWE = typeof isWEDiff === "function" ? isWEDiff(s.diff) : false;
                if (isWE1 !== isWE) return false;
                return c >= minC1 && c <= maxC1 && !assignedKeys.has(getSongKey(title, s.diff));
            });

            if (c1.length > 0) {
                const sel1 = c1[Math.floor(Math.random() * c1.length)];
                const title1 = sel1.title || sel1.songTitle;
                const key1 = getSongKey(title1, sel1.diff);
                assignedKeys.add(key1);

                const c2 = allScores.filter(s => {
                    const title = s.title || s.songTitle;
                    const c = parseFloat(s.constant || s.const || 0);
                    const k = getSongKey(title, s.diff);
                    const isWE = typeof isWEDiff === "function" ? isWEDiff(s.diff) : false;
                    if (isWE2 !== isWE) return false;
                    return c >= minC2 && c <= maxC2 && !assignedKeys.has(k);
                });

                let sel2 = null;
                if (c2.length > 0) {
                    sel2 = c2[Math.floor(Math.random() * c2.length)];
                    const title2 = sel2.title || sel2.songTitle;
                    assignedKeys.add(getSongKey(title2, sel2.diff));
                }

                updatedCells[i] = {
                    ...cell,
                    isOpened: true,
                    conditionId: pickedCondition.id || cell.conditionId,
                    condition: conditionStr,
                    song: {
                        title: title1,
                        diff: sel1.diff,
                        const: parseFloat(sel1.constant || sel1.const || 0)
                    },
                    song2: sel2 ? {
                        title: sel2.title || sel2.songTitle,
                        diff: sel2.diff,
                        const: parseFloat(sel2.constant || sel2.const || 0)
                    } : null,
                    songTitle: title1,
                    diff: sel1.diff,
                    const: parseFloat(sel1.constant || sel1.const || 0),
                    minConst1: minC1,
                    maxConst1: maxC1,
                    minConst2: minC2,
                    maxConst2: maxC2,
                    minConst: minC1,
                    maxConst: maxC1,
                    maxBestAvg: pickedCondition.maxBestAvg || null
                };

                if (updatedPool[pickedPoolIndex]) {
                    const currentRem = updatedPool[pickedPoolIndex].remaining !== undefined
                        ? updatedPool[pickedPoolIndex].remaining
                        : updatedPool[pickedPoolIndex].count;
                    updatedPool[pickedPoolIndex].remaining = Math.max(0, currentRem - 1);
                }
            } else {
                console.warn(`マス No.${i + 1}: 条件（定数 ${minC1}〜${maxC1} / WE:${isWE1}）に一致する楽曲が見つかりませんでした。`);
            }
        }

        const response = await fetch(GAS_URL, {
            method: "POST",
            body: JSON.stringify({
                mode: "bulk_open_bingo_cells",
                updatedCells: updatedCells,
                conditionPool: updatedPool
            })
        });

        const resData = await response.json();
        if (resData.status === "success" && resData.data) {
            currentBingoState = resData.data;
            renderUserBingoBoard(resData.data);
            renderAdminBingoBoard(resData.data);
            if (typeof renderAdminRulesForm === "function") renderAdminRulesForm();
            alert("すべてのマスを一括開栓しました！");
        } else {
            alert("保存失敗: " + (resData.message || ""));
        }
    } catch (err) {
        console.error(err);
        alert("通信エラーが発生しました。");
    } finally {
        if (targetBtn && targetBtn.tagName === "BUTTON") {
            targetBtn.disabled = false;
            targetBtn.innerText = originalText;
        }
    }
}


/**
 * 全マスを一括リロール（条件カウント入れ替わり防止・2曲＆べ枠対応版）
 */
async function bulkRerollAllBingoCells() {
    if (!currentBingoState || !currentBingoState.cells) return;
    if (!confirm("【警告】現在の設定条件に基づき、全マスを最初から一括リロール（再抽選）しますか？")) return;

    if (typeof allScores === "undefined" || !Array.isArray(allScores) || allScores.length === 0) {
        if (typeof fetchAllSongMaster === "function") await fetchAllSongMaster();
    }

    const targetBtn = document.activeElement;
    const originalText = targetBtn && targetBtn.tagName === "BUTTON" ? targetBtn.innerText : "";
    if (targetBtn && targetBtn.tagName === "BUTTON") {
        targetBtn.disabled = true;
        targetBtn.innerText = "リロール中...";
    }

    try {
        // ★ 1. プールのリセット (インデックスをIDとして確実に紐付け)
        let resetPool = (currentBingoState.conditionPool || []).map((p, idx) => {
            const count = p.total !== undefined ? p.total : (p.count !== undefined ? p.count : (p.remaining || 0));
            return {
                ...p,
                poolIndex: idx, // 元の条件行インデックスを固定
                total: count,
                count: count,
                remaining: count // 全件リロールなのでカウントを最大値にリセット
            };
        });

        // ★ 2. 展開用プールを作成（元データのインデックス情報を保持）
        let expandedPool = [];
        resetPool.forEach(p => {
            for (let c = 0; c < p.total; c++) {
                expandedPool.push({
                    conditionObj: JSON.parse(JSON.stringify(p)),
                    poolIndex: p.poolIndex
                });
            }
        });

        // 条件プールをシャッフル
        expandedPool = shuffleArray(expandedPool);

        let newCells = JSON.parse(JSON.stringify(currentBingoState.cells));
        const assignedKeys = new Set();

        for (let i = 0; i < newCells.length; i++) {
            if (newCells[i].isFree) continue;

            if (expandedPool.length === 0) {
                console.warn(`マス No.${i + 1}: 残り条件が不足しているため抽選をスキップしました。`);
                continue;
            }

            // プールから1つ条件を取り出す
            const pickedItem = expandedPool.shift();
            const pickedCondition = pickedItem.conditionObj;
            const targetPoolIndex = pickedItem.poolIndex; // 元の条件の配列番号

            // 定数の抽出（1曲目・2曲目それぞれ）
            const minC1 = parseFloat(pickedCondition.minConst1 ?? pickedCondition.minConst ?? 0);
            const maxC1 = parseFloat(pickedCondition.maxConst1 ?? pickedCondition.maxConst ?? 0);
            const minC2 = parseFloat(pickedCondition.minConst2 ?? minC1);
            const maxC2 = parseFloat(pickedCondition.maxConst2 ?? maxC1);

            const cond1 = pickedCondition.condition1 || pickedCondition.condition || "";
            const cond2 = pickedCondition.condition2 || pickedCondition.condition || cond1;

            const condStrUpper = String(pickedCondition.condition || "").toUpperCase();
            const isWE1 = Boolean(pickedCondition.isWE) || condStrUpper.includes("WORLD") || /\bWE\b/.test(condStrUpper);
            const isWE2 = Boolean(pickedCondition.isWE2 ?? pickedCondition.isWE) || condStrUpper.includes("WORLD") || /\bWE\b/.test(condStrUpper);

            // 1曲目の選曲
            const candidates1 = allScores.filter(s => {
                const title = s.title || s.songTitle;
                const c = parseFloat(s.constant || s.const || 0);
                const isSongWE = typeof isWEDiff === "function" ? isWEDiff(s.diff) : (String(s.diff).toUpperCase() === "WE");
                if (isWE1 !== isSongWE) return false;
                return c >= minC1 && c <= maxC1 && !assignedKeys.has(`${title}_${s.diff}`);
            });

            if (candidates1.length === 0) {
                console.warn(`マス No.${i + 1}: 定数 ${minC1}～${maxC1} に該当する楽曲が見つかりませんでした。`);
                continue;
            }

            const sel1 = candidates1[Math.floor(Math.random() * candidates1.length)];
            const key1 = `${sel1.title || sel1.songTitle}_${sel1.diff}`;
            assignedKeys.add(key1);

            // 2曲目の選曲
            const candidates2 = allScores.filter(s => {
                const title = s.title || s.songTitle;
                const c = parseFloat(s.constant || s.const || 0);
                const k = `${title}_${s.diff}`;
                const isSongWE = typeof isWEDiff === "function" ? isWEDiff(s.diff) : (String(s.diff).toUpperCase() === "WE");
                if (isWE2 !== isSongWE) return false;
                return c >= minC2 && c <= maxC2 && !assignedKeys.has(k) && k !== key1;
            });

            let sel2 = null;
            if (candidates2.length > 0) {
                sel2 = candidates2[Math.floor(Math.random() * candidates2.length)];
                assignedKeys.add(`${sel2.title || sel2.songTitle}_${sel2.diff}`);
            }

            // マス更新
            newCells[i] = {
                ...newCells[i],
                isOpened: true,
                isCleared: false,
                clearedBy: "",
                clearedAt: "",
                conditionId: pickedCondition.id || null,
                condition: cond1,
                condition1: cond1,
                condition2: cond2,
                minConst1: minC1,
                maxConst1: maxC1,
                minConst2: minC2,
                maxConst2: maxC2,
                minConst: minC1,
                maxConst: maxC1,
                isWE: isWE1,
                isWE2: isWE2,
                maxBestAvg: pickedCondition.maxBestAvg ?? null,
                song: {
                    title: sel1.title || sel1.songTitle,
                    diff: sel1.diff,
                    const: parseFloat(sel1.constant || sel1.const || 0)
                },
                song2: sel2 ? {
                    title: sel2.title || sel2.songTitle,
                    diff: sel2.diff,
                    const: parseFloat(sel2.constant || sel2.const || 0)
                } : null,
                songTitle: sel1.title || sel1.songTitle,
                diff: sel1.diff,
                const: parseFloat(sel1.constant || sel1.const || 0)
            };

            // ★ 3. poolIndex を使って直接元の条件行の remaining を減算（入れ替わり防止）
            if (resetPool[targetPoolIndex]) {
                resetPool[targetPoolIndex].remaining = Math.max(0, resetPool[targetPoolIndex].remaining - 1);
            }
        }

        // 保存リクエスト
        const response = await fetch(GAS_URL, {
            method: "POST",
            body: JSON.stringify({
                mode: "bulk_open_bingo_cells",
                updatedCells: newCells,
                conditionPool: resetPool
            })
        });

        const resData = await response.json();
        if (resData.status === "success" && resData.data) {
            currentBingoState = resData.data;
            renderUserBingoBoard(resData.data);
            renderAdminBingoBoard(resData.data);
            if (typeof renderAdminRulesForm === "function") renderAdminRulesForm();
            alert("全マスを設定条件に基づきリロールしました！");
        } else {
            alert("リロール保存失敗: " + (resData.message || ""));
        }
    } catch (err) {
        console.error(err);
        alert("通信エラーが発生しました。");
    } finally {
        if (targetBtn && targetBtn.tagName === "BUTTON") {
            targetBtn.disabled = false;
            targetBtn.innerText = originalText;
        }
    }
}

/**
 * 新規カード生成ボタン押下時の処理
 */
async function submitCreateNewBingo(btnEl) {
    if (typeof adminConditionPool === "undefined" || !Array.isArray(adminConditionPool)) {
        alert("条件プールが初期化されていません。");
        return;
    }

    // ★ 1. item.count を安全に数値変換して合計（NaN防止）
    const totalCells = adminConditionPool.reduce((sum, item) => {
        const count = Number(item.count) || 0;
        return sum + count;
    }, 0);

    // ★ 2. 中央の協力マスを除いた「24マス分」チェック
    if (totalCells !== 24) {
        alert(`合計が24マス分になるように条件を設定してください。（現在の合計: ${totalCells}マス / 中央協力マスを除く）`);
        return;
    }

    if (!confirm("新しいビンゴカードを発行しますか？（非公開で生成されます）")) return;

    // ★ 3. GASの initBingoData に適合する 24マス分ルール配列（rules24）を構築
    const rules24 = [];
    adminConditionPool.forEach(item => {
        const count = Number(item.count) || 0;
        for (let i = 0; i < count; i++) {
            const minC1 = item.minConst1 ?? item.minConst ?? 0;
            const maxC1 = item.maxConst1 ?? item.maxConst ?? 0;
            const minC2 = item.minConst2 !== undefined && item.minConst2 !== "" ? item.minConst2 : null;
            const maxC2 = item.maxConst2 !== undefined && item.maxConst2 !== "" ? item.maxConst2 : null;
            const cond1 = item.condition1 || item.condition || "SSS";
            const cond2 = item.condition2 || item.condition || cond1;

            rules24.push({
                minConst1: parseFloat(minC1),
                maxConst1: parseFloat(maxC1),
                minConst2: minC2 !== null ? parseFloat(minC2) : null,
                maxConst2: maxC2 !== null ? parseFloat(maxC2) : null,
                condition: String(cond1),
                condition1: String(cond1),
                condition2: String(cond2),
                maxBestAvg: (item.maxBestAvg !== undefined && item.maxBestAvg !== null && item.maxBestAvg !== "") ? parseFloat(item.maxBestAvg) : null,
                isFree: Boolean(item.isFree)
            });
        }
    });

    // ★ 4. 条件プールデータ（GAS側の conditionPool 構造と同調）
    const conditionPoolData = adminConditionPool.map((item, index) => {
        const count = Number(item.count) || 0;
        const minC1 = item.minConst1 ?? item.minConst ?? 0;
        const maxC1 = item.maxConst1 ?? item.maxConst ?? 0;
        const minC2 = item.minConst2 !== undefined && item.minConst2 !== "" ? item.minConst2 : null;
        const maxC2 = item.maxConst2 !== undefined && item.maxConst2 !== "" ? item.maxConst2 : null;
        const cond1 = item.condition1 || item.condition || "SSS";
        const cond2 = item.condition2 || item.condition || cond1;

        return {
            id: item.id !== undefined ? item.id : (index + 1),
            minConst1: parseFloat(minC1),
            maxConst1: parseFloat(maxC1),
            minConst2: minC2 !== null ? parseFloat(minC2) : null,
            maxConst2: maxC2 !== null ? parseFloat(maxC2) : null,
            condition: String(cond1),
            condition1: String(cond1),
            condition2: String(cond2),
            maxBestAvg: (item.maxBestAvg !== undefined && item.maxBestAvg !== null && item.maxBestAvg !== "") ? parseFloat(item.maxBestAvg) : null,
            total: count,
            remaining: count
        };
    });

    // 中央協力マスのターゲットスコア（入力フォーム等から取得、デフォルトは1000万）
    const centerTargetEl = document.getElementById("admin-center-target-score");
    const centerTargetScore = centerTargetEl ? parseFloat(centerTargetEl.value) || 10000000 : 10000000;

    try {
        if (btnEl) btnEl.disabled = true;
        await createNewBingoCard(rules24, conditionPoolData, centerTargetScore);
    } finally {
        if (btnEl) btnEl.disabled = false;
    }
}

/**
 * 新規カード発行（GAS通信）
 */
async function createNewBingoCard(rulesData, conditionPoolData, centerTargetScore) {
    try {
        const response = await fetch(GAS_URL, {
            method: "POST",
            body: JSON.stringify({
                mode: "init_bingo_data",
                rules: rulesData,
                conditionPool: conditionPoolData,
                centerTargetScore: centerTargetScore
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const result = await response.json();

        if (result.status === "success" && result.data) {
            alert("新規ビンゴカードを作成しました。管理画面上でマスの開栓を行ってください。");

            // グローバル状態の更新
            if (typeof currentBingoState !== "undefined") {
                currentBingoState = {
                    ...result.data,
                    isPublished: false
                };
            }

            // 各UIコンポーネントの再描画
            if (typeof renderUserBingoBoard === "function") {
                renderUserBingoBoard(result.data);
            }
            if (typeof renderAdminBingoBoard === "function") {
                renderAdminBingoBoard(result.data);
            }
            if (typeof renderAdminRulesForm === "function") {
                renderAdminRulesForm(false);
            }
            if (typeof updateAdminPublishStatusUI === "function") {
                updateAdminPublishStatusUI(false);
            }
        } else {
            alert("作成失敗: " + (result.message || "エラーが発生しました"));
        }
    } catch (error) {
        console.error("初期化エラー:", error);
        alert("通信エラーが発生しました。");
    }
}


// モーダル表示制御
function openBingoModal() {
    document.getElementById("bingo-modal").style.display = "flex";
}

function closeBingoModal() {
    document.getElementById("bingo-modal").style.display = "none";
}

async function openBingoAdminModal() {
    const isAuthed = sessionStorage.getItem("bingo_admin_authed");
    if (!isAuthed) {
        const pw = prompt("管理者パスワードを入力してください:");
        if (pw === "admin123") {
            sessionStorage.setItem("bingo_admin_authed", "true");
        } else {
            if (pw !== null) alert("パスワードが違います。");
            return;
        }
    }

    document.getElementById("bingo-admin-modal").style.display = "flex";

    if (typeof fetchBingoData === "function") {
        await fetchBingoData(true);
    }

    if (typeof loadConditionPoolFromStorage === "function") {
        adminConditionPool = loadConditionPoolFromStorage();
    } else if (!adminConditionPool) {
        adminConditionPool = [];
    }

    renderAdminRulesForm();
    if (currentBingoState) {
        renderAdminBingoBoard(currentBingoState);
        updateAdminPublishStatusUI(!!currentBingoState.isPublished);
    }
}

function closeBingoAdminModal() {
    document.getElementById("bingo-admin-modal").style.display = "none";
}

let editingIndex = -1;

/**
 * フォームの入力値を保持・復元するためのヘルパー関数
 */
function getFormData() {
    return {
        min1: document.getElementById("pool-min")?.value || "",
        max1: document.getElementById("pool-max")?.value || "",
        min2: document.getElementById("pool-min2")?.value || "",
        max2: document.getElementById("pool-max2")?.value || "",
        cond1: document.getElementById("pool-cond")?.value || "SSS",
        cond2: document.getElementById("pool-cond2")?.value || "",
        maxRating: document.getElementById("pool-max-rating")?.value || "",
        count: document.getElementById("pool-count")?.value || "2"
    };
}

function restoreFormData(data) {
    if (!data) return;
    if (document.getElementById("pool-min")) document.getElementById("pool-min").value = data.min1;
    if (document.getElementById("pool-max")) document.getElementById("pool-max").value = data.max1;
    if (document.getElementById("pool-min2")) document.getElementById("pool-min2").value = data.min2;
    if (document.getElementById("pool-max2")) document.getElementById("pool-max2").value = data.max2;
    if (document.getElementById("pool-cond")) document.getElementById("pool-cond").value = data.cond1;
    if (document.getElementById("pool-cond2")) document.getElementById("pool-cond2").value = data.cond2;
    if (document.getElementById("pool-max-rating")) document.getElementById("pool-max-rating").value = data.maxRating;
    if (document.getElementById("pool-count")) document.getElementById("pool-count").value = data.count;
}

/**
 * 条件選択肢のHTMLを出力するヘルパー
 */
function getConditionOptionsHTML(selectedValue = "") {
    const options = [
        { val: "SS", label: "SS" },
        { val: "SS_PLUS", label: "SS+" },
        { val: "7000", label: "7000" },
        { val: "8000", label: "8000" },
        { val: "8500", label: "8500" },
        { val: "SSS", label: "SSS" },
        { val: "SSS_PLUS", label: "SSS+" },
        { val: "AJ", label: "AJ" },
        { val: "AJ_99", label: "99AJ" },
        { val: "AJ_995", label: "995AJ" },
        { val: "THEORY", label: "理論値" }
    ];
    return options.map(opt => `<option value="${opt.val}" ${opt.val === selectedValue ? "selected" : ""}>${opt.label}</option>`).join('');
}

/**
 * 設定済み＆残り条件一覧の描画更新
 */
function renderAdminRulesForm(forceEdit = false, preserveFormValues = false) {
    const container = document.getElementById("admin-rules-form");
    if (!container) return;

    const savedFormData = preserveFormValues ? getFormData() : null;

    const isBingoCreated = !forceEdit && currentBingoState && currentBingoState.cells && currentBingoState.cells.length > 0;
    const poolList = isBingoCreated ? currentBingoState.conditionPool : adminConditionPool;

    const totalCells = poolList.reduce((sum, item) => {
        if (isBingoCreated) {
            return sum + (item.remaining !== undefined ? item.remaining : (item.total || 0));
        } else {
            return sum + (item.count || item.total || 0);
        }
    }, 0);

    const hasUnopenedCells = isBingoCreated && currentBingoState.cells.some(c => !c.isOpened && !c.isFree);

    container.innerHTML = `
        <div style="background: #e3f2fd; padding: 12px; border-radius: 8px; border: 1px solid #90caf9; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
            <div>
                <strong style="font-size: 14px; color: #0d47a1;">公開ステータス:</strong>
                <span id="admin-publish-label" style="font-weight: bold; margin-left: 8px;">確認中...</span>
            </div>
            <button type="button" id="toggle-publish-btn" onclick="handlePublishToggleClick()" style="padding: 6px 14px; font-weight: bold; border-radius: 4px; border: none; cursor: pointer; color: #fff; background: #1976d2;">
                切り替える
            </button>
        </div>

        <div style="background: #fff; padding: 12px; border-radius: 8px; border: 1px solid #ddd; margin-bottom: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <div style="font-weight: bold; font-size: 14px;">新規カード生成（条件プール設定）</div>
                <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                    ${isBingoCreated ? (
            hasUnopenedCells ? `
                            <button type="button" onclick="bulkDrawAllBingoCells()" style="background: #e65100; color: #fff; border: none; border-radius: 4px; padding: 4px 10px; font-size: 12px; font-weight: bold; cursor: pointer;">
                                未開栓を一括抽選
                            </button>
                        ` : `
                            <button type="button" onclick="bulkRerollAllBingoCells()" style="background: #d32f2f; color: #fff; border: none; border-radius: 4px; padding: 4px 10px; font-size: 12px; font-weight: bold; cursor: pointer;" title="FREE以外の24マスを初期条件から再抽選します">
                                全マス一括リロール
                            </button>
                        `
        ) : ''}
                    ${isBingoCreated ? `
                        <button type="button" onclick="switchToEditMode(true)" style="background:#0288d1; color:#fff; border:none; border-radius:4px; padding:4px 8px; font-size:12px; cursor:pointer;" title="現在の条件を引き継いで編集します">条件を流用して編集</button>
                        <button type="button" onclick="clearAndCreateNewRules()" style="background:#757575; color:#fff; border:none; border-radius:4px; padding:4px 8px; font-size:12px; cursor:pointer;" title="条件をすべて消去して作り直します">条件を一括クリア</button>
                    ` : ''}
                </div>
            </div>
            
            <!-- 定数条件設定エリア -->
            <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 8px;">
                <div style="display: flex; align-items: center; gap: 4px; background: #f1f8e9; padding: 4px 8px; border-radius: 4px; border: 1px solid #c8e6c9;">
                    <span style="font-size: 12px; font-weight: bold; color: #2e7d32;">1曲目:</span>
                    <input type="number" id="pool-min" step="0.1" value="15.0" style="width: 55px; padding: 3px;" title="1曲目 最小定数">
                    <span>～</span>
                    <input type="number" id="pool-max" step="0.1" value="15.0" style="width: 55px; padding: 3px;" title="1曲目 最大定数">
                    <select id="pool-cond" style="padding: 3px;">
                        ${getConditionOptionsHTML("SSS")}
                    </select>
                </div>

                <div style="display: flex; align-items: center; gap: 4px; background: #ffebee; padding: 4px 8px; border-radius: 4px; border: 1px solid #ffcdd2;">
                    <span style="font-size: 12px; font-weight: bold; color: #c62828;">2曲目:</span>
                    <input type="number" id="pool-min2" step="0.1" placeholder="同上" style="width: 55px; padding: 3px;" title="2曲目 最小定数">
                    <span>～</span>
                    <input type="number" id="pool-max2" step="0.1" placeholder="同上" style="width: 55px; padding: 3px;" title="2曲目 最大定数">
                    <select id="pool-cond2" style="padding: 3px;">
                        <option value="">(同上)</option>
                        ${getConditionOptionsHTML("")}
                    </select>
                </div>
            </div>

            <!-- クリア条件・ベスト枠上限・マス数設定エリア -->
            <div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center;">
                <input type="number" id="pool-max-rating" step="0.01" placeholder="上限(任意)" style="width: 80px; padding: 4px;" title="ベスト枠上限">
                <input type="number" id="pool-count" min="1" max="24" value="2" style="width: 50px; padding: 4px;" title="マス数">
                <span>マス分</span>
                
                <button type="button" id="admin-rule-submit-btn" onclick="addAdminConditionRule()" style="padding: 4px 10px; background: ${editingIndex >= 0 ? '#4caf50' : '#ff9800'}; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
                    ${editingIndex >= 0 ? '更新' : '追加'}
                </button>
                ${editingIndex >= 0 ? `
                    <button type="button" onclick="cancelEditRule()" style="padding: 4px 8px; background: #9e9e9e; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">
                        キャンセル
                    </button>
                ` : ''}
            </div>
        </div>

        <div style="background: #f9f9f9; padding: 10px; border-radius: 8px; border: 1px solid #eee;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-weight: bold; font-size: 14px;">${isBingoCreated ? '現在の残り条件一覧' : '設定済み条件一覧'}</span>
                <span style="font-weight: bold; font-size: 14px;">
                    ${isBingoCreated ? '残り合計:' : '合計:'} 
                    <span style="color: ${(!isBingoCreated && totalCells === 24) || isBingoCreated ? '#2e7d32' : '#d32f2f'};">${totalCells}</span> 
                    ${isBingoCreated ? 'マス' : '/ 24マス (+ FREE 1マス)'}
                </span>
            </div>
            <div id="condition-pool-list" style="display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow-y: auto;">
                ${poolList.length === 0 ? '<div style="color:#888; font-size:12px; text-align:center; padding:10px;">条件が設定されていません</div>' : ''}
                ${poolList.map((rule, idx) => {
            const min1 = rule.minConst1 ?? rule.minConst;
            const max1 = rule.maxConst1 ?? rule.maxConst;
            const min2 = rule.minConst2 ?? min1;
            const max2 = rule.maxConst2 ?? max1;

            const cond1 = rule.condition1 ?? rule.condition;
            const cond2 = rule.condition2 ?? cond1;

            const isRemainingMode = isBingoCreated;
            const rem = isRemainingMode ? rule.remaining : rule.count;
            const tot = isRemainingMode ? rule.total : rule.count;

            const limitText = rule.maxBestAvg ? ` (～${parseFloat(rule.maxBestAvg).toFixed(2)})` : "";

            let detailText = `[1曲目] ${min1}～${max1} (${formatCondition(cond1)})`;
            if (min2 !== min1 || max2 !== max1 || cond2 !== cond1) {
                detailText += ` / [2曲目] ${min2}～${max2} (${formatCondition(cond2)})`;
            } else {
                detailText += ` (両曲共通)`;
            }

            const isEditingThis = editingIndex === idx;

            return `
                        <div style="display: flex; justify-content: space-between; align-items: center; background: ${isEditingThis ? '#fffde7' : '#fff'}; padding: 6px 10px; border-radius: 4px; border: 1px solid ${isEditingThis ? '#fbc02d' : '#e0e0e0'}; font-size: 13px; ${rem === 0 ? 'opacity: 0.5;' : ''}">
                            <span>${detailText}${limitText} : <strong>${isRemainingMode ? `残り ${rem} / ${tot}` : `${tot}`} マス分</strong></span>
                            ${!isBingoCreated ? `
                                <div style="display: flex; gap: 4px;">
                                    <button onclick="editAdminConditionRule(${idx})" style="background: #0288d1; color: #fff; border: none; border-radius: 3px; padding: 2px 6px; cursor: pointer; font-size: 11px;">編集</button>
                                    <button onclick="removeAdminConditionRule(${idx})" style="background: #ff4d4d; color: #fff; border: none; border-radius: 3px; padding: 2px 6px; cursor: pointer; font-size: 11px;">削除</button>
                                </div>
                            ` : ''}
                        </div>
                    `;
        }).join('')}
            </div>
        </div>
    `;

    if (preserveFormValues && savedFormData) {
        restoreFormData(savedFormData);
    }

    const submitBtn = document.getElementById("submit-create-bingo-btn");
    if (submitBtn) {
        if (!isBingoCreated) {
            submitBtn.disabled = totalCells !== 24;
            submitBtn.style.opacity = totalCells === 24 ? "1" : "0.5";
            submitBtn.style.cursor = totalCells === 24 ? "pointer" : "not-allowed";
        }
    }

    if (typeof updateAdminPublishStatusUI === "function") {
        const isPublished = currentBingoState ? !!currentBingoState.isPublished : false;
        updateAdminPublishStatusUI(isPublished);
    }
}

/**
 * 💡 条件の追加および更新（編集完了）の共通処理
 */
function addAdminConditionRule() {
    const minConst1 = parseFloat(document.getElementById("pool-min").value) || 0;
    const maxConst1 = parseFloat(document.getElementById("pool-max").value) || 0;

    const min2Val = document.getElementById("pool-min2")?.value;
    const max2Val = document.getElementById("pool-max2")?.value;

    const minConst2 = (min2Val !== "" && min2Val !== undefined) ? parseFloat(min2Val) : minConst1;
    const maxConst2 = (max2Val !== "" && max2Val !== undefined) ? parseFloat(max2Val) : maxConst1;

    if (minConst1 > maxConst1) {
        alert("1曲目の最小定数は最大定数以下に設定してください。");
        return;
    }
    if (minConst2 > maxConst2) {
        alert("2曲目の最小定数は最大定数以下に設定してください。");
        return;
    }

    const condition1 = document.getElementById("pool-cond").value;
    const cond2Val = document.getElementById("pool-cond2")?.value;
    const condition2 = (cond2Val !== "" && cond2Val !== undefined) ? cond2Val : condition1;

    const count = parseInt(document.getElementById("pool-count").value, 10) || 0;

    const maxRatingVal = document.getElementById("pool-max-rating").value;
    const maxBestAvg = maxRatingVal !== "" ? parseFloat(maxRatingVal) : null;

    if (count <= 0) return;

    const currentTotal = adminConditionPool.reduce((sum, item, idx) => {
        return sum + (idx === editingIndex ? 0 : item.count);
    }, 0);

    if (currentTotal + count > 24) {
        alert("合計が24マス（FREEマス除く）を超えてしまいます。");
        return;
    }

    const ruleData = {
        minConst1,
        maxConst1,
        minConst2,
        maxConst2,
        minConst: minConst1,
        maxConst: maxConst1,
        condition1,
        condition2,
        condition: condition1, // 既存ロジック用フォールバック
        count,
        maxBestAvg
    };

    if (editingIndex >= 0) {
        adminConditionPool[editingIndex] = ruleData;
        editingIndex = -1;
    } else {
        adminConditionPool.push(ruleData);
    }

    renderAdminRulesForm(true, false);
}

/**
 * 💡 既存の条件を入力欄に読み込んで編集モードへ移行する
 */
function editAdminConditionRule(index) {
    const rule = adminConditionPool[index];
    if (!rule) return;

    editingIndex = index;

    renderAdminRulesForm(true, false);

    document.getElementById("pool-min").value = rule.minConst1 ?? rule.minConst ?? 15.0;
    document.getElementById("pool-max").value = rule.maxConst1 ?? rule.maxConst ?? 15.0;

    document.getElementById("pool-min2").value = (rule.minConst2 !== undefined && rule.minConst2 !== rule.minConst1) ? rule.minConst2 : "";
    document.getElementById("pool-max2").value = (rule.maxConst2 !== undefined && rule.maxConst2 !== rule.maxConst1) ? rule.maxConst2 : "";

    const c1 = rule.condition1 ?? rule.condition ?? "SSS";
    const c2 = rule.condition2 ?? c1;

    document.getElementById("pool-cond").value = c1;
    document.getElementById("pool-cond2").value = (c2 !== c1) ? c2 : "";

    document.getElementById("pool-max-rating").value = rule.maxBestAvg !== null && rule.maxBestAvg !== undefined ? rule.maxBestAvg : "";
    document.getElementById("pool-count").value = rule.count || 2;
}

/**
 * 💡 編集モードのキャンセル
 */
function cancelEditRule() {
    editingIndex = -1;
    renderAdminRulesForm(true, false);
}

/**
 * 💡 条件削除処理（現在の入力値を維持したまま削除）
 */
function removeAdminConditionRule(index) {
    adminConditionPool.splice(index, 1);

    if (editingIndex === index) {
        editingIndex = -1;
    } else if (editingIndex > index) {
        editingIndex--;
    }

    renderAdminRulesForm(true, true);
}




// ==========================================
// 1. 公開 / 非公開の切り替え処理
// ==========================================

/**
 * 💡 「公開する / 非公開にする」ボタンのクリックハンドラー
 */
async function handlePublishToggleClick() {
    const currentState = currentBingoState || { isPublished: false, cells: [] };
    const targetState = !currentState.isPublished;
    const unopenedCount = currentState.cells ? currentState.cells.filter(c => !c.isOpened && !c.isFree).length : 0;

    if (targetState && unopenedCount > 0) {
        if (!confirm(`まだ未確定（抽選前）のマスが ${unopenedCount} 個あります。\nこのまま公開してもよろしいですか？`)) {
            return;
        }
    }

    if (confirm(`ビンゴカードを「${targetState ? '公開' : '非公開'}」に変更しますか？`)) {
        await toggleBingoPublishStatus(targetState);
    }
}

/**
 * 💡 ビンゴの公開 / 非公開状態をGASに送信して更新する
 */
async function toggleBingoPublishStatus(targetState) {
    if (typeof GAS_URL === 'undefined' || !GAS_URL) {
        alert("GAS_URL が定義されていません。");
        return false;
    }

    const isPublishedBool = Boolean(targetState);

    try {
        const response = await fetch(GAS_URL, {
            method: "POST",
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                mode: "toggle_bingo_publish",
                isPublished: isPublishedBool,
                params: { isPublished: isPublishedBool }
            })
        });

        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

        const result = await response.json();

        if (result && result.status === "success" && result.data) {
            currentBingoState = result.data;
            localStorage.setItem('bingo_data_cache', JSON.stringify(result.data));

            updateAdminPublishStatusUI(result.data.isPublished);

            if (typeof showToast === "function") {
                showToast(result.data.isPublished ? "ビンゴを「公開」に切り替えました！" : "ビンゴを「非公開」に切り替えました！");
            }
            return true;
        } else {
            alert("ステータス更新に失敗しました: " + (result.message || "不明なエラー"));
            return false;
        }
    } catch (error) {
        console.error("公開ステータスの更新通信エラー:", error);
        alert(`サーバーとの通信に失敗しました:\n${error.message}`);
        return false;
    }
}

/**
 * 💡 管理者画面の公開ステータスラベルとボタンの表記を更新する
 */
function updateAdminPublishStatusUI(isPublished) {
    const labelEl = document.getElementById("admin-publish-label");
    const btnEl = document.getElementById("toggle-publish-btn");

    if (labelEl && btnEl) {
        if (isPublished) {
            labelEl.textContent = "公開中";
            labelEl.style.color = "#2e7d32";
            btnEl.textContent = "非公開にする";
            btnEl.style.background = "#d32f2f";
        } else {
            labelEl.textContent = "非公開（準備中）";
            labelEl.style.color = "#d32f2f";
            btnEl.textContent = "公開する";
            btnEl.style.background = "#2e7d32";
        }
    }
}

/**
 * 条件を引き継いで編集モードに切替
 */
function switchToEditMode(keepCurrent = true) {
    if (keepCurrent && currentBingoState && Array.isArray(currentBingoState.conditionPool)) {
        adminConditionPool = currentBingoState.conditionPool.map(item => ({
            ...item,
            count: item.total !== undefined ? item.total : (item.count || 0)
        }));
    } else if (!keepCurrent) {
        adminConditionPool = [];
    }

    renderAdminRulesForm(true);
}

/**
 * 条件をすべて一括削除して新規作成モードへ
 */
function clearAndCreateNewRules() {
    if (confirm("設定済みの条件を全てクリアしてゼロから作り直しますか？")) {
        adminConditionPool = [];
        renderAdminRulesForm(true);
    }
}

/**
 * 管理者用：FREEマス（中央マス）の情報・プレイヤー成果ログの送信
 */
function handleAdminFreeScoreUpdate() {
    const songTitle = document.getElementById("admin-free-song-title").value.trim();
    const targetScore = document.getElementById("admin-free-target-score").value;
    const playerName = document.getElementById("admin-free-player-name").value.trim();
    const playerScoreInput = document.getElementById("admin-free-player-score").value;

    if (!confirm("FREEマスの設定・スコアを更新しますか？")) return;

    // 現在のFREEマスのクリアリストを取得
    const centerCell = currentBingoState?.cells?.[12] || currentBingoState?.cells?.find(c => c.isCenter);
    let clearedList = centerCell?.clearedList ? [...centerCell.clearedList] : [];

    // プレイヤー名とスコアが入力されている場合はリストを更新（同名なら上書き）
    if (playerName && playerScoreInput !== "") {
        const scoreVal = Number(playerScoreInput);
        const existingIdx = clearedList.findIndex(item => (item.playerName === playerName || item.name === playerName));

        if (existingIdx !== -1) {
            clearedList[existingIdx].score = scoreVal;
            clearedList[existingIdx].playerName = playerName;
            clearedList[existingIdx].clearedAt = new Date().toISOString();
        } else {
            clearedList.push({
                playerName: playerName,
                score: scoreVal,
                clearedAt: new Date().toISOString(),
                isManual: true
            });
        }
    }

    // SYSTEMなどのシステムデータを除外した有効なプレイヤーのスコア合計値を計算
    const calculatedTotalScore = clearedList.reduce((sum, item) => sum + Number(item.score || 0), 0);

    const payload = {
        mode: "update_free_score",
        songTitle: songTitle || "",
        targetScore: targetScore !== "" ? Number(targetScore) : null,
        currentScore: calculatedTotalScore,
        clearedList: clearedList, // ★重要: clearedList 配列をそのままGASに送信する
        addScore: null
    };

    fetch(GAS_URL, {
        method: "POST",
        body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(response => {
        if (response.status === "success") {
            alert("FREEマスの情報を更新しました");
            fetchBingoData(); // 最新データ取得・画面再描画
            
            // プレイヤー名・スコア入力欄のみクリア
            document.getElementById("admin-free-player-name").value = "";
            document.getElementById("admin-free-player-score").value = "";
        } else {
            alert("エラー: " + response.message);
        }
    })
    .catch(err => {
        console.error(err);
        alert("通信エラーが発生しました");
    });
}

/**
 * フォーム入力から手動アサイン（曲の追加・割り当て）を実行
 */
async function handleManualAdminAssign() {
    const idxEl = document.getElementById("admin-cell-index");
    const idx = parseInt(idxEl?.value, 10);

    if (isNaN(idx) || idx < 0 || idx >= 25) {
        alert("有効なマス番号（No.1〜No.25）を選択してください。");
        return;
    }

    const targetCell = (currentBingoState && currentBingoState.cells) ? currentBingoState.cells[idx] : null;

    // 対象がFREEマスの場合は専用編集ダイアログへ誘導
    if (targetCell && (targetCell.isFree || idx === 12)) {
        if (confirm(`No.${idx + 1} はFREE（協力マス）です。FREEマスの内容編集を行いますか？`)) {
            await handleAdminEditFreeCell(idx);
        }
        return;
    }

    const maxRatingVal = document.getElementById("admin-cell-max-rating")?.value.trim() || "";
    const maxBestAvg = (maxRatingVal !== "" && !isNaN(parseFloat(maxRatingVal))) ? parseFloat(maxRatingVal) : null;

    const title1 = document.getElementById("admin-song-title")?.value.trim() || "";
    const diff1 = document.getElementById("admin-song-diff")?.value || "";
    const const1 = parseFloat(document.getElementById("admin-song-const")?.value);

    const title2 = document.getElementById("admin-song2-title")?.value.trim() || "";
    const diff2 = document.getElementById("admin-song2-diff")?.value || "";
    const const2Val = document.getElementById("admin-song2-const")?.value || "";
    const const2 = const2Val !== "" ? parseFloat(const2Val) : NaN;

    const cond1Input = document.getElementById("admin-condition1")?.value.trim() || "";
    const cond2Input = document.getElementById("admin-condition2")?.value.trim() || "";

    if (!title1 || isNaN(const1)) {
        alert("【1曲目】の曲名と定数を正しく入力してください。");
        return;
    }

    const song1 = { title: title1, diff: diff1, const: const1 };
    let song2 = null;

    if (title2) {
        if (isNaN(const2)) {
            alert("【2曲目】の定数を入力するか、2曲目を空欄にしてください。");
            return;
        }
        song2 = { title: title2, diff: diff2, const: const2 };
    }

    const finalCond1 = cond1Input || targetCell?.condition1 || targetCell?.condition || "手動設定";
    const finalCond2 = cond2Input || (cond1Input ? cond1Input : (targetCell?.condition2 || targetCell?.condition || finalCond1));

    const conditionData = {
        minConst1: targetCell?.minConst1 ?? const1,
        maxConst1: targetCell?.maxConst1 ?? const1,
        minConst2: targetCell?.minConst2 ?? (song2 ? const2 : const1),
        maxConst2: targetCell?.maxConst2 ?? (song2 ? const2 : const1),
        minConst: targetCell?.minConst1 ?? targetCell?.minConst ?? const1,
        maxConst: targetCell?.maxConst1 ?? targetCell?.maxConst ?? const1,
        condition: finalCond1,
        condition1: finalCond1,
        condition2: finalCond2,
        maxBestAvg: maxBestAvg
    };

    let confirmMsg = `No.${idx + 1} マスに以下を手動アサインしますか？\n\n`;
    confirmMsg += `・1曲目: ${title1} [${diff1}] (${const1}) / 条件: ${finalCond1}\n`;
    if (song2) {
        confirmMsg += `・2曲目: ${title2} [${diff2}] (${const2}) / 条件: ${finalCond2}\n`;
    }
    confirmMsg += `・ベスト枠上限: ${maxBestAvg !== null ? maxBestAvg : "なし"}`;

    if (!confirm(confirmMsg)) return;

    await openBingoCell(
        idx,
        song1,
        song2,
        currentBingoState ? currentBingoState.conditionPool : null,
        conditionData
    );

    if (document.getElementById("admin-song-title")) document.getElementById("admin-song-title").value = "";
    if (document.getElementById("admin-song-const")) document.getElementById("admin-song-const").value = "";
    if (document.getElementById("admin-song2-title")) document.getElementById("admin-song2-title").value = "";
    if (document.getElementById("admin-song2-const")) document.getElementById("admin-song2-const").value = "";
    if (document.getElementById("admin-condition1")) document.getElementById("admin-condition1").value = "";
    if (document.getElementById("admin-condition2")) document.getElementById("admin-condition2").value = "";
    if (document.getElementById("admin-cell-max-rating")) document.getElementById("admin-cell-max-rating").value = "";
}

/**
 * 条件コード・文字列から目標スコア（数値）を算出するヘルパー
 */
function parseRequiredScoreFromCondition(conditionCode) {
    if (!conditionCode) return 0;
    const code = String(conditionCode).trim().toUpperCase();

    const scoreMap = {
        "THEORY": 1010000,
        "理論値": 1010000,
        "AJ_995": 1009500,
        "995AJ": 1009500,
        "AJ_99": 1009900,
        "99AJ": 1009900,
        "AJ": 0,
        "SSS_PLUS": 1009000,
        "SSS+": 1009000,
        "8500": 1008500,
        "SSS_8500": 1008500,
        "8000": 1008000,
        "SSS_8000": 1008000,
        "SSS": 1007500,
        "7000": 1007000,
        "SSS_7000": 1007000,
        "SS_PLUS": 1005000,
        "SS+": 1005000,
        "SS": 1000000
    };

    if (scoreMap[code] !== undefined) {
        return scoreMap[code];
    }

    const match = code.match(/(\d{6,7})/);
    if (match) return parseInt(match[1], 10);

    return 0;
}

/**
 * 対象マス・選択楽曲・プレイヤーの入力に応じて、ボタンの活性/非活性をリアルタイム更新する
 */
function updateAdminClearFormState() {
    const idxEl = document.getElementById("admin-clear-cell-index");
    const songSelectEl = document.getElementById("admin-clear-song-select");
    const playerEl = document.getElementById("admin-clear-player-name") || document.getElementById("admin-player-select");
    const scoreEl = document.getElementById("admin-clear-score");
    const lampEl = document.getElementById("admin-clear-lamp");

    const btnAdd = document.querySelector("button[onclick*=\"'add'\"]");
    const btnRemove = document.querySelector("button[onclick*=\"'remove'\"]");

    if (!idxEl || !songSelectEl) return;

    const idx = parseInt(idxEl.value, 10);
    const cell = (currentBingoState && currentBingoState.cells) ? currentBingoState.cells[idx] : null;

    const previousSelectedVal = songSelectEl.value;

    // --- A. 未確定マスの処理 ---
    if (!cell || (!cell.isOpened && !cell.isFree)) {
        songSelectEl.innerHTML = `<option value="">【未確定マス】</option>`;
        if (scoreEl) scoreEl.disabled = false;
        if (lampEl) lampEl.disabled = false;
        if (btnAdd) btnAdd.disabled = true;
        if (btnRemove) btnRemove.disabled = true;
        return;
    }

    // --- B. FREEマスの処理 ---
    if (cell.isFree || idx === 12) {
        songSelectEl.innerHTML = `<option value="free">FREEマス（協力達成）</option>`;
        if (scoreEl) { scoreEl.value = ""; scoreEl.disabled = true; }
        if (lampEl) { lampEl.disabled = true; }
    } else {
        if (scoreEl) scoreEl.disabled = false;
        if (lampEl) lampEl.disabled = false;

        // --- C. 楽曲リストの生成 ---
        const s1 = cell.song || { title: cell.songTitle, diff: cell.diff };
        const s2 = cell.song2;

        let optionsHtml = "";
        if (s1 && s1.title) {
            const diff1 = s1.diff ? ` [${s1.diff}]` : "";
            optionsHtml += `<option value="1">${s1.title}${diff1}</option>`;
        }
        if (s2 && s2.title) {
            const diff2 = s2.diff ? ` [${s2.diff}]` : "";
            optionsHtml += `<option value="2">${s2.title}${diff2}</option>`;
        }

        if (!optionsHtml) {
            optionsHtml = `<option value="">楽曲情報なし</option>`;
        }

        if (songSelectEl.innerHTML !== optionsHtml) {
            songSelectEl.innerHTML = optionsHtml;
            if (previousSelectedVal && songSelectEl.querySelector(`option[value="${previousSelectedVal}"]`)) {
                songSelectEl.value = previousSelectedVal;
            }
        }
    }

    // --- D. 選択中のコンテンツに対する達成判定 ---
    const playerName = playerEl ? playerEl.value.trim() : "";
    const selectedVal = songSelectEl.value;

    const s1 = cell.song || { title: cell.songTitle, diff: cell.diff };
    const s2 = cell.song2;
    const targetSong = (selectedVal === "2" && s2 && s2.title) ? s2 : s1;

    const clearedList = cell.clearedList || [];

    const isSongCleared = clearedList.some(item => {
        const nameMatch = (item.playerName || item.name || "").toLowerCase() === playerName.toLowerCase();
        if (!nameMatch) return false;

        if (cell.isFree || idx === 12) return true;

        if (item.songIndex !== undefined && item.songIndex !== null) {
            return String(item.songIndex) === String(selectedVal);
        }

        if (targetSong && targetSong.title) {
            const itemTitle = (item.songTitle || item.title || item.song?.title || "").trim();
            const targetTitle = (targetSong.title || "").trim();
            return itemTitle === targetTitle;
        }

        return true;
    });

    // --- E. ボタンの有効/無効切り替え ---
    if (btnAdd && btnRemove) {
        if (!playerName) {
            btnAdd.disabled = false;
            btnRemove.disabled = false;
        } else if (isSongCleared) {
            btnAdd.disabled = true;
            btnRemove.disabled = false;
        } else {
            btnAdd.disabled = false;
            btnRemove.disabled = true;
        }
    }
}

/**
 * フォーム入力から手動クリア状態の追加/取り消しを実行
 */
async function handleManualClearAction(action = 'add') {
    const idxEl = document.getElementById("admin-clear-cell-index");
    const idx = parseInt(idxEl?.value, 10);

    if (isNaN(idx) || idx < 0 || idx >= 25) {
        alert("有効なマス番号（No.1〜No.25）を選択してください。");
        return;
    }

    const playerEl = document.getElementById("admin-clear-player-name") || document.getElementById("admin-player-select");
    const playerName = playerEl?.value.trim() || "";

    if (!playerName) {
        alert("対象のプレイヤー名を入力してください。");
        return;
    }

    const targetCell = (currentBingoState && currentBingoState.cells) ? currentBingoState.cells[idx] : null;
    if (!targetCell) {
        alert(`No.${idx + 1} マスの情報が見つかりません。`);
        return;
    }

    const songSelectEl = document.getElementById("admin-clear-song-select");
    const selectedVal = songSelectEl?.value;

    const s1 = targetCell.song || { title: targetCell.songTitle, diff: targetCell.diff };
    const s2 = targetCell.song2;
    const targetSong = (selectedVal === "2" && s2 && s2.title) ? s2 : s1;

    const scoreInput = document.getElementById("admin-clear-score");

    // --- 取り消し処理 (remove) ---
    if (action === 'remove') {
        let removeMsg = `No.${idx + 1} マスから プレイヤー [${playerName}] の記録を取り消しますか？\n`;
        if (targetSong && targetSong.title && !targetCell.isFree) {
            removeMsg += `・対象楽曲: ${targetSong.title} [${targetSong.diff || ''}]\n`;
        }

        if (!confirm(removeMsg)) return;

        if (typeof toggleBingoCellClearStatus === "function") {
            await toggleBingoCellClearStatus(idx, playerName, {
                action: 'remove',
                songIndex: selectedVal,
                songTitle: targetSong ? targetSong.title : "",
                diff: targetSong ? targetSong.diff : ""
            });
        }
        if (scoreInput) scoreInput.value = "";
        updateAdminClearFormState();
        return;
    }

    // --- 達成登録処理 (add) ---
    const scoreVal = scoreInput ? scoreInput.value.trim() : "";
    let score = null;
    if (scoreVal !== "" && !targetCell.isFree) {
        const parsed = parseInt(scoreVal, 10);
        if (!isNaN(parsed)) score = parsed;
    }

    const lampEl = document.getElementById("admin-clear-lamp");
    const selectedLamp = (targetCell.isFree || idx === 12) ? "FREE" : (lampEl ? lampEl.value.trim() : "AJ");

    let confirmMsg = `No.${idx + 1} マスの達成登録を行いますか？\n\n`;
    confirmMsg += `・対象プレイヤー: ${playerName}\n`;
    if (targetCell.isFree || idx === 12) {
        confirmMsg += `・種別: FREEマス達成登録\n`;
    } else {
        if (targetSong && targetSong.title) {
            confirmMsg += `・対象楽曲: ${targetSong.title} [${targetSong.diff || ''}]\n`;
        }
        confirmMsg += `・記録スコア: ${score !== null ? score.toLocaleString() + '点' : 'なし（条件クリア扱い）'}\n`;
        confirmMsg += `・達成ランプ: ${selectedLamp}\n`;
    }

    if (!confirm(confirmMsg)) return;

    if (typeof toggleBingoCellClearStatus === "function") {
        await toggleBingoCellClearStatus(idx, playerName, {
            action: 'add',
            score: score,
            lamp: selectedLamp,
            songIndex: selectedVal,
            songTitle: targetSong ? targetSong.title : "",
            diff: targetSong ? targetSong.diff : ""
        });
    }

    if (scoreInput) scoreInput.value = "";
    updateAdminClearFormState();
}

/**
 * 指定したマスのクリア状態（登録 / 取り消し）を更新する API 関数
 */
async function toggleBingoCellClearStatus(cellIndex, playerName, options = {}) {
    if (!playerName) {
        alert("対象のプレイヤーを選択してください。");
        return;
    }

    const action = options.action || 'add';
    const inputScore = options.score !== undefined ? options.score : null;
    const inputLamp = options.lamp || "MANUAL";

    // --- 1. 条件検証（スコア＆ランプ） ---
    if (action === 'add' && currentBingoState && currentBingoState.cells && currentBingoState.cells[cellIndex]) {
        const cell = currentBingoState.cells[cellIndex];

        // FREEマスでない場合のみスコア・ランプ判定を実施
        if (!cell.isFree && cellIndex !== 12) {
            const selectedSongIdx = String(options.songIndex || "1");

            // 2曲目の条件が未設定（空文字など）の場合は 1曲目の条件に安全にフォールバック
            const rawCondition = (selectedSongIdx === "2" && cell.condition2)
                ? cell.condition2
                : (cell.condition1 || cell.condition || "");

            const condCode = String(rawCondition).trim().toUpperCase();

            const isAJRequired = condCode.includes("AJ");
            const reqScore = parseRequiredScoreFromCondition(rawCondition);

            // A. ランプチェック
            if (isAJRequired) {
                const isAJLamp = inputLamp.toUpperCase().includes("AJ") || inputLamp.toUpperCase().includes("ALL JUSTICE");
                if (!isAJLamp) {
                    const condLabel = typeof formatCondition === "function" ? formatCondition(rawCondition) : rawCondition;
                    alert(`【条件未達エラー】\nこのマスの達成条件 [${condLabel}] には 「ALL JUSTICE (AJ)」 ランプが必要です。`);
                    return;
                }
            }

            // B. スコアチェック
            if (reqScore > 0) {
                if (inputScore === null || isNaN(inputScore)) {
                    alert(`【条件エラー】このマスの達成にはスコアの入力が必要です。（必要スコア: ${reqScore.toLocaleString()}点 以上）`);
                    return;
                }
                if (inputScore < reqScore) {
                    const condLabel = typeof formatCondition === "function" ? formatCondition(rawCondition) : rawCondition;
                    alert(`【条件未達エラー】\n条件 [${condLabel}] (${reqScore.toLocaleString()}点以上) に対し、入力スコア (${inputScore.toLocaleString()}点) が不足しています。`);
                    return;
                }
            }
        }
    }

    // --- 2. GASへ送信 ---
    try {
        const response = await fetch(GAS_URL, {
            method: "POST",
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                mode: "clear_bingo_cell",
                cellIndex: cellIndex,
                playerName: playerName,
                action: action,
                songIndex: String(options.songIndex || "1"),
                songTitle: options.songTitle || "",
                diff: options.diff || "",
                score: inputScore,
                lamp: inputLamp
            })
        });

        const result = await response.json();

        if (result.status === "success") {
            currentBingoState = result.data;

            if (typeof renderAdminBingoBoard === "function") renderAdminBingoBoard(currentBingoState);
            if (typeof renderBingoCard === "function") renderBingoCard(currentBingoState);
            if (typeof updateAdminClearFormState === "function") updateAdminClearFormState();
        } else {
            alert("更新エラー: " + result.message);
        }
    } catch (e) {
        console.error("手動クリア通信エラー:", e);
        alert("通信エラーが発生しました。");
    }
}





/**
 * 💡【新設】プレイヤー名指定でのデータ取得（ブックマークレット遷移時用）
 */
async function loadPlayerDataByName(playerName) {
    if (!playerName) return false;

    try {
        const response = await fetch(GAS_URL, {
            method: "POST",
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                mode: "get_player_data",
                playerName: playerName
            })
        });

        const result = await response.json();

        if (result.status === "success" && result.records) {
            // トークンは既存のものを維持して成功処理へ
            const currentToken = localStorage.getItem('chunirec_token') || "";
            handleSuccess(result, currentToken);
            return true;
        } else {
            throw new Error(result.message || "プレイヤーデータの取得に失敗しました。");
        }
    } catch (e) {
        console.error(e);
        alert("データ読み込みエラー: " + e.message);
        return false;
    }
}

/**
 * 💡 データを再同期する（ボタン用）
 * スコア同期 ＋ 最新ビンゴデータの再取得を一括で行う
 */
async function refreshScores() {
    const btn = document.querySelector('.refresh-btn');
    if (!btn || btn.disabled) return;

    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "同期中...";

    await new Promise(resolve => setTimeout(resolve, 50));

    // 1. スコアの同期・読み込み
    const isSuccess = await loadScores();

    // 2. ビンゴデータの最新取得（※関数が存在する場合に実行）
    if (isSuccess && typeof fetchBingoData === 'function') {
        try {
            await fetchBingoData();
        } catch (bErr) {
            console.error("ビンゴデータの再取得に失敗:", bErr);
        }
    }

    btn.disabled = false;
    btn.innerText = originalText;
    btn.blur();

    if (isSuccess) {
        alert("データおよびビンゴ状態の再同期が正常に完了しました！");
    } else {
        const errorMsgEl = document.getElementById("token-error");
        const errMsg = errorMsgEl ? errorMsgEl.innerText : "認証・同期エラー";
        alert("同期に失敗しました。\n" + errMsg);
    }
}

/**
 * 💡 スコア読み込み（トークンによる全同期）
 */
async function loadScores() {
    const tokenInput = document.getElementById("token-input");
    const loadBtn = document.getElementById("load-btn");
    const loadingMsg = document.getElementById("loading-msg");
    const errorMsg = document.getElementById("token-error");

    const token = tokenInput ? tokenInput.value.trim() : "";

    if (!token) {
        if (errorMsg) {
            errorMsg.innerText = "エラー: トークンを入力してください。";
            errorMsg.style.display = "block";
        }
        return false;
    }

    if (loadBtn) {
        loadBtn.disabled = true;
        loadBtn.innerText = "同期中...";
    }
    if (loadingMsg) loadingMsg.style.display = "block";
    if (errorMsg) errorMsg.style.display = "none";

    try {
        const response = await fetch(GAS_URL, {
            method: "POST",
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                mode: "checker",
                token: token
            })
        });

        const result = await response.json();

        if (result.status === "success") {
            handleSuccess(result, token);
            return true;
        } else {
            clearUserCache();
            throw new Error(result.message || "認証に失敗しました。");
        }
    } catch (e) {
        console.error(e);
        if (errorMsg) {
            errorMsg.innerText = "エラー: " + e.message;
            errorMsg.style.display = "block";
        }
        return false;
    } finally {
        if (loadBtn) {
            loadBtn.disabled = false;
            loadBtn.innerText = "スコアを表示";
        }
        if (loadingMsg) loadingMsg.style.display = "none";
    }

}

/**
 * 💡 同期・データ取得成功時の共通処理
 */
function handleSuccess(result, token) {
    console.log("データ取得成功", result);

    myCurrentRecords = result.records || [];

    // ローカルストレージへの保存
    if (token) localStorage.setItem('chunirec_token', token);
    localStorage.setItem('chunirec_scores', JSON.stringify(myCurrentRecords));
    localStorage.setItem('chunirec_player_name', result.playerName);
    localStorage.setItem('chunirec_cache_time', Date.now().toString());

    // 画面切り替え
    const tokenScreen = document.getElementById("token-screen");
    const mainScreen = document.getElementById("main-screen");
    if (tokenScreen) tokenScreen.style.display = "none";
    if (mainScreen) mainScreen.style.display = "block";

    // プレイヤー選択セレクトボックスの表示合わせ（存在する場合）
    const playerSelect = document.getElementById("playerSelect");
    if (playerSelect) {
        playerSelect.value = result.playerName;
    }

    if (typeof calculatechuniRate === 'function') calculatechuniRate(result.playerName);

    // 💡 修正: 直接描画するのではなく、保存されたフィルター・ソートを適用して再描画
    if (typeof updateFilters === 'function') {
        updateFilters();
    } else if (typeof displayScores === 'function') {
        displayScores(myCurrentRecords);
    }
}


/**
 * フィルター（検索窓 + セレクトボックス + トレンド + 難易度）の値を読み取って表示を更新する
 */
function updateFilters() {
    const searchInput = document.getElementById('search-input');
    const minConstSelect = document.getElementById('min-constant');
    const maxConstSelect = document.getElementById('max-constant');
    const minRateInput = document.getElementById('min-rating');
    const maxRateInput = document.getElementById('max-rating');
    const lampSelect = document.getElementById('lamp-filter');

    const filterModeSelect = document.getElementById('filter-mode');
    const rankMinSelect = document.getElementById('rank-min');
    const rankMaxSelect = document.getElementById('rank-max');
    const minScoreInput = document.getElementById('min-score');
    const maxScoreInput = document.getElementById('max-score');

    if (!searchInput || !minConstSelect || !maxConstSelect || !rankMinSelect || !rankMaxSelect || !lampSelect) return;

    // 💡 フィルター更新のたびにLocalStorageへ設定を保存
    saveFilterSettings();

    const searchText = searchInput.value.toLowerCase().trim();
    const minConst = parseFloat(minConstSelect.value);
    const maxConst = parseFloat(maxConstSelect.value);

    const filterMode = filterModeSelect ? filterModeSelect.value : 'rank';
    const rankMin = parseFloat(rankMinSelect.value);
    const rankMax = parseFloat(rankMaxSelect.value);

    const minScoreVal = minScoreInput ? minScoreInput.value : "";
    const maxScoreVal = maxScoreInput ? maxScoreInput.value : "";
    const minScore = minScoreVal !== "" ? parseFloat(minScoreVal) : 0;
    const maxScore = maxScoreVal !== "" ? parseFloat(maxScoreVal) : 1010000;

    const minRateVal = minRateInput ? minRateInput.value : "";
    const maxRateVal = maxRateInput ? maxRateInput.value : "";

    const minRate = minRateVal !== "" ? parseFloat(minRateVal) : 0;
    const maxRate = maxRateVal !== "" ? parseFloat(maxRateVal) : 99.99;

    const lampValue = lampSelect.value;

    const trendSwitch = document.getElementById('trend-enable-switch');
    const isTrendEnabled = trendSwitch ? trendSwitch.checked : false;
    const activeTrends = Array.from(document.querySelectorAll('.btn-trend-filter.active')).map(btn => btn.getAttribute('data-trend'));
    const activeDiffs = Array.from(document.querySelectorAll('.btn-diff-filter.active')).map(btn => btn.getAttribute('data-diff'));

    const sourceRecords = (typeof myCurrentRecords !== 'undefined' && Array.isArray(myCurrentRecords)) ? myCurrentRecords : [];

    const filteredData = sourceRecords.filter(item => {
        const title = String(item.title || "").toLowerCase();
        const matchesTitle = title.includes(searchText);

        const currentRate = parseFloat(item.rating) || 0;
        const matchesRating = (currentRate >= minRate && currentRate <= maxRate);

        const itemDiff = String(item.diff || "").toUpperCase();
        const matchesDiff = activeDiffs.includes(itemDiff);

        const constant = parseFloat(item.const) || 0;
        const isWeExempt = (itemDiff === "WE" && activeDiffs.includes("WE"));
        const matchesConstant = isWeExempt || (constant >= minConst && constant <= maxConst);

        const tScore = parseFloat(item.score) || 0;
        let matchesRankOrScore = true;

        if (filterMode === 'rank') {
            const upperLimit = typeof getUpperLimit === 'function' ? getUpperLimit(rankMax) : 1010000;
            matchesRankOrScore = (tScore >= rankMin && tScore <= upperLimit);
        } else {
            matchesRankOrScore = (tScore >= minScore && tScore <= maxScore);
        }

        const itemLamp = item.lamp || "None";
        let matchesLamp = true;

        if (lampValue !== 'all') {
            if (lampValue === 'ajc') {
                matchesLamp = itemLamp.includes('AJC') || itemLamp.includes('JUSTICE CRITICAL');
            } else if (lampValue === 'aj') {
                matchesLamp = itemLamp.includes('AJ') || itemLamp.includes('JUSTICE');
            } else if (lampValue === 'None') {
                const hasAJ = itemLamp.includes('AJ') || itemLamp.includes('JUSTICE');
                matchesLamp = !hasAJ;
            }
        }

        let matchesType = true;
        const isNew = typeof isNewSongCheck === 'function' ? isNewSongCheck(item.isNew) : Boolean(item.isNew);
        if (currentTypeFilter === 'old') matchesType = !isNew;
        if (currentTypeFilter === 'new') matchesType = isNew;

        const matchesTrend = true;

        return matchesTitle && matchesRating && matchesDiff && matchesConstant && matchesRankOrScore && matchesLamp && matchesType && matchesTrend;
    });

    if (typeof sortData === 'function') {
        sortData(filteredData);
    }
    if (typeof displayScores === 'function') {
        displayScores(filteredData);
    }

    if (typeof updateSortButtonLabels === 'function') {
        updateSortButtonLabels();
    }

    // 適用条件バッジ表示更新
    const activeContainer = document.getElementById('active-filters-container');
    const activeList = document.getElementById('active-filters-list');

    if (activeContainer && activeList) {
        activeList.innerHTML = '';
        let hasActiveFilter = false;

        const addBadge = (text) => {
            const badge = document.createElement('span');
            badge.className = 'filter-badge';
            badge.textContent = text;
            activeList.appendChild(badge);
            hasActiveFilter = true;
        };

        const isDefaultDiff = activeDiffs.length === 3 && activeDiffs.includes("EXP") && activeDiffs.includes("MAS") && activeDiffs.includes("ULT") && !activeDiffs.includes("WE");
        if (!isDefaultDiff) {
            if (activeDiffs.length === 0) {
                addBadge("難易度: 表示なし");
            } else if (activeDiffs.length === 4) {
                addBadge("難易度: すべて");
            } else {
                addBadge(`難易度: ${activeDiffs.join(', ')}`);
            }
        }

        if (minRateVal !== "" || maxRateVal !== "") {
            addBadge(`単レ: ${minRateVal || '0'}〜${maxRateVal || '99.99'}`);
        }

        if (lampValue !== 'all') {
            const lampText = lampSelect.options[lampSelect.selectedIndex]?.text || lampValue;
            addBadge(`ランプ: ${lampText}`);
        }

        if (filterMode === 'rank') {
            if (rankMinSelect.value !== '0' || rankMaxSelect.value !== '1010000') {
                const minText = rankMinSelect.options[rankMinSelect.selectedIndex]?.text || rankMin;
                const maxText = rankMaxSelect.options[rankMaxSelect.selectedIndex]?.text || rankMax;
                addBadge(`Rank: ${minText}〜${maxText}`);
            }
        } else {
            if (minScoreVal !== "" || maxScoreVal !== "") {
                const displayMin = minScoreVal !== "" ? Number(minScoreVal).toLocaleString() : '0';
                const displayMax = maxScoreVal !== "" ? Number(maxScoreVal).toLocaleString() : '1,010,000';
                addBadge(`スコア: ${displayMin}〜${displayMax}`);
            }
        }

        if ((minConstSelect.value !== '13.5' || maxConstSelect.value !== '16.0') && !activeDiffs.every(d => d === "WE")) {
            addBadge(`定数: ${minConstSelect.value}〜${maxConstSelect.value}`);
        }

        if (typeof currentTypeFilter !== 'undefined' && currentTypeFilter !== 'all') {
            const targetBtn = document.getElementById(`filter-${currentTypeFilter}`);
            const targetText = targetBtn ? targetBtn.textContent.trim() : currentTypeFilter;
            addBadge(`対象: ${targetText}`);
        }

        if (isTrendEnabled && activeTrends.length > 0) {
            addBadge(`表示切替: ${activeTrends[0]}`);
        }

        activeContainer.style.display = hasActiveFilter ? 'flex' : 'none';
    }
}

/**
 * フィルター初期化（イベントリスナー登録 ＆ 復元処理）
 */
function initFilters() {
    const minConstSelect = document.getElementById('min-constant');
    const maxConstSelect = document.getElementById('max-constant');
    const minRateInput = document.getElementById('min-rating');
    const maxRateInput = document.getElementById('max-rating');
    const searchInput = document.getElementById('search-input');
    const lampSelect = document.getElementById('lamp-filter');
    const filterModeSelect = document.getElementById('filter-mode');
    const rankMinSelect = document.getElementById('rank-min');
    const rankMaxSelect = document.getElementById('rank-max');
    const minScoreInput = document.getElementById('min-score');
    const maxScoreInput = document.getElementById('max-score');
    const trendSwitch = document.getElementById('trend-enable-switch');

    if (!minConstSelect || !maxConstSelect) return;

    // 定数セレクトボックスの生成
    minConstSelect.innerHTML = "";
    maxConstSelect.innerHTML = "";
    for (let i = 135; i <= 160; i++) {
        const val = (i / 10).toFixed(1);
        minConstSelect.insertAdjacentHTML('beforeend', `<option value="${val}">${val}</option>`);
    }
    for (let i = 160; i >= 135; i--) {
        const val = (i / 10).toFixed(1);
        maxConstSelect.insertAdjacentHTML('beforeend', `<option value="${val}">${val}</option>`);
    }

    minConstSelect.value = "13.5";
    maxConstSelect.value = "16.0";

    // イベントリスナーの登録
    [minConstSelect, maxConstSelect, lampSelect, rankMinSelect, rankMaxSelect].forEach(el => {
        if (el) el.addEventListener('change', updateFilters);
    });
    [searchInput, minRateInput, maxRateInput, minScoreInput, maxScoreInput].forEach(el => {
        if (el) el.addEventListener('input', updateFilters);
    });

    if (filterModeSelect) {
        filterModeSelect.addEventListener('change', (e) => {
            const currentMode = e.target.value;
            const rankContainer = document.getElementById('rank-filter-container');
            const scoreContainer = document.getElementById('score-filter-container');

            if (currentMode === 'rank') {
                filterModeSelect.classList.add('mode-rank');
                filterModeSelect.classList.remove('mode-score');
                if (rankContainer) rankContainer.style.display = 'flex';
                if (scoreContainer) scoreContainer.style.display = 'none';
            } else {
                filterModeSelect.classList.add('mode-score');
                filterModeSelect.classList.remove('mode-rank');
                if (rankContainer) rankContainer.style.display = 'none';
                if (scoreContainer) scoreContainer.style.display = 'flex';
            }
            updateFilters();
        });
    }

    // 表示対象ボタン
    document.querySelectorAll('.btn-filter').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            if (e.target.id === 'filter-all') currentTypeFilter = 'all';
            else if (e.target.id === 'filter-old') currentTypeFilter = 'old';
            else if (e.target.id === 'filter-new') currentTypeFilter = 'new';
            updateFilters();
        });
    });

    // 難易度ボタンの相互排他イベント
    document.querySelectorAll('.btn-diff-filter').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const clickedBtn = e.target;
            const clickedDiff = clickedBtn.getAttribute('data-diff');

            clickedBtn.classList.toggle('active');

            if (clickedBtn.classList.contains('active')) {
                if (clickedDiff === "WE") {
                    document.querySelectorAll('.btn-diff-filter:not([data-diff="WE"])').forEach(b => {
                        b.classList.remove('active');
                    });
                } else {
                    document.querySelectorAll('.btn-diff-filter[data-diff="WE"]').forEach(b => {
                        b.classList.remove('active');
                    });
                }
            }
            updateFilters();
        });
    });

    // トレンド初期設定
    if (trendSwitch) {
        trendSwitch.checked = false;
    }
    document.querySelectorAll('.btn-trend-filter').forEach(btn => {
        btn.classList.remove('active');
        btn.classList.add('trend-disabled');
    });

    if (trendSwitch) {
        trendSwitch.addEventListener('change', (e) => {
            const isEnabled = e.target.checked;
            document.querySelectorAll('.btn-trend-filter').forEach(btn => {
                btn.classList.remove('active');
                if (isEnabled) {
                    btn.classList.remove('trend-disabled');
                } else {
                    btn.classList.add('trend-disabled');
                }
            });
            updateFilters();
        });
    }

    // 傾向フィルタークリックイベント
    document.querySelectorAll('.btn-trend-filter').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (trendSwitch && !trendSwitch.checked) return;

            const targetBtn = e.target;
            const isAlreadyActive = targetBtn.classList.contains('active');

            document.querySelectorAll('.btn-trend-filter').forEach(b => b.classList.remove('active'));

            if (!isAlreadyActive) {
                targetBtn.classList.add('active');
            }
            updateFilters();
        });
    });

    // リセットボタン（LocalStorage の保存データも消去）
    const clearBtn = document.getElementById('clear-filter');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            localStorage.removeItem(FILTER_STORAGE_KEY); // 保存したフィルター条件をクリア

            if (searchInput) searchInput.value = "";
            if (minConstSelect) minConstSelect.value = "13.5";
            if (maxConstSelect) maxConstSelect.value = "16.0";
            if (minRateInput) minRateInput.value = "";
            if (maxRateInput) maxRateInput.value = "";
            if (lampSelect) lampSelect.value = "all";

            if (rankMinSelect) rankMinSelect.value = "0";
            if (rankMaxSelect) rankMaxSelect.value = "1010000";
            if (minScoreInput) minScoreInput.value = "";
            if (maxScoreInput) maxScoreInput.value = "";

            if (filterModeSelect) {
                filterModeSelect.value = "rank";
                filterModeSelect.classList.add('mode-rank');
                filterModeSelect.classList.remove('mode-score');
            }
            const rankContainer = document.getElementById('rank-filter-container');
            const scoreContainer = document.getElementById('score-filter-container');
            if (rankContainer) rankContainer.style.display = 'flex';
            if (scoreContainer) scoreContainer.style.display = 'none';

            document.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'));
            document.getElementById('filter-all')?.classList.add('active');
            currentTypeFilter = 'all';

            if (trendSwitch) trendSwitch.checked = false;
            document.querySelectorAll('.btn-trend-filter').forEach(b => {
                b.classList.remove('active');
                b.classList.add('trend-disabled');
            });

            document.querySelectorAll('.btn-diff-filter').forEach(b => {
                const diff = b.getAttribute('data-diff');
                if (diff === 'WE') {
                    b.classList.remove('active');
                } else {
                    b.classList.add('active');
                }
            });

            currentSortKey = 'rating';
            document.getElementById('sort-Rating')?.classList.add('active');
            document.getElementById('sort-score')?.classList.remove('active');

            if (typeof updateSortButtonLabels === 'function') {
                updateSortButtonLabels();
            }
            updateFilters();
        });
    }

    // ソート切り替えボタン
    const sortRatingBtn = document.getElementById('sort-Rating');
    const sortScoreBtn = document.getElementById('sort-score');
    if (sortRatingBtn) {
        sortRatingBtn.addEventListener('click', () => {
            currentSortKey = 'rating';
            if (typeof updateSortButtonLabels === 'function') updateSortButtonLabels();
            updateFilters();
        });
    }
    if (sortScoreBtn) {
        sortScoreBtn.addEventListener('click', () => {
            currentSortKey = 'techScore';
            if (typeof updateSortButtonLabels === 'function') updateSortButtonLabels();
            updateFilters();
        });
    }

    // 💡 保存されていた設定情報を呼び出して復元
    loadFilterSettings();
}

// LocalStorage のキー名
const FILTER_STORAGE_KEY = 'chunirec_filter_settings';

/**
 * 💡 フィルター設定を LocalStorage に保存する関数
 */
function saveFilterSettings() {
    const settings = {
        searchText: document.getElementById('search-input')?.value || '',
        minConst: document.getElementById('min-constant')?.value || '13.5',
        maxConst: document.getElementById('max-constant')?.value || '16.0',
        minRate: document.getElementById('min-rating')?.value || '',
        maxRate: document.getElementById('max-rating')?.value || '',
        lamp: document.getElementById('lamp-filter')?.value || 'all',
        filterMode: document.getElementById('filter-mode')?.value || 'rank',
        rankMin: document.getElementById('rank-min')?.value || '0',
        rankMax: document.getElementById('rank-max')?.value || '1010000',
        minScore: document.getElementById('min-score')?.value || '',
        maxScore: document.getElementById('max-score')?.value || '',
        currentTypeFilter: typeof currentTypeFilter !== 'undefined' ? currentTypeFilter : 'all',
        currentSortKey: typeof currentSortKey !== 'undefined' ? currentSortKey : 'rating',
        activeDiffs: Array.from(document.querySelectorAll('.btn-diff-filter.active')).map(btn => btn.getAttribute('data-diff')),
        isTrendEnabled: document.getElementById('trend-enable-switch')?.checked || false,
        activeTrend: document.querySelector('.btn-trend-filter.active')?.getAttribute('data-trend') || null
    };

    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(settings));
}

/**
 * 💡 LocalStorage からフィルター設定を読み込んでUIに復元する関数
 */
function loadFilterSettings() {
    const saved = localStorage.getItem(FILTER_STORAGE_KEY);
    if (!saved) return;

    try {
        const settings = JSON.parse(saved);

        if (settings.searchText !== undefined) document.getElementById('search-input').value = settings.searchText;
        if (settings.minConst !== undefined) document.getElementById('min-constant').value = settings.minConst;
        if (settings.maxConst !== undefined) document.getElementById('max-constant').value = settings.maxConst;
        if (settings.minRate !== undefined) document.getElementById('min-rating').value = settings.minRate;
        if (settings.maxRate !== undefined) document.getElementById('max-rating').value = settings.maxRate;
        if (settings.lamp !== undefined) document.getElementById('lamp-filter').value = settings.lamp;

        if (settings.filterMode !== undefined) {
            const filterModeSelect = document.getElementById('filter-mode');
            if (filterModeSelect) {
                filterModeSelect.value = settings.filterMode;
                const rankContainer = document.getElementById('rank-filter-container');
                const scoreContainer = document.getElementById('score-filter-container');
                if (settings.filterMode === 'rank') {
                    filterModeSelect.classList.add('mode-rank');
                    filterModeSelect.classList.remove('mode-score');
                    if (rankContainer) rankContainer.style.display = 'flex';
                    if (scoreContainer) scoreContainer.style.display = 'none';
                } else {
                    filterModeSelect.classList.add('mode-score');
                    filterModeSelect.classList.remove('mode-rank');
                    if (rankContainer) rankContainer.style.display = 'none';
                    if (scoreContainer) scoreContainer.style.display = 'flex';
                }
            }
        }

        if (settings.rankMin !== undefined) document.getElementById('rank-min').value = settings.rankMin;
        if (settings.rankMax !== undefined) document.getElementById('rank-max').value = settings.rankMax;
        if (settings.minScore !== undefined) document.getElementById('min-score').value = settings.minScore;
        if (settings.maxScore !== undefined) document.getElementById('max-score').value = settings.maxScore;

        if (settings.currentTypeFilter !== undefined) {
            currentTypeFilter = settings.currentTypeFilter;
            document.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'));
            const activeTypeBtn = document.getElementById(`filter-${settings.currentTypeFilter}`);
            if (activeTypeBtn) activeTypeBtn.classList.add('active');
        }

        // 💡 修正: 保存されたソートキーを復元し、ボタンの表示状態も更新
        if (settings.currentSortKey !== undefined) {
            currentSortKey = settings.currentSortKey;
            const sortRatingBtn = document.getElementById('sort-Rating');
            const sortScoreBtn = document.getElementById('sort-score');
            if (sortRatingBtn && sortScoreBtn) {
                if (currentSortKey === 'rating') {
                    sortRatingBtn.classList.add('active');
                    sortScoreBtn.classList.remove('active');
                } else {
                    sortRatingBtn.classList.remove('active');
                    sortScoreBtn.classList.add('active');
                }
            }
            if (typeof updateSortButtonLabels === 'function') {
                updateSortButtonLabels();
            }
        }

        if (Array.isArray(settings.activeDiffs)) {
            document.querySelectorAll('.btn-diff-filter').forEach(b => {
                const diff = b.getAttribute('data-diff');
                if (settings.activeDiffs.includes(diff)) {
                    b.classList.add('active');
                } else {
                    b.classList.remove('active');
                }
            });
        }

        const trendSwitch = document.getElementById('trend-enable-switch');
        if (trendSwitch && settings.isTrendEnabled !== undefined) {
            trendSwitch.checked = settings.isTrendEnabled;
            document.querySelectorAll('.btn-trend-filter').forEach(btn => {
                btn.classList.remove('active');
                if (settings.isTrendEnabled) {
                    btn.classList.remove('trend-disabled');
                    if (settings.activeTrend && btn.getAttribute('data-trend') === settings.activeTrend) {
                        btn.classList.add('active');
                    }
                } else {
                    btn.classList.add('trend-disabled');
                }
            });
        }
    } catch (e) {
        console.error("フィルター設定の復元に失敗しました:", e);
    }
}

/**
 * 💡 ソートボタンのラベルおよび背景スタイルを動的に切り替える関数
 */
function updateSortButtonLabels() {
    const sortRatingBtn = document.getElementById('sort-Rating');
    const sortScoreBtn = document.getElementById('sort-score');
    if (!sortRatingBtn || !sortScoreBtn) return;

    // currentSortKey の状態に合わせて active クラスを自動切り替え
    const activeKey = typeof currentSortKey !== 'undefined' ? currentSortKey : 'rating';
    if (activeKey === 'rating') {
        sortRatingBtn.classList.add('active');
        sortScoreBtn.classList.remove('active');
    } else {
        sortRatingBtn.classList.remove('active');
        sortScoreBtn.classList.add('active');
    }

    // 色定義マップ
    const colorMap = {
        'POWER': '#36a2eb',
        'NOTES': '#d7a62e',
        'CHUNI': '#239898',
        'TRICKY': '#9966ff'
    };

    const trendSwitch = document.getElementById('trend-enable-switch');
    const isTrendEnabled = trendSwitch ? trendSwitch.checked : false;
    const activeTrendBtn = isTrendEnabled ? document.querySelector('.btn-trend-filter.active') : null;
    const selectedTrend = activeTrendBtn ? activeTrendBtn.getAttribute('data-trend') : null;

    if (selectedTrend && colorMap[selectedTrend]) {
        // 💡 傾向ON時：ラベルを変更
        sortRatingBtn.textContent = `${selectedTrend}レート順`;
        sortScoreBtn.textContent = `${selectedTrend}定数順`;

        const activeColor = colorMap[selectedTrend];

        // 💡 アクティブな方に指定色背景＋白文字を付与
        if (sortRatingBtn.classList.contains('active')) {
            sortRatingBtn.style.backgroundColor = activeColor;
            sortRatingBtn.style.color = '#ffffff';
            sortRatingBtn.style.borderColor = activeColor;

            sortScoreBtn.style.backgroundColor = '';
            sortScoreBtn.style.color = '';
            sortScoreBtn.style.borderColor = '';
        } else {
            sortScoreBtn.style.backgroundColor = activeColor;
            sortScoreBtn.style.color = '#ffffff';
            sortScoreBtn.style.borderColor = activeColor;

            sortRatingBtn.style.backgroundColor = '';
            sortRatingBtn.style.color = '';
            sortRatingBtn.style.borderColor = '';
        }
    } else {
        // 💡 傾向OFF時：通常ラベルへ戻し、インラインCSSをクリア
        sortRatingBtn.textContent = "レート順";
        sortScoreBtn.textContent = "スコア順";

        [sortRatingBtn, sortScoreBtn].forEach(btn => {
            btn.style.backgroundColor = '';
            btn.style.color = '';
            btn.style.borderColor = '';
        });
    }
}

/**
 * Rating、テクニカルスコア、または傾向（POWER/NOTES/CHUNI/TRICKY）でのソート処理
 */
function sortData(data) {
    if (!data || data.length === 0) return;

    const sortKey = typeof currentSortKey !== 'undefined' ? currentSortKey : 'rating';

    // 1. 現在アクティブな傾向（POWER, NOTES, CHUNI, TRICKY）を取得
    const trendSwitch = document.getElementById('trend-enable-switch');
    const isTrendEnabled = trendSwitch ? trendSwitch.checked : false;
    const activeTrendBtn = isTrendEnabled ? document.querySelector('.btn-trend-filter.active') : null;
    const selectedTrend = activeTrendBtn ? activeTrendBtn.getAttribute('data-trend') : null;

    // 2. ソート実行
    data.sort((a, b) => {
        // 💡 傾向フィルターがON（傾向が選択されている）の場合
        if (selectedTrend) {
            if (sortKey === 'rating') {
                // 【POWERレート順】スコア補正後の値（tairyoku等）で比較
                const getRatingVal = (item) => {
                    if (selectedTrend === 'POWER') return parseFloat(item.tairyoku ?? item.rawTairyoku ?? 0);
                    if (selectedTrend === 'NOTES') return parseFloat(item.kenban ?? item.rawKenban ?? 0);
                    if (selectedTrend === 'CHUNI') return parseFloat(item.chuni ?? item.rawChuni ?? 0);
                    if (selectedTrend === 'TRICKY') return parseFloat(item.kuse ?? item.rawKuse ?? 0);
                    return 0;
                };

                const valA = getRatingVal(a);
                const valB = getRatingVal(b);
                if (valB !== valA) return valB - valA; // 降順

            } else {
                // 【POWER定数順】生コスト値（rawTairyoku等）で比較
                const getCostVal = (item) => {
                    if (selectedTrend === 'POWER') return parseFloat(item.rawTairyoku ?? item.tairyoku ?? 0);
                    if (selectedTrend === 'NOTES') return parseFloat(item.rawKenban ?? item.kenban ?? 0);
                    if (selectedTrend === 'CHUNI') return parseFloat(item.rawChuni ?? item.chuni ?? 0);
                    if (selectedTrend === 'TRICKY') return parseFloat(item.rawKuse ?? item.kuse ?? 0);
                    return 0;
                };

                const valA = getCostVal(a);
                const valB = getCostVal(b);
                if (valB !== valA) return valB - valA; // 降順
            }
        } else {
            // 💡 傾向フィルターがOFFの場合
            if (sortKey === 'rating') {
                // 【単曲レート順】
                const ratingA = parseFloat(a.rating) || 0;
                const ratingB = parseFloat(b.rating) || 0;
                if (ratingB !== ratingA) return ratingB - ratingA;
            } else {
                // 【テクニカルスコア順】
                const scoreA = parseFloat(a.score) || 0;
                const scoreB = parseFloat(b.score) || 0;
                if (scoreB !== scoreA) return scoreB - scoreA;
            }
        }

        // 同点時のフォールバック：常にテクニカルスコアが高い順
        const scoreA = parseFloat(a.score) || 0;
        const scoreB = parseFloat(b.score) || 0;
        return scoreB - scoreA;
    });
}

/**
 * 画面にスコアを表示する（escapeHTML不使用版）
 */
function displayScores(data) {
    console.log("--- displayScores開始 ---", data ? `${data.length}件` : "データなし");

    try {
        const body = document.getElementById('score-body');
        if (!body) {
            console.error("エラー: #score-body 要素が見つかりません。");
            return;
        }

        const colorMap = {
            'POWER': '#36a2eb',
            'NOTES': '#d7a62e',
            'CHUNI': '#239898',
            'TRICKY': '#9966ff'
        };

        const sortKey = typeof currentSortKey !== 'undefined' ? currentSortKey : 'rating';
        const trendSwitch = document.getElementById('trend-enable-switch');
        const isTrendEnabled = trendSwitch ? trendSwitch.checked : false;
        const activeTrendBtn = isTrendEnabled ? document.querySelector('.btn-trend-filter.active') : null;
        const selectedTrend = activeTrendBtn ? activeTrendBtn.getAttribute('data-trend') : null;

        const ratingHeader = document.getElementById('rating-header') || document.querySelector('thead th:last-child');

        if (ratingHeader) {
            ratingHeader.textContent = selectedTrend ? `${selectedTrend}値` : "単曲レート";
        }

        if (!data || !Array.isArray(data) || data.length === 0) {
            body.innerHTML = "<tr><td colspan='5'>表示できるデータがありません</td></tr>";
            return;
        }

        // 💡 傾向選択時の枠対象（Top 30）の算出
        const top30Set = new Set();
        if (selectedTrend) {
            const sourceData = (typeof myCurrentRecords !== "undefined" && Array.isArray(myCurrentRecords) && myCurrentRecords.length > 0)
                ? myCurrentRecords
                : data;

            const getRatingVal = (item) => {
                if (!item) return 0;
                if (selectedTrend === 'POWER') return parseFloat(item.tairyoku ?? item.rawTairyoku ?? 0);
                if (selectedTrend === 'NOTES') return parseFloat(item.kenban ?? item.rawKenban ?? 0);
                if (selectedTrend === 'CHUNI') return parseFloat(item.chuni ?? item.rawChuni ?? 0);
                if (selectedTrend === 'TRICKY') return parseFloat(item.kuse ?? item.rawKuse ?? 0);
                return 0;
            };

            [...sourceData]
                .sort((a, b) => getRatingVal(b) - getRatingVal(a))
                .slice(0, 30)
                .forEach(item => {
                    if (item && item.title && item.diff) {
                        top30Set.add(`${item.title}_${item.diff}`);
                    }
                });
        }

        body.innerHTML = "";
        const fragment = document.createDocumentFragment();
        const limitedData = data.slice(0, 200);

        const thresholds = window.rateThresholds || {};
        const new20Thresh = thresholds.new20 ?? Infinity;
        const best30Thresh = thresholds.best30 ?? Infinity;

        limitedData.forEach((item, index) => {
            if (!item) return;

            const titleText = item.title || "Unknown";
            const diffRaw = String(item.diff || "");
            const diffLower = diffRaw.toLowerCase();
            const isWE = (diffRaw.toUpperCase() === "WE");
            const isNew = typeof isNewSongCheck === 'function' ? isNewSongCheck(item.isNew) : Boolean(item.isNew);

            const currentConst = parseFloat(item.const) || 0;
            const tScore = parseFloat(item.score) || 0;
            const RatingNum = parseFloat(item.rating) || 0;

            const tr = document.createElement('tr');
            tr.className = diffLower;
            tr.style.cursor = "pointer";

            tr.onclick = () => {
                if (typeof loadRanking === "function") {
                    loadRanking(item.title, diffRaw, item.const);
                }
            };

            // ハイライトクラスの付与
            if (selectedTrend) {
                const itemKey = `${item.title}_${item.diff}`;
                if (top30Set.has(itemKey)) {
                    tr.classList.add(`is-${selectedTrend.toLowerCase()}-target`);
                }
            } else if (!isWE && RatingNum > 0) {
                if (isNew && RatingNum >= new20Thresh) {
                    tr.classList.add('is-new-target');
                } else if (!isNew && RatingNum >= best30Thresh) {
                    tr.classList.add('is-best-target');
                }
            }

            // 1. 番号セル
            const tdNum = document.createElement('td');
            tdNum.className = 'num-cell';
            tdNum.textContent = index + 1;
            tr.appendChild(tdNum);

            // 2. タイトル＆難易度セル
            const tdTitle = document.createElement('td');

            // Title DIV
            const divTitle = document.createElement('div');
            divTitle.className = 'title-cell';
            if (isNew) {
                const badge = document.createElement('span');
                badge.className = 'new-song-label';
                badge.textContent = 'NEW';
                divTitle.appendChild(badge);
            }
            divTitle.appendChild(document.createTextNode(titleText));
            tdTitle.appendChild(divTitle);

            // Diff Level DIV
            const divDiff = document.createElement('div');
            divDiff.className = 'diff-level-cell';

            if (selectedTrend) {
                let costVal = 0;
                let ratingVal = 0;

                if (selectedTrend === 'POWER') {
                    costVal = parseFloat(item.rawTairyoku ?? item.tairyoku ?? 0);
                    ratingVal = parseFloat(item.tairyoku ?? item.rawTairyoku ?? 0);
                } else if (selectedTrend === 'NOTES') {
                    costVal = parseFloat(item.rawKenban ?? item.kenban ?? 0);
                    ratingVal = parseFloat(item.kenban ?? item.rawKenban ?? 0);
                } else if (selectedTrend === 'CHUNI') {
                    costVal = parseFloat(item.rawChuni ?? item.chuni ?? 0);
                    ratingVal = parseFloat(item.chuni ?? item.rawChuni ?? 0);
                } else if (selectedTrend === 'TRICKY') {
                    costVal = parseFloat(item.rawKuse ?? item.kuse ?? 0);
                    ratingVal = parseFloat(item.kuse ?? item.rawKuse ?? 0);
                }

                const activeColor = colorMap[selectedTrend] || "#007aff";
                const displayCostStr = costVal > 0 ? costVal.toFixed(1) : "-";

                if (isWE) {
                    const attr = item.weAttr || item.attribute || "";
                    divDiff.textContent = `WORLD'S END ${attr ? `【${attr}】` : ""}`;
                } else {
                    divDiff.appendChild(document.createTextNode(`${diffRaw} `));
                    const spanCost = document.createElement('span');
                    spanCost.style.color = activeColor;
                    spanCost.style.fontWeight = 'bold';
                    spanCost.textContent = displayCostStr;
                    divDiff.appendChild(spanCost);
                }
            } else {
                if (isWE) {
                    const attr = item.weAttr || item.attribute || "";
                    divDiff.textContent = `WORLD'S END ${attr ? `【${attr}】` : ""}`;
                } else {
                    const displayLevel = currentConst > 0 ? currentConst.toFixed(1) : "-";
                    divDiff.textContent = `${diffRaw} ${displayLevel}`;
                }

                // トレンドタグ追加
                const rawTricky = parseFloat(item.rawKuse ?? item.kuse ?? 0);
                const rawPower = parseFloat(item.rawTairyoku ?? item.tairyoku ?? 0);
                const rawChuni = parseFloat(item.rawChuni ?? item.chuni ?? 0);
                const rawNotes = parseFloat(item.rawKenban ?? item.kenban ?? 0);

                const maxRawVal = Math.max(rawTricky, rawPower, rawChuni, rawNotes);
                let mainTrendTrend = "None";
                if (maxRawVal > 0) {
                    if (rawTricky === maxRawVal) mainTrendTrend = 'TRICKY';
                    else if (rawPower === maxRawVal) mainTrendTrend = 'POWER';
                    else if (rawChuni === maxRawVal) mainTrendTrend = 'CHUNI';
                    else if (rawNotes === maxRawVal) mainTrendTrend = 'NOTES';
                } else if (item.mainTrend && item.mainTrend !== "None") {
                    mainTrendTrend = item.mainTrend;
                }

                if (mainTrendTrend !== "None") {
                    const trendColor = colorMap[mainTrendTrend] || "#555";
                    divDiff.appendChild(document.createTextNode(" / "));
                    const spanTrend = document.createElement('span');
                    spanTrend.style.color = trendColor;
                    spanTrend.textContent = mainTrendTrend;
                    divDiff.appendChild(spanTrend);
                }
            }
            tdTitle.appendChild(divDiff);
            tr.appendChild(tdTitle);

            // 3. ランプ＆ジャスティス失点セル
            const tdLamp = document.createElement('td');
            tdLamp.className = 'lamp-cell';

            const totalNotes = parseInt(item.notes ?? item.totalNotes ?? item.combo ?? (item.songProps ? item.songProps.notes : 0) ?? 0, 10);
            const currentScore = parseInt(item.score || 0, 10);
            const lampText = item.lamp || "";

            let comboClass = "";
            if (lampText === "AJC") comboClass = "ajc-badge";
            else if (lampText === "AJ") comboClass = "aj-badge";
            else if (lampText === "FC") comboClass = "fc-badge";

            if (totalNotes > 0 && currentScore > 0 && currentScore < 1010000) {
                const jTotal = ((1010000 - currentScore) * totalNotes) / 10000;

                if (lampText.includes("AJ")) {
                    const spanLamp = document.createElement('span');
                    spanLamp.className = comboClass;
                    spanLamp.textContent = lampText;
                    tdLamp.appendChild(spanLamp);

                    const jCount = Math.round(jTotal);
                    if (!lampText.includes("AJC") && jCount > 0) {
                        const divJ = document.createElement('div');
                        divJ.className = 'justice-count';
                        divJ.style.cssText = 'font-size: 0.75rem; color: #ff9500; font-weight: bold; margin-top: 2px;';
                        divJ.textContent = `-${jCount}`;
                        tdLamp.appendChild(divJ);
                    }
                } else if (lampText.includes("FC")) {
                    const spanLamp = document.createElement('span');
                    spanLamp.className = comboClass;
                    spanLamp.textContent = lampText;
                    tdLamp.appendChild(spanLamp);

                    if (jTotal >= 51 && jTotal <= 101) {
                        const divA = document.createElement('div');
                        divA.className = 'attack-count';
                        divA.style.cssText = 'font-size: 0.75rem; color: #2ecc71; font-weight: bold; margin-top: 2px;';
                        divA.textContent = '-1';
                        tdLamp.appendChild(divA);
                    }
                } else {
                    if (jTotal >= 101 && jTotal <= 151) {
                        const spanLoss = document.createElement('span');
                        spanLoss.style.cssText = 'color: #888888; font-weight: bold; font-size: 0.85rem;';
                        spanLoss.textContent = '-1';
                        tdLamp.appendChild(spanLoss);
                    } else {
                        tdLamp.textContent = "-";
                    }
                }
            } else if (lampText) {
                const spanLamp = document.createElement('span');
                spanLamp.className = comboClass;
                spanLamp.textContent = lampText;
                tdLamp.appendChild(spanLamp);
            } else {
                tdLamp.textContent = "-";
            }
            tr.appendChild(tdLamp);

            // 4. スコアセル
            const tdScore = document.createElement('td');
            tdScore.className = 't-score-cell';
            const spanScore = document.createElement('span');
            spanScore.className = 't-score';
            spanScore.textContent = tScore.toLocaleString();
            tdScore.appendChild(spanScore);
            tr.appendChild(tdScore);

            // 5. 単曲レートセル
            const tdRating = document.createElement('td');
            tdRating.className = 't-rating-cell';
            const spanRating = document.createElement('span');
            spanRating.className = 't-rating';

            if (selectedTrend) {
                let ratingVal = 0;
                if (selectedTrend === 'POWER') ratingVal = parseFloat(item.tairyoku ?? item.rawTairyoku ?? 0);
                else if (selectedTrend === 'NOTES') ratingVal = parseFloat(item.kenban ?? item.rawKenban ?? 0);
                else if (selectedTrend === 'CHUNI') ratingVal = parseFloat(item.chuni ?? item.rawChuni ?? 0);
                else if (selectedTrend === 'TRICKY') ratingVal = parseFloat(item.kuse ?? item.rawKuse ?? 0);

                const activeColor = colorMap[selectedTrend] || "#007aff";
                spanRating.style.color = activeColor;
                spanRating.style.fontWeight = 'bold';
                spanRating.textContent = ratingVal > 0 ? ratingVal.toFixed(2) : "-";
            } else {
                const ratingStr = (!isWE && RatingNum > 0)
                    ? (Math.floor((RatingNum + 0.000001) * 100) / 100).toFixed(2)
                    : "-";
                spanRating.textContent = ratingStr;
            }
            tdRating.appendChild(spanRating);
            tr.appendChild(tdRating);

            fragment.appendChild(tr);
        });

        body.appendChild(fragment);
        console.log("--- displayScores正常完了 ---");

    } catch (error) {
        console.error("displayScores 描画処理中にエラーが発生しました:", error);
    }
}

// =================================================================
// 💡 マイセットモーダル管理機能
// =================================================================

/**
 * 現在のフィルター状態をオブジェクトとして取得
 */
function getCurrentFilterState() {
    return {
        searchText: document.getElementById('search-input')?.value || "",
        minConst: document.getElementById('min-constant')?.value || "13.5",
        maxConst: document.getElementById('max-constant')?.value || "16.0",
        minRate: document.getElementById('min-rating')?.value || "",
        maxRate: document.getElementById('max-rating')?.value || "",
        lamp: document.getElementById('lamp-filter')?.value || "all",
        filterMode: document.getElementById('filter-mode')?.value || "rank",
        rankMin: document.getElementById('rank-min')?.value || "0",
        rankMax: document.getElementById('rank-max')?.value || "1010000",
        minScore: document.getElementById('min-score')?.value || "",
        maxScore: document.getElementById('max-score')?.value || "",
        typeFilter: typeof currentTypeFilter !== 'undefined' ? currentTypeFilter : 'all',
        activeDiffs: Array.from(document.querySelectorAll('.btn-diff-filter.active')).map(btn => btn.getAttribute('data-diff')),
        isTrendEnabled: document.getElementById('trend-enable-switch')?.checked || false,
        activeTrends: Array.from(document.querySelectorAll('.btn-trend-filter.active')).map(btn => btn.getAttribute('data-trend'))
    };
}

/**
 * マイセットモーダルを開く
 */
function openMysetModal() {
    renderMysetList();
    const modal = document.getElementById('myset-modal');
    if (modal) modal.style.display = 'flex';
}

/**
 * マイセットモーダルを閉じる
 */
function closeMysetModal() {
    const modal = document.getElementById('myset-modal');
    if (modal) modal.style.display = 'none';
}

/**
 * モーダル内のマイセットスロット一覧を描画
 */
function renderMysetList() {
    const container = document.getElementById('myset-list-container');
    if (!container) return;

    container.innerHTML = '';

    [1, 2, 3, 4, 5].forEach(slotNum => {
        const saved = localStorage.getItem(`filter_myset_${slotNum}`);
        const mysetData = saved ? JSON.parse(saved) : null;

        const row = document.createElement('div');
        row.style.cssText = "display: flex; align-items: center; justify-content: space-between; background: #f5f5f5; padding: 10px; border-radius: 6px; gap: 8px;";

        if (mysetData) {
            row.innerHTML = `
                <div style="flex: 1; overflow: hidden;">
                    <div style="font-weight: bold; font-size: 14px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${mysetData.name}</div>
                    <div style="font-size: 10px; color: #666;">スロット ${slotNum}</div>
                </div>
                <button type="button" onclick="applyMyset(${slotNum})" style="background: #2e7df0; color: #fff; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold;">適用</button>
                <button type="button" onclick="saveMysetToSlot(${slotNum})" style="background: #e67e22; color: #fff; border: none; padding: 6px 8px; border-radius: 4px; cursor: pointer; font-size: 11px;">上書き</button>
                <button type="button" onclick="deleteMysetSlot(${slotNum})" style="background: #e74c3c; color: #fff; border: none; padding: 6px 8px; border-radius: 4px; cursor: pointer; font-size: 11px;">削除</button>
            `;
        } else {
            row.innerHTML = `
                <div style="flex: 1; color: #aaa; font-size: 13px;">スロット ${slotNum} (未登録)</div>
                <button type="button" onclick="saveMysetToSlot(${slotNum})" style="background: #27ae60; color: #fff; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold;">現在の条件を保存</button>
            `;
        }

        container.appendChild(row);
    });
}

/**
 * 指定スロットへ現在の条件を保存
 */
function saveMysetToSlot(slotNum) {
    const currentData = localStorage.getItem(`filter_myset_${slotNum}`);
    const defaultName = currentData ? JSON.parse(currentData).name : `マイセット ${slotNum}`;

    const setName = prompt(`スロット ${slotNum} の名前を入力してください:`, defaultName);
    if (setName === null) return;

    const filterState = getCurrentFilterState();
    const mysetData = {
        name: setName.trim() || `マイセット ${slotNum}`,
        state: filterState
    };

    localStorage.setItem(`filter_myset_${slotNum}`, JSON.stringify(mysetData));
    renderMysetList();
}

/**
 * 指定スロットのマイセットを削除
 */
function deleteMysetSlot(slotNum) {
    if (confirm(`スロット ${slotNum} のマイセットを削除しますか？`)) {
        localStorage.removeItem(`filter_myset_${slotNum}`);
        renderMysetList();
    }
}

/**
 * 指定スロットの条件を画面に反映
 */
function applyMyset(slotNum) {
    const saved = localStorage.getItem(`filter_myset_${slotNum}`);
    if (!saved) return;

    const s = JSON.parse(saved).state;

    // 各フォームへの読み込み
    if (document.getElementById('search-input')) document.getElementById('search-input').value = s.searchText || "";
    if (document.getElementById('min-constant')) document.getElementById('min-constant').value = s.minConst || "13.5";
    if (document.getElementById('max-constant')) document.getElementById('max-constant').value = s.maxConst || "16.0";
    if (document.getElementById('min-rating')) document.getElementById('min-rating').value = s.minRate || "";
    if (document.getElementById('max-rating')) document.getElementById('max-rating').value = s.maxRate || "";
    if (document.getElementById('lamp-filter')) document.getElementById('lamp-filter').value = s.lamp || "all";

    if (document.getElementById('rank-min')) document.getElementById('rank-min').value = s.rankMin || "0";
    if (document.getElementById('rank-max')) document.getElementById('rank-max').value = s.rankMax || "1010000";
    if (document.getElementById('min-score')) document.getElementById('min-score').value = s.minScore || "";
    if (document.getElementById('max-score')) document.getElementById('max-score').value = s.maxScore || "";

    // モード切替
    const filterModeSelect = document.getElementById('filter-mode');
    if (filterModeSelect) {
        filterModeSelect.value = s.filterMode || "rank";
        filterModeSelect.dispatchEvent(new Event('change'));
    }

    // 対象ボタン (ALL / OLD / NEW)
    currentTypeFilter = s.typeFilter || 'all';
    document.querySelectorAll('.btn-filter').forEach(btn => {
        btn.classList.remove('active');
        if (
            (currentTypeFilter === 'all' && btn.id === 'filter-all') ||
            (currentTypeFilter === 'old' && btn.id === 'filter-old') ||
            (currentTypeFilter === 'new' && btn.id === 'filter-new')
        ) {
            btn.classList.add('active');
        }
    });

    // 難易度ボタン
    document.querySelectorAll('.btn-diff-filter').forEach(btn => {
        const diff = btn.getAttribute('data-diff');
        if (s.activeDiffs && s.activeDiffs.includes(diff)) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // トレンドスイッチ
    const trendSwitch = document.getElementById('trend-enable-switch');
    if (trendSwitch) {
        trendSwitch.checked = !!s.isTrendEnabled;
    }
    document.querySelectorAll('.btn-trend-filter').forEach(btn => {
        const trend = btn.getAttribute('data-trend');
        if (s.isTrendEnabled) {
            btn.classList.remove('trend-disabled');
            if (s.activeTrends && s.activeTrends.includes(trend)) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        } else {
            btn.classList.remove('active');
            btn.classList.add('trend-disabled');
        }
    });

    // フィルタ再適用 & モーダル全閉じ
    updateFilters();
    closeMysetModal();

    // アコーディオン（details）を自動でたたむ（オプション）
    const drawer = document.querySelector('.filter-drawer');
    if (drawer) drawer.open = false;
}

/**
 * 補助関数：選択されたランク区分の「スコア上限」を返す
 * 範囲指定（rankMax）の判定に使用します
 */
function getUpperLimit(score) {
    if (score >= 1010000) return 1010000; // 理論値なら1010000まで
    if (score >= 1009900) return 1009999; // 99AJなら理論値手前まで
    if (score >= 1009000) return 1009899; // SSS+なら99AJ手前まで
    if (score >= 1007500) return 1008999; // SSSならSSS+手前まで
    if (score >= 1007000) return 1007499; // 7000ならSSS手前まで
    if (score >= 1005000) return 1006999; // SS+なら7000手前まで
    if (score >= 1000000) return 1004999; // SSならSS+手前まで
    if (score >= 990000) return 999999;  // S+ならSS手前まで
    if (score >= 970000) return 989999;  // SならS+手前まで
    return 969999; // それ未満
}





// --- 共通ヘルパー関数（先頭にまとめて定義） ---
const floorTo2nd = (num) => (!num || isNaN(num)) ? 0 : Math.floor((num + 0.0000001) * 100) / 100;
const floorTo4th = (num) => (!num || isNaN(num)) ? 0 : Math.floor((num + 0.0000001) * 10000) / 10000;

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

let currentTab = "best";
let currentModalPlayerName = "";

// 💡 グローバル変数として安全に初期化
window.rateThresholds = window.rateThresholds || { new20: 0, best30: 0 };

/**
 * 💡 isNew（新曲判別）を安全にboolean化するヘルパー関数
 */
function isNewSongCheck(isNewVal) {
    if (typeof isNewVal === 'boolean') return isNewVal;
    if (typeof isNewVal === 'number') return isNewVal === 1;
    if (typeof isNewVal === 'string') {
        const s = isNewVal.trim().toLowerCase();
        return s === 'true' || s === '1' || s === 'new';
    }
    return false;
}

/**
 * 3. レート計算（新20 + 旧30）
 */
function calculatechuniRate(playerName) {
    const rateDisplay = document.getElementById('rating-average');
    if (!rateDisplay) return;

    const targetData = (typeof allRecords !== 'undefined' ? allRecords : myCurrentRecords) || [];

    if (targetData.length === 0) {
        rateDisplay.innerText = "データがありません。同期を行ってください。";
        return;
    }

    // 💡 isNewSongCheckで安全に判定
    const newSongs = targetData.filter(s => isNewSongCheck(s.isNew));
    const bestSongs = targetData.filter(s => !isNewSongCheck(s.isNew));

    const getTopData = (list, count) => {
        const sorted = list
            .map(s => floorTo2nd(parseFloat(s.rating) || 0))
            .sort((a, b) => b - a);

        const top = sorted.slice(0, count);
        const rawAvg = top.length > 0 ? top.reduce((a, b) => a + b, 0) / count : 0;
        const avg = floorTo4th(rawAvg);
        const threshold = sorted.length >= count ? sorted[count - 1] : (sorted[sorted.length - 1] || 0);

        return { avg, threshold };
    };

    const newData = getTopData(newSongs, 20);
    const bestData = getTopData(bestSongs, 30);

    // 安全に代入
    window.rateThresholds.new20 = newData.threshold;
    window.rateThresholds.best30 = bestData.threshold;

    const totalRate = floorTo4th((newData.avg * 20 + bestData.avg * 30) / 50);

    // --- HTML出力 ---
    const displayName = playerName || "Player";

    rateDisplay.innerHTML = `
        <div class="rating-container">
            <span class="user-name"><strong>${escapeHtml(displayName)}</strong></span>
            <span class="divider">|</span>
            <span class="rate-total">Rating: <span class="highlight-number main-rate">${totalRate.toFixed(4)}</span></span>
            <span class="divider">|</span>
            <span>BEST: <span class="highlight-number">${bestData.avg.toFixed(4)}</span></span>
            <span class="divider">|</span>
            <span>NEW: <span class="highlight-number">${newData.avg.toFixed(4)}</span></span>
        </div>
    `;

    attachRatingWrapperEvent(displayName);
}

let allPlayerNames = []; // 💡 ユーザー名一覧の保持用
let allUsersRecords = {}; // 💡 取得済みデータのキャッシュ用

/**
 * rating-wrapper クリック時のイベント割り当て
 */
function attachRatingWrapperEvent(playerName) {
    currentModalPlayerName = playerName || "Player";

    // class="rating-wrapper" または id="rating-wrapper" を取得
    const wrapper = document.querySelector('.rating-wrapper') ||
        document.getElementById('rating-wrapper') ||
        document.querySelector('.rating-container');

    if (wrapper) {
        wrapper.style.cursor = 'pointer';
        wrapper.title = 'クリックして枠データ詳細を表示';
        // 登録済みのクリックイベントをクリアしてから新規割り当て
        wrapper.onclick = () => openRatingModal();
    }
}

/**
 * モーダルを開く
 */
function openRatingModal() {
    const modal = document.getElementById('rating-modal');
    if (!modal) return;

    modal.style.display = 'flex';
    setupModalEvents();

    // 💡 モーダルを開くタイミングで全プレイヤー一覧を取得・更新
    fetchPlayerNames();

    renderTabContent(currentTab);
}

/**
 * イベントの初期化（閉じる・タブ切替）
 */
function setupModalEvents() {
    const closeBtn = document.getElementById('modal-close-btn');
    const modal = document.getElementById('rating-modal');

    if (closeBtn) closeBtn.onclick = () => modal.style.display = 'none';
    if (modal) {
        modal.onclick = (e) => {
            if (e.target === modal) modal.style.display = 'none';
        };
    }

    const tabBtns = document.querySelectorAll('#rating-modal .tab-btn');
    tabBtns.forEach(btn => {
        btn.onclick = () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentTab = btn.getAttribute('data-tab');
            renderTabContent(currentTab);
        };
    });
}

/**
 * 💡 ユーザー名一覧を取得（キャッシュが無ければ通信、あればローカル読み込み）
 */
async function fetchPlayerNames() {
    // 1. すでに LocalStorage にある場合は通信を行わず終了
    const cachedPlayers = localStorage.getItem('chunirec_all_players');
    if (cachedPlayers) {
        try {
            allPlayerNames = JSON.parse(cachedPlayers);
            if (document.getElementById('modal-tab-content')) {
                renderTabContent(currentTab);
            }
            return; // 💡 通信なしで即終了
        } catch (e) {
            console.error("キャッシュの読み込みに失敗:", e);
        }
    }

    // 2. 初回（キャッシュが無い場合）のみ GAS から取得して保存
    try {
        const response = await fetch(GAS_URL, {
            method: "POST",
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ mode: "get_vs_players" })
        });
        const result = await response.json();

        if (result.status === "success" && Array.isArray(result.players)) {
            allPlayerNames = result.players;
            // キャッシュ保存
            localStorage.setItem('chunirec_all_players', JSON.stringify(result.players));

            if (document.getElementById('modal-tab-content')) {
                renderTabContent(currentTab);
            }
        }
    } catch (e) {
        console.error("ユーザー一覧取得エラー:", e);
    }
}


let modalRadarChartInstance = null;
let selectedComparePlayers = []; // 比較対象プレイヤー名の保持用（最大3名）

// 比較対象プレイヤー用カラーパレット
const COMPARISON_COLORS = [
    { border: 'rgba(54, 162, 235, 1)', bg: 'rgba(54, 162, 235, 0.15)' },  // 青
    { border: 'rgba(255, 159, 64, 1)', bg: 'rgba(255, 159, 64, 0.15)' }, // オレンジ
    { border: 'rgba(75, 192, 192, 1)', bg: 'rgba(75, 192, 192, 0.15)' }   // グリーン
];

/**
 * 💡 1人のプレイヤーの4傾向（Top 30）の平均値を算出
 */
function calcPlayerAbilityAverages(targetData) {
    if (!Array.isArray(targetData) || targetData.length === 0) {
        return { tairyoku: 0, kenban: 0, chuni: 0, kuse: 0 };
    }

    const keys = [
        { modKey: "tairyoku", rawKey: "rawTairyoku", prop: "tairyoku" },
        { modKey: "kenban", rawKey: "rawKenban", prop: "kenban" },
        { modKey: "chuni", rawKey: "rawChuni", prop: "chuni" },
        { modKey: "kuse", rawKey: "rawKuse", prop: "kuse" }
    ];

    const result = { tairyoku: 0, kenban: 0, chuni: 0, kuse: 0 };

    keys.forEach(k => {
        const songs = getTopAbilitySongs(targetData, k.modKey, k.rawKey, 30);
        const sum = songs.reduce((a, b) => a + (b.calcVal || 0), 0);
        result[k.prop] = songs.length > 0 ? sum / songs.length : 0;
    });

    return result;
}

/**
 * 💡 特定プレイヤーのレコードを取得（GASの `get_player_data` と連動）
 */
async function fetchSinglePlayerData(name) {
    if (!name) return null;

    // 💡 すでに有効なキャッシュ（1件以上）が存在すればそれを返す
    if (allUsersRecords[name] && allUsersRecords[name].length > 0) {
        return allUsersRecords[name];
    }

    try {
        const response = await fetch(GAS_URL, {
            method: "POST",
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                mode: "get_player_data",
                playerName: name
            })
        });

        // 通信応答の安全チェック
        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const result = await response.json();

        // GAS側レスポンス: { status: "success", playerName: "...", records: [...] }
        if (result.status === "success" && Array.isArray(result.records) && result.records.length > 0) {
            allUsersRecords[name] = result.records;
            return allUsersRecords[name];
        } else {
            // データが取得できなかった場合は空のキャッシュを破棄
            delete allUsersRecords[name];
        }
    } catch (e) {
        console.error(`データ取得失敗 (${name}):`, e);
        delete allUsersRecords[name];
    }
    return null;
}

/**
 * 💡 プレイヤー選択ドロップダウン変更時の処理
 */
async function handlePlayerChange(selectedName) {
    if (!selectedName) return;
    currentModalPlayerName = selectedName;

    const container = document.getElementById('modal-tab-content');
    if (container) {
        container.innerHTML = "<p style='text-align:center; padding: 20px;'>データを読み込み中...</p>";
    }

    // キャッシュがある場合は即座に再描画
    if (allUsersRecords[selectedName] && allUsersRecords[selectedName].length > 0) {
        renderTabContent(currentTab);
        return;
    }

    // GASへデータ取得
    const records = await fetchSinglePlayerData(selectedName);

    if (records && records.length > 0) {
        renderTabContent(currentTab);
    } else {
        if (container) {
            container.innerHTML = `<p style='text-align:center; padding: 20px; color: red;'>プレイヤー「${selectedName}」のスコアデータが見つかりませんでした。<br>シートが存在するか、またはデータが登録されているか確認してください。</p>`;
        }
    }
}

/**
 * 💡 重ね合わせレーダーチャート描画処理（キャンバス競合回避・動的スケール対応版）
 */
async function renderOverlappedRadarChart() {
    const canvas = document.getElementById('modal-radar-canvas-overlapped');
    if (!canvas) return;

    // 💡 非同期通信中の連続呼び出し対策：キャンバスに紐づく既存チャートを即座に破棄
    const existingChart = Chart.getChart(canvas);
    if (existingChart) {
        existingChart.destroy();
    }

    const mainName = currentModalPlayerName;
    const mainData = await fetchSinglePlayerData(mainName);
    const mainAvg = calcPlayerAbilityAverages(mainData);

    const mainVals = [mainAvg.tairyoku, mainAvg.kenban, mainAvg.chuni, mainAvg.kuse];
    let allVals = [...mainVals];

    const datasets = [];

    // 1. メインプレイヤー（赤・太線・強調表示）
    datasets.push({
        label: `${mainName} (メイン)`,
        data: mainVals,
        backgroundColor: 'rgba(255, 71, 87, 0.25)',
        borderColor: 'rgba(255, 71, 87, 1)',
        borderWidth: 3,
        pointBackgroundColor: 'rgba(255, 71, 87, 1)',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointRadius: 5,
        order: 0
    });

    // 2. 比較対象プレイヤー（最大3名）
    for (let i = 0; i < selectedComparePlayers.length; i++) {
        const compName = selectedComparePlayers[i];
        if (compName === mainName) continue;

        const compData = await fetchSinglePlayerData(compName);
        const compAvg = calcPlayerAbilityAverages(compData);
        const compVals = [compAvg.tairyoku, compAvg.kenban, compAvg.chuni, compAvg.kuse];

        allVals = allVals.concat(compVals);

        const color = COMPARISON_COLORS[i % COMPARISON_COLORS.length];
        datasets.push({
            label: compName,
            data: compVals,
            backgroundColor: color.bg,
            borderColor: color.border,
            borderWidth: 2,
            pointBackgroundColor: color.border,
            pointBorderColor: '#fff',
            pointBorderWidth: 1.5,
            pointRadius: 4,
            order: i + 1
        });
    }

    // 💡 非同期処理（await）が終わった直後に再度キャンバスの状態をチェックして破棄
    const activeChartBeforeCreate = Chart.getChart(canvas);
    if (activeChartBeforeCreate) {
        activeChartBeforeCreate.destroy();
    }

    // スケール範囲の動的算出
    const rawMin = Math.min(...allVals);
    const rawMax = Math.max(...allVals);
    const chartMin = Math.max(0, Math.floor(rawMin) - 1);
    const chartMax = Math.ceil(rawMax) + 1;

    const diff = chartMax - chartMin;
    let stepSize = 1;
    if (diff > 15) stepSize = 5;
    else if (diff > 8) stepSize = 2;

    modalRadarChartInstance = new Chart(canvas, {
        type: 'radar',
        data: {
            labels: ['POWER', 'NOTES', 'CHUNI', 'TRICKY'],
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: 12 },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        boxWidth: 12,
                        padding: 12,
                        font: { size: 12, weight: 'bold' }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            return ` ${context.dataset.label}: ${context.raw.toFixed(2)}`;
                        }
                    }
                }
            },
            scales: {
                r: {
                    angleLines: { display: true, color: 'rgba(0, 0, 0, 0.1)' },
                    grid: { color: 'rgba(0, 0, 0, 0.08)' },
                    min: chartMin,
                    max: chartMax,
                    ticks: {
                        stepSize: stepSize,
                        backdropColor: 'transparent',
                        font: { size: 10, weight: 'bold' }
                    },
                    pointLabels: {
                        font: { size: 11, weight: 'bold', lineHeight: 1.3 },
                        textAlign: 'center',
                        callback: function (label, index) {
                            const val = mainVals[index] || 0;
                            return [label, val.toFixed(2)];
                        },
                        color: function (context) {
                            const colors = ['#36a2eb', '#d7a62e', '#239898', '#9966ff'];
                            return colors[context.index] || '#333';
                        }
                    }
                }
            }
        }
    });
}

/**
 * 💡 比較対象プレイヤーの選択変更イベント handler
 */
function handleCompareCheckboxChange(checkbox) {
    const val = checkbox.value;
    if (checkbox.checked) {
        if (selectedComparePlayers.length >= 3) {
            alert("比較対象は最大3名まで選択可能です。");
            checkbox.checked = false;
            return;
        }
        if (!selectedComparePlayers.includes(val)) {
            selectedComparePlayers.push(val);
        }
    } else {
        selectedComparePlayers = selectedComparePlayers.filter(name => name !== val);
    }
    renderOverlappedRadarChart();
}

/**
 * 💡 メインプレイヤーの選択変更イベント handler
 */
async function handleRadarMainPlayerChange(val) {
    currentModalPlayerName = val;
    // メインプレイヤーと比較対象が重複した場合は選択解除
    selectedComparePlayers = selectedComparePlayers.filter(name => name !== val);

    // RADARタブを再描画してコントロール群を更新
    renderTabContent('radar');
}

/**
 * タブ内容の生成（async化）
 */
async function renderTabContent(tabKey) {
    const container = document.getElementById('modal-tab-content');
    if (!container) return;

    // 💡 RADAR タブ専用の描画分岐（重ね合わせチャート ＋ 比較選択UI）
    if (tabKey === 'radar') {
        const systemSheets = ["VideoRequests", "VideoSupplies", "MasterData", "Template"];
        let rawList = [];
        if (typeof allPlayerNames !== 'undefined' && Array.isArray(allPlayerNames)) {
            rawList = rawList.concat(allPlayerNames);
        }
        if (typeof allUsersRecords !== 'undefined') {
            rawList = rawList.concat(Object.keys(allUsersRecords));
        }

        let playerList = Array.from(new Set(rawList)).filter(p => p && !systemSheets.includes(p));
        if (playerList.length === 0) playerList = [currentModalPlayerName];

        // メインプレイヤー用ドロップダウンHTML
        const mainSelectOptions = playerList.map(name => `
            <option value="${escapeHtml(name)}" ${name === currentModalPlayerName ? 'selected' : ''}>
                ${escapeHtml(name)}
            </option>
        `).join('');

        // 比較用チェックボックスHTML（メインプレイヤー以外を表示）
        const compareCheckboxesHtml = playerList
            .filter(name => name !== currentModalPlayerName)
            .map(name => {
                const isChecked = selectedComparePlayers.includes(name) ? 'checked' : '';
                return `
                    <label style="display: inline-flex; align-items: center; gap: 4px; font-size: 13px; background: #fff; padding: 4px 8px; border-radius: 4px; border: 1px solid #ddd; cursor: pointer;">
                        <input type="checkbox" value="${escapeHtml(name)}" ${isChecked} onchange="handleCompareCheckboxChange(this)" />
                        ${escapeHtml(name)}
                    </label>
                `;
            }).join('');

        container.innerHTML = `
            <div class="radar-controls" style="background: #f8f9fa; padding: 12px; border-radius: 8px; margin-bottom: 12px; border: 1px solid #e2e8f0;">
                <div style="margin-bottom: 10px; display: flex; align-items: center; gap: 8px;">
                    <label style="font-weight: bold; font-size: 13px; color: #333; min-width: 130px;">★ メインプレイヤー:</label>
                    <select class="player-select-dropdown" style="padding: 4px 8px; font-weight: bold;" onchange="handleRadarMainPlayerChange(this.value)">
                        ${mainSelectOptions}
                    </select>
                </div>
                <div>
                    <label style="font-weight: bold; font-size: 12px; color: #666; display: block; margin-bottom: 6px;">
                        比較対象を選択 (最大3名まで):
                    </label>
                    <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                        ${compareCheckboxesHtml || "<span style='font-size:12px; color:#888;'>比較可能な他プレイヤーがいません</span>"}
                    </div>
                </div>
            </div>

            <div style="position: relative; height: 380px; width: 100%;">
                <canvas id="modal-radar-canvas-overlapped"></canvas>
            </div>
        `;

        requestAnimationFrame(() => {
            renderOverlappedRadarChart();
        });
        return;
    }

    // 💡 選択中のプレイヤーのデータがあればそれを優先、無ければ自分(allRecords)を使用
    let targetData = [];
    if (typeof allUsersRecords !== 'undefined' && allUsersRecords[currentModalPlayerName]) {
        targetData = allUsersRecords[currentModalPlayerName];
    } else {
        targetData = (typeof allRecords !== 'undefined' ? allRecords : myCurrentRecords) || [];
    }

    if (targetData.length === 0) {
        container.innerHTML = "<p style='text-align:center;'>データがありません。</p>";
        return;
    }

    // ドロップダウン選択肢の共通生成
    const systemSheets = ["VideoRequests", "VideoSupplies", "MasterData", "Template"];
    let rawList = [];
    if (typeof allPlayerNames !== 'undefined' && Array.isArray(allPlayerNames)) {
        rawList = rawList.concat(allPlayerNames);
    }
    if (typeof allUsersRecords !== 'undefined') {
        rawList = rawList.concat(Object.keys(allUsersRecords));
    }

    let playerList = Array.from(new Set(rawList)).filter(p => p && !systemSheets.includes(p));
    if (playerList.length === 0) {
        playerList = [currentModalPlayerName];
    } else if (currentModalPlayerName && !playerList.includes(currentModalPlayerName)) {
        playerList.unshift(currentModalPlayerName);
    }

    const selectOptionsHtml = playerList.map(name => `
        <option value="${escapeHtml(name)}" ${name === currentModalPlayerName ? 'selected' : ''}>
            ${escapeHtml(name)}
        </option>
    `).join('');

    // --- 以下、既存の曲リスト表示処理 (best, new, power, notes, chuni, tricky) ---
    let songs = [];
    let isRateMode = false;
    let limit = 30;
    let colorClass = "";
    let tabTitle = "";
    let columnHeader = "定数";

    switch (tabKey) {
        case 'best':
            tabTitle = "BEST";
            limit = 30;
            isRateMode = true;
            colorClass = "color-best";
            columnHeader = "定数";
            songs = targetData.filter(s => !s.isNew)
                .map(s => ({
                    ...s,
                    calcVal: floorTo2nd(parseFloat(s.rating) || 0),
                    displayConst: parseFloat(s.const || 0).toFixed(1)
                }))
                .sort((a, b) => b.calcVal - a.calcVal)
                .slice(0, limit);
            break;

        case 'new':
            tabTitle = "NEW";
            limit = 20;
            isRateMode = true;
            colorClass = "color-new";
            columnHeader = "定数";
            songs = targetData.filter(s => s.isNew)
                .map(s => ({
                    ...s,
                    calcVal: floorTo2nd(parseFloat(s.rating) || 0),
                    displayConst: parseFloat(s.const || 0).toFixed(1)
                }))
                .sort((a, b) => b.calcVal - a.calcVal)
                .slice(0, limit);
            break;

        case 'power':
            tabTitle = "POWER";
            colorClass = "color-power";
            columnHeader = "POWER";
            songs = getTopAbilitySongs(targetData, "tairyoku", "rawTairyoku", 30);
            break;

        case 'notes':
            tabTitle = "NOTES";
            colorClass = "color-notes";
            columnHeader = "NOTES";
            songs = getTopAbilitySongs(targetData, "kenban", "rawKenban", 30);
            break;

        case 'chuni':
            tabTitle = "CHUNI";
            colorClass = "color-chuni";
            columnHeader = "CHUNI";
            songs = getTopAbilitySongs(targetData, "chuni", "rawChuni", 30);
            break;

        case 'tricky':
            tabTitle = "TRICKY";
            colorClass = "color-tricky";
            columnHeader = "TRICKY";
            songs = getTopAbilitySongs(targetData, "kuse", "rawKuse", 30);
            break;
    }

    // 平均値の計算
    let avgDisplay = "0.0000";
    if (isRateMode) {
        const rawAvg = songs.length > 0 ? songs.reduce((a, b) => a + b.calcVal, 0) / limit : 0;
        avgDisplay = floorTo4th(rawAvg).toFixed(4);
    } else {
        const sum = songs.reduce((a, b) => a + (b.calcVal || 0), 0);
        const avg = songs.length > 0 ? sum / songs.length : 0;
        avgDisplay = avg.toFixed(2);
    }

    const half = Math.ceil(songs.length / 2);
    const leftSongs = songs.slice(0, half);
    const rightSongs = songs.slice(half);

    let html = `
        <div class="modal-header-summary">
            <select class="player-select-dropdown" onchange="handlePlayerChange(this.value)">
                ${selectOptionsHtml}
            </select>
            <div class="tab-avg-box">
                <span>${tabTitle} 平均:</span>
                <span class="avg-val ${colorClass}">${avgDisplay}</span>
            </div>
        </div>
        <div class="two-column-grid">
            ${buildTableHtml(leftSongs, 0, isRateMode, colorClass, columnHeader)}
            ${buildTableHtml(rightSongs, half, isRateMode, colorClass, columnHeader)}
        </div>
    `;

    container.innerHTML = html;
}

/**
 * 💡 能力値ソート用ヘルパー
 * 他プレイヤーのデータ参照時でも、MasterData (または myCurrentRecords) から生定数を直接補完する
 */
function getTopAbilitySongs(data, modKey, rawKey, count) {
    // 💡 参照用マップの構築
    const masterMap = new Map();

    // myCurrentRecords や masterDataCache から生定数をキー保持
    if (typeof myCurrentRecords !== 'undefined' && Array.isArray(myCurrentRecords)) {
        myCurrentRecords.forEach(item => {
            if (item.title && item.diff) {
                masterMap.set(`${item.title}_${item.diff}`, item[rawKey]);
            }
        });
    }

    return data
        .map(s => {
            // 補正後能力値（ソート用）
            const calcVal = parseFloat(s[modKey] || 0);

            // 1. 本人のデータから生定数を取得
            let rawVal = (s[rawKey] !== undefined && s[rawKey] !== null) ? parseFloat(s[rawKey]) : 0;

            // 2. 存在しない場合、作成したマップから純粋な生定数(rawKey)のみを取得
            if (rawVal === 0) {
                const key = `${s.title}_${s.diff}`;
                const fallbackRaw = masterMap.get(key);
                if (fallbackRaw) {
                    rawVal = parseFloat(fallbackRaw || 0);
                }
            }

            // 3. 表示用の生定数文字列を作成（0の場合は補正後値ではなく 0.0 や 譜面定数）
            const finalDisplayConst = rawVal > 0 ? rawVal.toFixed(1) : parseFloat(s.const || 0).toFixed(1);

            return {
                ...s,
                calcVal: calcVal,
                displayConst: finalDisplayConst
            };
        })
        .filter(s => s.calcVal > 0)
        .sort((a, b) => b.calcVal - a.calcVal)
        .slice(0, count);
}

/**
 * テーブル部分のHTMLを生成するヘルパー関数
 */
function buildTableHtml(songList, startRank, isRateMode, colorClass, columnHeader) {
    if (songList.length === 0) return '<div></div>';

    const isCostHeader = columnHeader !== '定数';
    const headerClass = isCostHeader ? 'cost-header' : '';
    const headerColorClass = isCostHeader ? colorClass : '';

    let html = `
        <table class="column-table">
            <colgroup>
                <col style="width: 28px;">  <!-- 順位 -->
                <col style="width: auto;">  <!-- 曲名 -->
                <col style="width: 42px;">  <!-- バッジ -->
                <col style="width: 44px;">  <!-- 動的見出し列 -->
                <col style="width: 78px;">  <!-- スコア -->
                <col style="width: 52px;">  <!-- Rating -->
            </colgroup>
            <thead>
                <tr>
                    <th style="text-align: center;">#</th>
                    <th style="text-align: left;">曲名</th>
                    <th style="text-align: center;"></th>
                    <th style="text-align: center;" class="${headerClass} ${headerColorClass}">${columnHeader}</th>
                    <th style="text-align: center;">スコア</th>
                    <th style="text-align: center;">Rating</th>
                </tr>
            </thead>
            <tbody>
    `;

    songList.forEach((s, idx) => {
        const rank = startRank + idx + 1;
        const constVal = s.displayConst || '0.0';
        const scoreVal = (parseInt(s.score, 10) || 0).toLocaleString();
        const displayVal = (s.calcVal || 0).toFixed(2);

        html += `
            <tr>
                <td style="text-align: center;">${rank}</td>
                <td class="title-col" title="${escapeHtml(s.title)}">
                    <div class="title-cell">${escapeHtml(s.title)}</div>
                </td>
                <td style="text-align: center;"><span class="diff-badge ${s.diff}">${s.diff}</span></td>
                <td style="text-align: center;">${constVal}</td>
                <td style="text-align: center;">${scoreVal}</td>
                <td class="${colorClass}" style="text-align: center;">${displayVal}</td>
            </tr>
        `;
    });

    html += `</tbody></table>`;
    return html;
}


/**
 * 選曲中の演出付きランダム選出（難易度マルチセレクト＆WE対応完全版）
 */
function pickRandomSong() {
    // 1. 各種フィルター要素の取得
    const searchInput = document.getElementById('search-input');
    const minConstSelect = document.getElementById('min-constant');
    const maxConstSelect = document.getElementById('max-constant');
    const minRateInput = document.getElementById('min-rating');
    const maxRateInput = document.getElementById('max-rating');
    const lampSelect = document.getElementById('lamp-filter');

    // Rank / スコア切り替え要素
    const filterModeSelect = document.getElementById('filter-mode');
    const rankMinSelect = document.getElementById('rank-min');
    const rankMaxSelect = document.getElementById('rank-max');
    const minScoreInput = document.getElementById('min-score');
    const maxScoreInput = document.getElementById('max-score');

    const searchText = searchInput ? searchInput.value.toLowerCase().trim() : "";
    const minConst = minConstSelect ? parseFloat(minConstSelect.value) : 0;
    const maxConst = maxConstSelect ? parseFloat(maxConstSelect.value) : 20;
    const minRate = (minRateInput && minRateInput.value !== "") ? parseFloat(minRateInput.value) : 0;
    const maxRate = (maxRateInput && maxRateInput.value !== "") ? parseFloat(maxRateInput.value) : 99.99;
    const lampValue = lampSelect ? lampSelect.value : 'all';

    // モード取得
    const filterMode = filterModeSelect ? filterModeSelect.value : 'rank';
    const rankMin = rankMinSelect ? parseFloat(rankMinSelect.value) : 0;
    const rankMax = rankMaxSelect ? parseFloat(rankMaxSelect.value) : 1010000;

    const minScoreVal = minScoreInput ? minScoreInput.value : "";
    const maxScoreVal = maxScoreInput ? maxScoreInput.value : "";
    const minScore = minScoreVal !== "" ? parseFloat(minScoreVal) : 0;
    const maxScore = maxScoreVal !== "" ? parseFloat(maxScoreVal) : 1010000;

    // トレンドスイッチ情報
    const trendSwitch = document.getElementById('trend-enable-switch');
    const isTrendEnabled = trendSwitch ? trendSwitch.checked : false;
    const activeTrends = Array.from(document.querySelectorAll('.btn-trend-filter.active')).map(btn => btn.getAttribute('data-trend'));

    // 💡【新設】現在アクティブな難易度ボタンのリストを取得
    const activeDiffs = Array.from(document.querySelectorAll('.btn-diff-filter.active')).map(btn => btn.getAttribute('data-diff'));

    // 候補（candidates）の絞り込み
    const candidates = myCurrentRecords.filter(item => {
        const title = String(item.title || "").toLowerCase();
        if (!title.includes(searchText)) return false;

        const currentRate = parseFloat(item.rating) || 0;
        if (currentRate < minRate || currentRate > maxRate) return false;

        // 💡【新設】難易度（diff）で絞り込み
        const itemDiff = String(item.diff || "").toUpperCase();
        if (!activeDiffs.includes(itemDiff)) return false;

        // 💡【修正】定数で絞り込み（★WE用のエスケープ安全弁を追加）
        const constant = parseFloat(item.const) || 0;
        const isWeExempt = (itemDiff === "WE" && activeDiffs.includes("WE"));
        if (!isWeExempt && (constant < minConst || constant > maxConst)) return false;

        // Rankかスコアモードかに応じて判定
        const tScore = parseFloat(item.score) || 0;
        if (filterMode === 'rank') {
            if (tScore < rankMin || tScore > getUpperLimit(rankMax)) return false;
        } else {
            if (tScore < minScore || tScore > maxScore) return false;
        }

        const itemLamp = item.lamp || "None";
        if (lampValue !== 'all') {
            const hasAJ = itemLamp.includes('AJ') || itemLamp.includes('JUSTICE');
            if (lampValue === 'ajc' && !(itemLamp.includes('AJC') || itemLamp.includes('JUSTICE CRITICAL'))) return false;
            if (lampValue === 'aj' && !hasAJ) return false;
            if (lampValue === 'None' && hasAJ) return false;
        }

        if (currentTypeFilter === 'old' && item.isNew) return false;
        if (currentTypeFilter === 'new' && !item.isNew) return false;

        if (isTrendEnabled) {
            const songTrend = item.mainTrend || "None";
            if (!activeTrends.includes(songTrend)) return false;
        }

        return true;
    });

    if (candidates.length === 0) {
        alert("条件に合う楽曲がリストにありません。");
        return;
    }

    // 2. 演出用のオーバーレイ画面を作成
    const overlay = document.createElement('div');
    overlay.style = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.85); z-index: 10000;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        color: white; font-family: sans-serif;
    `;
    overlay.innerHTML = `
        <div style="font-size: 1.2rem; color: #27ae60; margin-bottom: 20px; font-weight: bold;">SELECTING...</div>
        <div id="roulette-title" style="font-size: 1.8rem; font-weight: bold; text-align: center; min-height: 3em; padding: 0 20px;"></div>
        <div id="roulette-diff" style="margin-top: 10px; padding: 5px 15px; border-radius: 20px; font-weight: bold; transition: all 0.1s;"></div>
    `;
    document.body.appendChild(overlay);

    const titleEl = document.getElementById('roulette-title');
    const diffEl = document.getElementById('roulette-diff');

    // 💡【新設】難易度ごとの演出カラー設定とスタイル適用関数
    const diffColors = {
        'EXP': '#ff4d4d',
        'MAS': '#9966ff',
        'ULT': '#2b2b2b'
    };

    function applyDiffStyle(targetEl, diffStr, itemObj) {
        const dUpper = diffStr.toUpperCase();
        if (dUpper === 'WE') {
            // WEの場合は虹色の流れるグラデーション演出
            const attr = itemObj.weAttr || itemObj.attribute || "";
            targetEl.innerText = `WORLD'S END ${attr ? `【${attr}】` : ""}`;
            targetEl.style.background = 'linear-gradient(45deg, #ff3366, #ff9933, #33cc66, #3399ff, #9933ff)';
            targetEl.style.backgroundSize = '200% 200%';
            targetEl.style.animation = 'rainbowShift 3s linear infinite';
            targetEl.style.color = '#fff';
            targetEl.style.border = 'none';
        } else {
            // 通常難易度の表記とベタ塗り背景
            targetEl.innerText = diffStr;
            targetEl.style.background = diffColors[dUpper] || '#555';
            targetEl.style.backgroundSize = 'auto';
            targetEl.style.animation = 'none';
            targetEl.style.color = '#fff';
        }
    }

    let count = 0;
    const maxTicks = 20;
    const interval = setInterval(() => {
        const temp = candidates[Math.floor(Math.random() * candidates.length)];
        titleEl.innerText = temp.title;

        // 💡 演出中のスタイル適用
        applyDiffStyle(diffEl, temp.diff, temp);

        count++;
        if (count >= maxTicks) {
            clearInterval(interval);
            finishSelection();
        }
    }, 150);

    function finishSelection() {
        const picked = candidates[Math.floor(Math.random() * candidates.length)];

        const flash = document.createElement('div');
        flash.style = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: white; z-index: 10001; opacity: 1;
            transition: opacity 0.5s ease-out;
        `;
        document.body.appendChild(flash);

        titleEl.style.color = "#f1c40f";
        titleEl.style.textShadow = "0 0 15px #fff, 0 0 30px #f1c40f, 0 0 45px #f1c40f";
        titleEl.style.transform = "scale(1.2)";
        titleEl.style.transition = "all 0.5s ease-out";
        titleEl.innerText = picked.title;

        // 💡 決定曲へのスタイル適用
        applyDiffStyle(diffEl, picked.diff, picked);

        if (picked.diff.toUpperCase() === 'WE') {
            diffEl.style.boxShadow = `0 0 25px rgba(153, 51, 255, 0.7)`;
        } else {
            diffEl.style.boxShadow = `0 0 20px ${diffEl.style.backgroundColor}`;
        }

        requestAnimationFrame(() => {
            flash.style.opacity = "0";
            setTimeout(() => {
                if (document.body.contains(flash)) document.body.removeChild(flash);
            }, 500);
        });

        setTimeout(() => {
            if (document.body.contains(overlay)) {
                document.body.removeChild(overlay);
            }

            const rows = document.querySelectorAll('#score-body tr');
            let targetRow = null;
            for (let tr of rows) {
                const titleCell = tr.querySelector('.title-cell');
                const rowTitle = titleCell ? titleCell.innerText.replace("NEW", "").trim() : "";

                // 💡 クラス名による判定も小文字統一で確実に行う
                if (rowTitle === picked.title && tr.classList.contains(picked.diff.toLowerCase())) {
                    targetRow = tr;
                    break;
                }
            }

            if (targetRow) {
                targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setTimeout(() => {
                    targetRow.style.transition = "background 0.5s";
                    const originalBg = targetRow.style.background;
                    targetRow.style.background = "rgba(241, 196, 15, 0.5)";
                    loadRanking(picked.title, picked.diff, picked.const);
                    setTimeout(() => { targetRow.style.background = originalBg; }, 2000);
                }, 2000);
            } else {
                loadRanking(picked.title, picked.diff, picked.const);
            }
        }, 4500);
    }
}

// 💡 軽量化のためのグローバルキャッシュ変数（コードの最上部等に自動配置されます）
if (!window.rankingCache) window.rankingCache = {};

/**
 * 💡 確定決定版：特定の曲のランキングを取得して表示（超軽量キャッシュ＆裏動線完全非同期版）
 */
async function loadRanking(title, diff, songConst) {
    const modal = document.getElementById('ranking-modal');
    const rankingBody = document.getElementById('ranking-body');
    const titleContainer = document.getElementById('ranking-title-container');

    const originalDiff = diff;
    let cleanDiff = diff ? String(diff).trim().toUpperCase() : "";
    if (cleanDiff.includes("WORLD") || cleanDiff === "WE") cleanDiff = "WE";
    const isWE = (cleanDiff === "WE");

    const controls = document.getElementById('ranking-controls');
    const statsControlArea = document.getElementById('stats-control-area');
    const radarContainer = document.getElementById('radar-chart-container');
    const videoSection = document.getElementById("ranking-video-section");

    if (controls) controls.style.display = 'block';
    if (statsControlArea) statsControlArea.style.display = 'none';
    if (videoSection) videoSection.style.display = 'block';

    // 初期状態ではレーダーチャートエリアを一旦隠す（データ有無判定用）
    if (radarContainer) radarContainer.style.display = 'none';

    const modalTableHead = document.querySelector('#ranking-modal table thead tr');
    if (modalTableHead) {
        modalTableHead.innerHTML = `
            <th>順位</th>
            <th>プレイヤー</th>
            <th>スコア</th>
            <th>ランプ</th>
        `;
    }

    selectedPlayer = null;
    lastRankingData = [];

    const canvas = document.getElementById('ranking-canvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.style.display = 'block';
    }

    if (radarChartInstance) {
        radarChartInstance.destroy();
        radarChartInstance = null;
    }

    if (typeof updateRankingVideoSection === "function") {
        updateRankingVideoSection(title, originalDiff);
    }

    const displayDiff = isWE ? "WORLD'S END" : cleanDiff;
    const escapedTitle = title.replace(/'/g, "\\'");
    const escapedDiff = originalDiff ? originalDiff.replace(/'/g, "\\'") : "";

    titleContainer.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 15px; flex-wrap: wrap;">
        <span style="font-size: 20px; font-weight: bold;">${title}</span>
        <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
            <button id="btn-toggle-radar" class="reset-btn" style="display: none; background: #8e44ad; color: white; border: none; padding: 4px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; font-weight: bold;">
                傾向グラフ非表示
            </button>
            <button id="btn-ranking-showall" class="reset-btn" style="display: none;">
                全員を再表示
            </button>
            <button class="btn-ranking-refresh" 
                onclick="refreshCurrentRanking('${escapedTitle}', '${escapedDiff}', '${songConst}')"
                style="background: #34495e; color: white; border: none; padding: 4px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; font-weight: bold; display: flex; align-items: center; gap: 4px; transition: 0.2s;"
                onmouseover="this.style.background='#2c3e50'" 
                onmouseout="this.style.background='#34495e'">
                この楽曲のデータを更新
            </button>
        </div>
    </div>
    <span class="title-sub-info" style="display: block; margin-top: 4px;"></span>
`.trim();

    const showAllBtn = document.getElementById('btn-ranking-showall');
    if (showAllBtn) {
        showAllBtn.onclick = function () {
            document.querySelectorAll('#ranking-body tr').forEach(tr => tr.style.display = '');
            this.style.display = 'none';
            if (typeof drawRankingChart === "function") drawRankingChart();
        };
    }

    const cacheKey = `${title}_${cleanDiff}`.toLowerCase();
    const now = Date.now();
    const CACHE_TIMEOUT = 5 * 60 * 1000;

    if (window.rankingCache && window.rankingCache[cacheKey] && (now - window.rankingCache[cacheKey].timestamp < CACHE_TIMEOUT)) {
        console.log("⚡ キャッシュからランキングを高速描画します:", title);
        const cachedResult = window.rankingCache[cacheKey].result;

        renderRankingData(cachedResult, title, cleanDiff, songConst, originalDiff, isWE, displayDiff);
        modal.style.display = "flex";
        triggerBackgroundVideoFetch(title, originalDiff, isWE);
        return;
    }

    rankingBody.innerHTML = "<tr><td colspan='4'>読み込み中...</td></tr>";
    modal.style.display = "flex";

    const rankingPromise = fetch(GAS_URL, {
        method: "POST",
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
            mode: "get_ranking",
            title: title,
            diff: cleanDiff,
            const: songConst
        })
    }).then(res => res.json());

    triggerBackgroundVideoFetch(title, originalDiff, isWE);

    try {
        console.log("送るデータ:", { title, diff: cleanDiff, const: songConst });
        const result = await rankingPromise;

        if (result.status === "success" && result.data) {
            if (!window.rankingCache) window.rankingCache = {};
            window.rankingCache[cacheKey] = {
                timestamp: now,
                result: result
            };
            renderRankingData(result, title, cleanDiff, songConst, originalDiff, isWE, displayDiff);
        } else {
            rankingBody.innerHTML = "<tr><td colspan='4'>データがありません</td></tr>";
            if (!isWE && typeof drawRadarChart === "function") drawRadarChart(null, songConst);
        }
    } catch (e) {
        console.error(e);
        rankingBody.innerHTML = "<tr><td colspan='4'>エラーが発生しました</td></tr>";
        if (!isWE && typeof drawRadarChart === "function") drawRadarChart(null, songConst);
    }
}

/**
 * 💡【補助関数A】ランキングデータを実際にHTMLやチャートに描画する処理（共通化）
 */
function renderRankingData(result, title, cleanDiff, songConst, originalDiff, isWE, displayDiff) {
    const rankingBody = document.getElementById('ranking-body');
    const titleContainer = document.getElementById('ranking-title-container');

    const songNotes = parseInt((result.songProps ? result.songProps.notes : 0) || (result.data && result.data[0] ? result.data[0].notes : 0) || 0, 10);

    rankingBody.innerHTML = "";
    result.data.forEach((row, index) => {
        const tr = document.createElement('tr');
        tr.style.cursor = "pointer";
        tr.dataset.playerName = row.playerName;

        tr.onclick = function (e) {
            if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
            this.style.display = 'none';

            if (typeof drawRankingChart === "function") {
                drawRankingChart();
            }
        };

        const myName = localStorage.getItem('chunirec_player_name');
        if (row.playerName === myName) tr.classList.add('my-rank');

        let scoreVal = row.score;
        const currentScore = parseInt(scoreVal || 0, 10);
        const displayScore = (typeof scoreVal === 'number') ? scoreVal.toLocaleString() : scoreVal;

        const lampText = row.lamp || "";
        let badgeClass = "";
        if (lampText.includes("AJC")) badgeClass = "ajc-badge";
        else if (lampText.includes("AJ")) badgeClass = "aj-badge";
        else if (lampText.includes("FC")) badgeClass = "fc-badge";

        // 💡 ランプおよび各種内訳（AJ:橙-N / FC:緑-1 / ランプなし:灰-1）の描画ロジック
        let lampHtml = "-";
        const totalNotes = parseInt(row.notes || songNotes || 0, 10);

        if (totalNotes > 0 && currentScore > 0 && currentScore < 1010000) {
            const jTotal = ((1010000 - currentScore) * totalNotes) / 10000;

            if (lampText.includes("AJ")) {
                // 🟡 1. AJ時: JUSTICE数を確定表示
                lampHtml = `<span class="${badgeClass}">${lampText}</span>`;
                const jCount = Math.round(jTotal);
                if (!lampText.includes("AJC") && jCount > 0) {
                    lampHtml += `<div class="justice-count" style="font-size: 0.75rem; color: #ff9500; font-weight: bold; margin-top: 2px;">-${jCount}</div>`;
                }
            } else if (lampText.includes("FC")) {
                // 🟢 2. FC時: ATTACK 1個 確定（51 <= jTotal <= 101 / JUSTICE 0〜50個）
                lampHtml = `<span class="${badgeClass}">${lampText}</span>`;
                if (jTotal >= 51 && jTotal <= 101) {
                    lampHtml += `<div class="attack-count" style="font-size: 0.75rem; color: #2ecc71; font-weight: bold; margin-top: 2px;">-1</div>`;
                }
            } else {
                // ⚪ 3. ランプなし時: MISS 1個 / ATTACK 0個 確定（101 <= jTotal <= 151 / JUSTICE 0〜50個）
                if (jTotal >= 101 && jTotal <= 151) {
                    lampHtml = `<span style="color: #888888; font-weight: bold; font-size: 0.85rem;">-1</span>`;
                } else {
                    lampHtml = "-";
                }
            }
        } else if (lampText) {
            lampHtml = `<span class="${badgeClass}">${lampText}</span>`;
        }

        tr.innerHTML = `
            <td class="rank-cell">${index + 1}</td>
            <td>${row.playerName}</td>
            <td>${displayScore}</td> 
            <td class="lamp-cell" style="text-align: center;">
             ${lampHtml}
            </td>
        `;
        rankingBody.appendChild(tr);
    });

    if (typeof drawRankingChart === "function") {
        drawRankingChart(result.data);
    }

    if (!isWE && typeof drawRadarChart === "function") {
        const latestConst = (result.songProps && result.songProps.constant) ? result.songProps.constant : songConst;
        drawRadarChart(result.songProps, latestConst);
    }

    if (typeof updateRankingVideoSection === "function") {
        const finalTitle = (result.songProps && result.songProps.title) ? result.songProps.title : title;
        updateRankingVideoSection(finalTitle, isWE ? "WE" : originalDiff);
    }

    const subInfoContainer = titleContainer.querySelector('.title-sub-info');
    if (subInfoContainer) {
        const props = result.songProps || {};
        const colorMap = { 'POWER': '#36a2eb', 'NOTES': '#d7a62e', 'CHUNI': '#239898', 'TRICKY': '#9966ff' };

        // 💡 ノーツ数の取得（CSSクラス `.title-sub-info` のフォントサイズ・装飾に同調）
        const notesCount = parseInt(props.notes || songNotes || 0, 10);
        const notesHtml = notesCount > 0 ? `<span class="notes-count-txt"> / ${notesCount.toLocaleString()} notes</span>` : "";

        if (isWE) {
            const attr = props.weAttr || props.attribute || props.attr || "";
            subInfoContainer.innerHTML = `<span class="diff-const-txt">WORLD'S END ${attr ? `【${attr}】` : ""}</span>${notesHtml}`;
        } else {
            const latestConst = props.constant ? result.songProps.constant : songConst;
            const finalConst = latestConst ? parseFloat(latestConst).toFixed(1) : "-";

            let subHtml = `<span class="diff-const-txt">${displayDiff} ${finalConst}</span><span id="trend-container"></span>${notesHtml}`;
            subInfoContainer.innerHTML = subHtml;

            const trendContainer = document.getElementById('trend-container');
            if (trendContainer) {
                let trendHtml = "";
                if (props.mainTrend && props.mainTrend !== "None") {
                    const mainColor = colorMap[props.mainTrend] || "#888888";
                    trendHtml += `<span style="color: ${mainColor}; margin-left: 8px;">${props.mainTrend}</span>`;

                    if (props.subTrend && props.subTrend !== "None" && props.subTrend !== props.mainTrend) {
                        const subColor = colorMap[props.subTrend] || "#888888";
                        trendHtml += ` <span>/</span> <span style="color: ${subColor};">${props.subTrend}</span>`;
                    }
                }
                trendContainer.innerHTML = trendHtml;
            }
        }
    }
}

/**
 * 💡【修正版】動画データを裏側（完全非同期）でロードし、終わったら確実に動画セクションを再描画する
 */
function triggerBackgroundVideoFetch(title, originalDiff, isWE) {
    // 既にデータが存在する場合は何もしない
    if (window.liveSupplies && window.liveSupplies.length > 0) {
        return;
    }

    fetch(GAS_URL, {
        method: "POST",
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ mode: "get_video_history" })
    })
        .then(res => res.json())
        .then(videoResult => {
            if (videoResult && videoResult.status === "success" && videoResult.data) {
                const actualData = videoResult.data.supplies ? videoResult.data : (videoResult.data || videoResult);

                // 💡 windowオブジェクト（グローバル）に対して確実にデータを代入
                window.liveRequests = actualData.requests || [];
                window.liveSupplies = actualData.supplies || [];

                console.log("バックグラウンドでの動画データ自動救済完了:", window.liveSupplies);

                // 💡 データの代入がブラウザに完全に認識された直後に再描画を走らせる
                setTimeout(() => {
                    if (typeof updateRankingVideoSection === "function") {
                        updateRankingVideoSection(title, isWE ? "WE" : originalDiff);
                    }
                }, 10);
            }
        })
        .catch(e => {
            console.error("動画データ裏系統取得エラー:", e);
            // エラー時も「読み込み中」のまま固まらないよう、空データ扱いで描画を解除する
            if (typeof updateRankingVideoSection === "function") {
                updateRankingVideoSection(title, isWE ? "WE" : originalDiff, []);
            }
        });
}

/**
 * 🔄 現在表示している曲のランキングキャッシュを破棄して、強制的にGASから再取得する
 */
function refreshCurrentRanking(title, diff, songConst) {
    let cleanDiff = diff ? String(diff).trim().toUpperCase() : "";
    if (cleanDiff.includes("WORLD") || cleanDiff === "WE") cleanDiff = "WE";

    // 💡 この曲専用のキャッシュキーを生成
    const cacheKey = `${title}_${cleanDiff}`.toLowerCase();

    // 💡 キャッシュが存在すれば削除（これで次回 loadRanking 実行時に必ずGASへ通信が走る）
    if (window.rankingCache && window.rankingCache[cacheKey]) {
        delete window.rankingCache[cacheKey];
        console.log(`♻️ キャッシュを解放しました: ${cacheKey}`);
    }

    // 💡 リクエストと動画のグローバルデータも空にして、裏読みを強制リフレッシュさせる
    window.liveSupplies = [];
    window.liveRequests = [];

    // 再度ランキングを読み込む
    loadRanking(title, diff, songConst);
}

// モーダルを閉じる処理（window.onload または initFilters 内に追加）
document.querySelector('.close-ranking')?.addEventListener('click', () => {
    document.getElementById('ranking-modal').style.display = "none";
    // 💡 閉じた時もチャートをクリアしてメモリを解放
    if (radarChartInstance) {
        radarChartInstance.destroy();
        radarChartInstance = null;
    }
});

window.onclick = (event) => {
    const modal = document.getElementById('ranking-modal');
    if (event.target == modal) {
        modal.style.display = "none";
        // 💡 閉じた時もチャートをクリアしてメモリを解放
        if (radarChartInstance) {
            radarChartInstance.destroy();
            radarChartInstance = null;
        }
    }
};


// 状態保持用の変数
let selectedPlayer = null;
let lastRankingData = []; // 再描画用にデータを保持
let radarChartInstance = null; // 💡 追加：レーダーチャートのインスタンス保持用

/**
 * 💡 完全修正版：レーダーチャートを描画 ＆ トグル非表示対応関数
 */
function drawRadarChart(props, songConst) {
    const canvas = document.getElementById('radar-canvas');
    const container = document.getElementById('radar-chart-container');
    const toggleBtn = document.getElementById('btn-toggle-radar');

    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');

    if (radarChartInstance) {
        radarChartInstance.destroy();
        radarChartInstance = null;
    }

    // 譜面傾向データが存在しない（または全項目0）場合：コンテナとボタンを隠してスペースを完全に詰める
    const hasData = props && (props.tairyoku || props.kenban || props.chuni || props.kuse);
    if (!hasData) {
        container.style.display = 'none';
        if (toggleBtn) toggleBtn.style.display = 'none';
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
    }

    // データが存在する場合：コンテナを表示
    container.style.display = 'block';

    // トグルボタンをセットアップ（表示/非表示の切り替え＆文字変更）
    if (toggleBtn) {
        toggleBtn.style.display = 'inline-block';
        toggleBtn.innerText = '📊 傾向グラフ非表示';

        toggleBtn.onclick = function () {
            if (container.style.display === 'none') {
                container.style.display = 'block';
                this.innerText = '📊 傾向グラフ非表示';
            } else {
                container.style.display = 'none';
                this.innerText = '📊 傾向グラフ表示';
            }
        };
    }

    let currentConst = parseFloat(songConst);
    if (isNaN(currentConst)) currentConst = 15.0;
    currentConst = Math.round(currentConst * 10) / 10;

    const diffDiff = Math.round((currentConst - 15.0) * 10);
    let maxLimit = 16 + (diffDiff * 4);
    if (maxLimit < 16) maxLimit = 16;
    const stepInterval = maxLimit / 4;

    const dataValues = [
        props.tairyoku || 0,
        props.kenban || 0,
        props.chuni || 0,
        props.kuse || 0
    ];

    const chartBgColor = 'rgba(255, 71, 87, 0.18)';
    const chartBorderColor = 'rgba(255, 71, 87, 1)';
    const pointColor = 'rgba(255, 71, 87, 1)';

    radarChartInstance = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: ['POWER', 'NOTES', 'CHUNI', 'TRICKY'],
            datasets: [{
                label: '譜面傾向度',
                data: dataValues,
                backgroundColor: chartBgColor,
                borderColor: chartBorderColor,
                borderWidth: 2.5,
                pointBackgroundColor: pointColor,
                pointBorderColor: '#fff',
                pointBorderWidth: 1.5,
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: function (context) {
                            const labelMap = {
                                'POWER': '体力要求度',
                                'NOTES': '鍵盤力要求度',
                                'CHUNI': 'チュウニ力要求度',
                                'TRICKY': '癖度'
                            };
                            return labelMap[context[0].label] || context[0].label;
                        },
                        label: function (context) {
                            return ` 数値: ${context.raw.toFixed(1)}`;
                        }
                    }
                }
            },
            scales: {
                r: {
                    angleLines: { display: true, color: 'rgba(0, 0, 0, 0.1)' },
                    grid: { color: 'rgba(0, 0, 0, 0.08)' },
                    min: 0,
                    max: maxLimit,
                    ticks: {
                        stepSize: stepInterval,
                        maxTicksLimit: 5,
                        font: { size: 9 },
                        backdropColor: 'transparent'
                    },
                    pointLabels: {
                        font: {
                            size: 13,
                            weight: '900',
                            family: 'sans-serif',
                            lineHeight: 1.4
                        },
                        textAlign: 'center',
                        callback: function (label, index) {
                            let val = 0;
                            if (label === 'POWER') val = props.tairyoku || 0;
                            if (label === 'NOTES') val = props.kenban || 0;
                            if (label === 'CHUNI') val = props.chuni || 0;
                            if (label === 'TRICKY') val = props.kuse || 0;
                            return [label, `${val.toFixed(2)}`];
                        },
                        color: function (context) {
                            const colors = [
                                'rgba(54, 162, 235, 1)',
                                'rgba(215, 166, 46, 1)',
                                'rgba(35, 152, 152, 1)',
                                'rgba(153, 102, 255, 1)'
                            ];
                            return colors[context.index] || '#333';
                        }
                    }
                }
            }
        }
    });
}

function drawRankingChart(data) {
    if (data) lastRankingData = data; // データをキャッシュ
    const canvas = document.getElementById('ranking-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const myName = localStorage.getItem('chunirec_player_name');

    // 全ての行を取得
    const allRows = Array.from(document.querySelectorAll('#ranking-body tr'));

    // ★ 表で非表示（display: none）になっていないプレイヤーだけを抽出
    const visibleNames = allRows
        .filter(tr => tr.style.display !== 'none')
        .map(tr => tr.dataset.playerName);

    // 💡 非表示にされている人が1人でもいるかチェックして「全員を再表示」ボタンの表示を切り替え
    const showAllBtn = document.getElementById('btn-ranking-showall');
    if (showAllBtn) {
        const hasHiddenPlayer = allRows.some(tr => tr.style.display === 'none');
        showAllBtn.style.display = hasHiddenPlayer ? 'inline-block' : 'none';
    }

    // 有効なスコアを抽出しソート
    const validScores = lastRankingData
        .filter(d => typeof d.score === 'number' && d.score >= 0)
        .filter(d => visibleNames.includes(d.playerName)) // ★ 表示中の人のみ描画
        .map(d => ({ name: d.playerName, score: d.score }))
        .sort((a, b) => a.score - b.score);

    if (validScores.length === 0) return;

    // 定数
    const maxScore = MAX_SCORE;
    const minScore = currentMinScore; // 固定値から変数へ
    const range = maxScore - minScore;
    const padding = 80;
    const chartWidth = canvas.width - (padding * 2);
    const centerY = 100;

    chartClickAreas = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // --- ★修正ポイント：目盛りの動的表示 ---
    const allTicks = [
        { s: 1000000, sub: "SS" },
        { s: 1005000, sub: "SS+" },
        { s: 1007500, sub: "SSS" },
        { s: 1009000, sub: "SSS+" },
        { s: 1010000, sub: "AJC" }
    ];

    // 現在の minScore 以上の目盛りだけを表示する
    const visibleTicks = allTicks.filter(t => t.s >= minScore);

    visibleTicks.forEach(tick => {
        const x = padding + ((tick.s - minScore) / range) * chartWidth;
        ctx.strokeStyle = '#f5f5f5';
        ctx.beginPath(); ctx.moveTo(x, 20); ctx.lineTo(x, 135); ctx.stroke();
        ctx.fillStyle = "#525151";
        ctx.font = "bold 24px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(tick.sub, x, 145);
    });

    // 2. 数直線
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(padding, centerY); ctx.lineTo(canvas.width - padding, centerY); ctx.stroke();

    // 3. プレイヤー描画
    validScores.forEach((player) => {
        // 表示範囲外のプレイヤーは描画しない（または左端に固めるなら Math.max）
        if (player.score < minScore) return;

        const x = padding + ((player.score - minScore) / range) * chartWidth;
        const isMe = (player.name === myName);
        const isSelected = (selectedPlayer && selectedPlayer.name === player.name);
        const radius = (isMe || isSelected) ? 10 : 7;

        chartClickAreas.push({ x, y: centerY, radius: radius + 8, ...player });

        ctx.fillStyle = isMe ? '#ff4757' : (isSelected ? '#2ed573' : 'rgba(46, 213, 115, 0.5)');
        ctx.beginPath(); ctx.arc(x, centerY, radius, 0, Math.PI * 2); ctx.fill();

        if (isMe || isSelected) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 3;
            ctx.stroke();
        }

        ctx.textAlign = "center";
        if (isMe) {
            ctx.fillStyle = "#ff4757";
            ctx.font = "bold 30px sans-serif";
            ctx.fillText(player.name, x, centerY - 30);
        } else if (isSelected) {
            ctx.fillStyle = "#2ecc71";
            ctx.font = "bold 24px sans-serif";
            ctx.fillText(player.name, x, centerY - 65);
            ctx.strokeStyle = "#2ecc71";
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x, centerY - 15); ctx.lineTo(x, centerY - 30); ctx.stroke();
        }
    });

    // クリックイベント登録（重複登録防止）
    if (!canvas.dataset.hasClickEvent) {
        canvas.addEventListener('mousedown', (e) => { // clickより反応が良いmousedown推奨
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            const clickX = (e.clientX - rect.left) * scaleX;
            const clickY = (e.clientY - rect.top) * scaleY;

            const target = chartClickAreas.find(area => {
                const dx = clickX - area.x;
                const dy = clickY - area.y;
                return Math.sqrt(dx * dx + dy * dy) < area.radius;
            });

            if (target) {
                if (selectedPlayer && selectedPlayer.name === target.name) {
                    selectedPlayer = null;
                } else {
                    selectedPlayer = target;
                }
            } else {
                selectedPlayer = null;
            }

            // 表のハイライトを更新
            updateTableHighlight();

            drawRankingChart(); // 再描画
        });
        canvas.dataset.hasClickEvent = "true";
    }
}

/**
 * グラフの表示最小スコアを更新して再描画
 */
function updateRankingRange(minScore) {
    currentMinScore = minScore;

    // 全ボタンから active を消し、クリックされたものに付ける
    document.querySelectorAll('.range-btn').forEach(btn => {
        // data-min 属性が数値として一致するかで判定
        if (parseInt(btn.dataset.min) === minScore) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    drawRankingChart(); // グラフを再描画
}


/**
 * selectedPlayer の状態に合わせて表のハイライトを更新する
 */
function updateTableHighlight() {
    const rows = document.querySelectorAll('#ranking-body tr');
    rows.forEach(row => {
        row.classList.remove('selected-rank');
        const nameCell = row.cells[1];
        if (selectedPlayer && nameCell && nameCell.innerText === selectedPlayer.name) {
            row.classList.add('selected-rank');
            row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });
}

/**
 * 統計情報を取得して表示
 */
async function fetchStats(mode) {
    console.log("--- fetchStats Start --- Mode:", mode);

    const btnP = document.getElementById('stats-player-btn');
    const btnS = document.getElementById('stats-song-btn');
    const currentBtn = (mode === 'player') ? btnP : btnS;

    if (currentBtn) {
        currentBtn.disabled = true;
        currentBtn.innerText = "集計中...";
    }

    const typeFilter = document.querySelector('.btn-filter.active')?.getAttribute('data-value') || 'all';

    // 💡 マルチ選択ボタンから、現在 active になっている難易度を配列としてすべて取得
    const activeDiffs = Array.from(document.querySelectorAll('.btn-diff-filter.active'))
        .map(btn => btn.getAttribute('data-diff'));

    const minC = document.getElementById('min-constant')?.value || "0";
    const maxC = document.getElementById('max-constant')?.value || "16.0";
    const minRate = document.getElementById('min-rating')?.value || "0";
    const maxRate = document.getElementById('max-rating')?.value || "21.0";
    const lmp = document.getElementById('lamp-filter')?.value || 'all';

    const filterMode = document.getElementById('filter-mode')?.value || 'rank';
    let rMin = "0";
    let rMax = "1010000";

    if (filterMode === 'rank') {
        rMin = document.getElementById('rank-min')?.value || "0";
        rMax = document.getElementById('rank-max')?.value || "1010000";
    } else {
        const minScoreInput = document.getElementById('min-score');
        const maxScoreInput = document.getElementById('max-score');
        rMin = (minScoreInput && minScoreInput.value !== "") ? minScoreInput.value : "0";
        rMax = (maxScoreInput && maxScoreInput.value !== "") ? maxScoreInput.value : "1010000";
    }

    // 傾向フィルターの選択状態を取得
    const trendSwitch = document.getElementById('trend-enable-switch');
    const isTrendEnabled = trendSwitch ? trendSwitch.checked : false;
    const activeTrends = isTrendEnabled
        ? Array.from(document.querySelectorAll('.btn-trend-filter.active')).map(btn => btn.getAttribute('data-trend'))
        : [];

    const requestParams = {
        mode: "get_stats",
        filterMode: filterMode,
        diffFilter: activeDiffs,
        minConst: minC,
        maxConst: maxC,
        minRate: minRate,
        maxRate: maxRate,
        rankMin: rMin,
        rankMax: rMax,
        lampFilter: lmp,
        typeFilter: typeFilter,
        isTrendEnabled: isTrendEnabled,
        activeTrends: activeTrends
    };

    try {
        const response = await fetch(GAS_URL, {
            method: "POST",
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(requestParams)
        });
        const result = await response.json();

        if (result.status === "success") {
            console.log("GASデータ受信成功", result.data);

            lastStatsResponse = result.data;

            const controls = document.getElementById('ranking-controls');
            if (controls) controls.style.display = 'none';

            // 💡【追加】手元動画セクションを非表示にする
            const videoSection = document.getElementById("ranking-video-section");
            if (videoSection) videoSection.style.display = "none";

            const statsControlArea = document.getElementById('stats-control-area');
            if (statsControlArea) statsControlArea.style.display = 'block';

            const radarContainer = document.getElementById('radar-chart-container');
            if (radarContainer) radarContainer.style.display = 'none';

            currentStatsData = (mode === 'song') ? result.data.songRanking : result.data.playerRanking;
            currentStatsMode = mode;
            currentDisplayType = 'count';
            currentDenominator = (mode === 'song') ? result.data.totalUsers : result.data.theoryCount;

            const modal = document.getElementById('ranking-modal');

            displayStatsRanking();

            modal.style.display = "flex";
            console.log("モーダル表示完了");

        } else {
            alert("エラー: " + result.message);
        }
    } catch (e) {
        console.error("システムエラー:", e);
        alert("通信に失敗しました。");
    } finally {
        if (currentBtn) {
            currentBtn.disabled = false;
            currentBtn.innerText = (mode === 'player') ? "統計 (個人別)" : "統計 (楽曲別)";
        }
    }
}

/**
 * 統計ランキングの表示描画（WEカットライン変更同期 ＆ ソート安全版 ＆ WEバッジ非表示版）
 */
function displayStatsRanking() {
    const tbody = document.getElementById('ranking-body');
    const modal = document.getElementById('ranking-modal');
    if (!tbody || !currentStatsData) return;

    tbody.innerHTML = "";

    const statsData = [...currentStatsData];
    if (currentDisplayType === 'avg') {
        // 💡 スコアが入っていない（0または不十分な）曲を確実に下位へ落とすソート
        statsData.sort((a, b) => {
            const scoreA = a.avgScore || 0;
            const scoreB = b.avgScore || 0;
            return scoreB - scoreA;
        });
    } else {
        statsData.sort((a, b) => b.count - a.count);
    }

    const thead = modal.querySelector('table thead tr');
    if (thead) {
        const nameLabel = currentStatsMode === 'song' ? '楽曲名' : 'プレイヤー';

        if (currentDisplayType === 'avg') {
            const col4Label = currentStatsMode === 'song' ? '集計対象人数' : '集計対象曲数';
            thead.innerHTML = `
                <th>順位</th>
                <th>${nameLabel}</th>
                <th style="text-align:center;">平均スコア</th>
                <th style="text-align:center;">${col4Label}</th>
            `;
        } else {
            const col3Label = currentStatsMode === 'song' ? '達成者数' : '達成曲数';
            thead.innerHTML = `
                <th>順位</th>
                <th>${nameLabel}</th>
                <th style="text-align:right;">${col3Label}</th>
                <th style="text-align:center;">達成率</th>
            `;
        }
    }

    // 🎨 各難易度に対応するカラーマップ（EXP, MAS, ULT のみ使用）
    const diffColors = {
        'EXP': { bg: '#ff4c4c', text: '#ffffff' }, // 赤
        'MAS': { bg: '#aa33ff', text: '#ffffff' }, // 紫
        'ULT': { bg: '#222222', text: '#ffcc00' }  // 黒・金文字
    };

    statsData.forEach((row, index) => {
        const displayName = (currentStatsMode === 'song') ? (row.title || "不明") : (row.playerName || "不明");
        const unit = (currentStatsMode === 'song') ? "人" : "曲";
        const tr = document.createElement('tr');

        let col3, col4;
        if (currentDisplayType === 'avg') {
            const avgVal = (row.avgScore && row.avgScore > 0) ? row.avgScore.toLocaleString() : "---";
            let totalCount = (currentStatsMode === 'song') ? (row.totalCountAll || 0) : (row.allPlayCount || 0);

            col3 = `<td style="text-align:center; font-weight:bold; color: #2e7df0;">${avgVal}</td>`;
            col4 = `<td style="text-align:center;">${totalCount}<span style="font-size:10px;"> ${unit}</span></td>`;
        } else {
            const rateStr = currentDenominator > 0 ? ((row.count / currentDenominator) * 100).toFixed(1) + "%" : "-";
            col3 = `<td style="text-align:right; font-weight:bold;">${row.count} ${unit}</td>`;
            col4 = `<td style="text-align:center; color: #f02e2e;">${rateStr}</td>`;
        }

        // 🎨【重要修正】WEの場合はバッジを表示せず、EXP/MAS/ULTの時だけ着色バッジを生成
        let diffBadgeHtml = "";
        if (currentStatsMode === 'song' && row.diff) {
            const rawDiff = String(row.diff).toUpperCase();
            const isWE = (rawDiff === "WE" || rawDiff.includes("WORLD") || rawDiff.includes("END"));

            if (!isWE) {
                const colors = diffColors[rawDiff] || { bg: '#718093', text: '#ffffff' };
                diffBadgeHtml = `<span style="background: ${colors.bg}; color: ${colors.text}; font-size: 10px; padding: 2px 5px; border-radius: 3px; margin-left: 6px; font-weight: bold; display: inline-block; vertical-align: middle; box-shadow: 0 1px 2px rgba(0,0,0,0.2);">${rawDiff}</span>`;
            }
        }

        tr.innerHTML = `
            <td class="rank-cell" style="text-align:center;">${index + 1}</td>
            <td style="text-align:left;">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px;" title="${displayName}">${displayName}</span>
                    ${diffBadgeHtml}
                </div>
            </td>
            ${col3}
            ${col4}
        `;

        tr.style.cursor = "pointer";

        if (currentStatsMode === 'song') {
            tr.onclick = () => {
                if (row.diff && (String(row.diff).toUpperCase() === "WE" || String(row.diff).includes("WORLD"))) {
                    row.diff = "WE";
                }
                showSubModal(row);
                const videoSection = document.getElementById("ranking-video-section");
                if (videoSection) videoSection.style.display = "none";
            };
        } else {
            tr.onclick = () => fetchAndShowPlayerDetail(row.playerName);
        }

        tbody.appendChild(tr);
    });

    renderSwitchButton();
    updateStatsTitle();
}

/**
 * 切り替えボタンと閉じるボタンを操作エリアに設置
 */
function renderSwitchButton() {
    const container = document.getElementById('stats-control-area');
    if (!container) return;

    let btnGroup = document.getElementById('stats-btn-group');
    if (!btnGroup) {
        btnGroup = document.createElement('div');
        btnGroup.id = 'stats-btn-group';
        btnGroup.style.display = 'flex';
        btnGroup.style.justifyContent = 'center';
        btnGroup.style.gap = '10px';
        btnGroup.style.marginTop = '10px';
        container.appendChild(btnGroup);
    }

    let switchBtn = document.getElementById('stats-switch-btn');
    if (!switchBtn) {
        switchBtn = document.createElement('button');
        switchBtn.id = 'stats-switch-btn';
        switchBtn.className = 'switch-mode-btn';
        btnGroup.appendChild(switchBtn);
    }
    switchBtn.innerText = (currentDisplayType === 'count') ? "平均スコア順に切替" : "達成数順に切替";
    switchBtn.onclick = () => {
        currentDisplayType = (currentDisplayType === 'count') ? 'avg' : 'count';
        displayStatsRanking();
    };

    let closeBtn = document.getElementById('stats-top-close-btn');
    if (!closeBtn) {
        closeBtn = document.createElement('button');
        closeBtn.id = 'stats-top-close-btn';
        closeBtn.className = 'modal-close-btn';
        closeBtn.innerText = "閉じる";
        closeBtn.onclick = () => {
            document.getElementById('ranking-modal').style.display = 'none';
        };
        btnGroup.appendChild(closeBtn);
    }
}

/**
 * 💡 統計モーダルのタイトル更新（WEレインボーバッジ ＆ 定数非表示版）
 */
function updateStatsTitle() {
    const titleContainer = document.getElementById('ranking-title-container');
    if (!titleContainer) return;

    const typeFilter = document.querySelector('.btn-filter.active')?.getAttribute('data-value') || 'all';
    const minC = document.getElementById('min-constant')?.value || "0";
    const maxC = document.getElementById('max-constant')?.value || "16.0";
    const minRate = document.getElementById('min-rating')?.value || "0";
    const maxRate = document.getElementById('max-rating')?.value || "21.0";
    const lmp = document.getElementById('lamp-filter')?.value || 'all';
    const filterMode = document.getElementById('filter-mode')?.value || 'rank';

    const typeLabel = typeFilter === 'new' ? '新曲' : typeFilter === 'old' ? '旧曲' : '全曲';
    const unit = (currentStatsMode === 'song') ? "人" : "曲";

    let mainTitle = "";

    if (currentStatsMode === 'song') {
        const modeLabel = (currentDisplayType === 'avg') ? "楽曲別 平均スコア" : "楽曲別 達成人数";
        mainTitle = `<span class="main-title-text">全曲 ${modeLabel} (対象: ${currentDenominator}${unit})</span>`;
    } else {
        const modeLabel = (currentDisplayType === 'avg') ? "個人別 平均スコア" : "個人別 達成楽曲数";
        mainTitle = `<span class="main-title-text">${typeLabel} ${modeLabel} (対象: ${currentDenominator}${unit})</span>`;
    }

    const lampLabel = (lmp === 'all') ? 'すべて' : lmp.toUpperCase();

    // 💡 現在選択されている難易度を取得
    const activeDiffs = Array.from(document.querySelectorAll('.btn-diff-filter.active'))
        .map(btn => btn.getAttribute('data-diff').toUpperCase());

    // 🎨 各難易度に対応するカラーマップ
    const diffColors = {
        'EXP': { bg: '#ff4c4c', text: '#ffffff' }, // 赤
        'MAS': { bg: '#aa33ff', text: '#ffffff' }, // 紫
        'ULT': { bg: '#222222', text: '#ffcc00' }, // 黒・金文字
        'WE': {
            bg: 'linear-gradient(90deg, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #4b0082, #9400d3)',
            text: '#ffffff',
            extraStyle: 'text-shadow: 1px 1px 2px rgba(0,0,0,0.8);'
        }
    };

    let diffBadgesHtml = "";
    if (activeDiffs.length === 0) {
        diffBadgesHtml = `<span style="color: #94a3b8; font-weight: bold; font-size:12px;">難易度: 未選択</span>`;
    } else {
        diffBadgesHtml = `<span style="font-weight: bold; font-size:12px;">難易度: </span>` + activeDiffs.map(diff => {
            const colors = diffColors[diff] || { bg: '#718093', text: '#ffffff' };
            const extra = colors.extraStyle || '';
            return `<span style="background: ${colors.bg}; color: ${colors.text}; font-size: 11px; padding: 2px 6px; border-radius: 4px; margin-left: 4px; font-weight: bold; display: inline-block; vertical-align: middle; box-shadow: 0 1px 3px rgba(0,0,0,0.3); ${extra}">${diff}</span>`;
        }).join('');
    }

    const hasWE = activeDiffs.includes("WE");
    const isOnlyWE = activeDiffs.length === 1 && hasWE;

    let subInfo = "";

    // 傾向バッジのレンダリング
    const trendSwitch = document.getElementById('trend-enable-switch');
    const isTrendEnabled = trendSwitch ? trendSwitch.checked : false;
    let trendHtml = "";

    if (isTrendEnabled) {
        const activeTrends = Array.from(document.querySelectorAll('.btn-trend-filter.active')).map(btn => btn.getAttribute('data-trend'));
        const trendColors = {
            'POWER': { bg: '#36a2eb', text: '#ffffff' },
            'NOTES': { bg: '#be901f', text: '#ffffff' },
            'CHUNI': { bg: '#239898', text: '#ffffff' },
            'TRICKY': { bg: '#9966ff', text: '#ffffff' }
        };

        if (activeTrends.length === 0) {
            trendHtml = ` / <span style="color: #94a3b8; font-weight: bold;">傾向:なし</span>`;
        } else {
            const badges = activeTrends.map(trend => {
                const colors = trendColors[trend] || { bg: '#718093', text: '#ffffff' };
                return `<span style="background: ${colors.bg}; color: ${colors.text}; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-left: 4px; font-weight: bold; display: inline-block; vertical-align: middle;">${trend}</span>`;
            }).join('');
            trendHtml = ` / <span style="font-weight: bold; display: inline-block; align-items: center;">傾向:${badges}</span>`;
        }
    }

    if (currentDisplayType === 'avg') {
        if (isOnlyWE) {
            subInfo = `${diffBadgesHtml}${trendHtml}`;
        } else {
            const constLabel = hasWE ? `通常定数: ${minC} ～ ${maxC} (WEを除く)` : `定数: ${minC} ～ ${maxC}`;
            subInfo = `${diffBadgesHtml} / ${constLabel}${trendHtml}`;
        }
    } else {
        let scoreLabel = "";
        if (filterMode === 'score') {
            const rMin = document.getElementById('min-score')?.value || "0";
            const rMax = document.getElementById('max-score')?.value || "1010000";
            scoreLabel = `スコア: ${Number(rMin).toLocaleString()}～${Number(rMax).toLocaleString()}`;
        } else {
            const rankMinSelect = document.getElementById('rank-min');
            const rankMaxSelect = document.getElementById('rank-max');
            const minText = rankMinSelect ? rankMinSelect.options[rankMinSelect.selectedIndex]?.text : "0";
            const maxText = rankMaxSelect ? rankMaxSelect.options[rankMaxSelect.selectedIndex]?.text : "1010000";
            scoreLabel = `Rank: ${minText}～${maxText}`;
        }

        if (isOnlyWE) {
            subInfo = `${diffBadgesHtml} / ${scoreLabel} / ランプ: ${lampLabel}${trendHtml}`;
        } else {
            const constLabel = hasWE ? `通常定数: ${minC}～${maxC}` : `定数: ${minC}～${maxC}`;
            const rateLabel = hasWE ? `通常レート: ${minRate}～${maxRate}` : `レート: ${minRate}～${maxRate}`;
            subInfo = `${diffBadgesHtml} / ${constLabel} / ${rateLabel} / ${scoreLabel} / ランプ: ${lampLabel}${trendHtml}`;
        }
    }

    titleContainer.innerHTML = `
        ${mainTitle}
        <div class="title-sub-info" style="display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-start; gap: 4px; margin-top: 6px;">${subInfo}</div>
    `;
}

function showSubModal(row) {
    const subModal = document.getElementById('sub-modal');
    const subTbody = document.getElementById('sub-modal-tbody');
    const subTitle = document.getElementById('sub-modal-title');
    const thead = document.querySelector('#sub-modal-table thead tr');

    if (!subModal || !subTbody || !lastStatsResponse) return;

    // 💡 手元動画欄を確実に非表示にする
    const videoSection = document.getElementById('ranking-video-section');
    if (videoSection) videoSection.style.display = 'none';

    // 難易度表記がある場合はタイトルに付与（例: "楽曲名 [MAS]"）
    const diffSuffix = (row.diff && currentStatsMode === 'song') ? ` [${row.diff}]` : "";
    subTitle.innerText = (row.title || "プレイヤー状況一覧") + diffSuffix;
    subTbody.innerHTML = "";

    if (thead) {
        thead.innerHTML = `
            <th style="text-align:center; padding-left: 15px;">プレイヤー</th>
            <th style="text-align:center;">スコア</th>
        `;
    }

    // 💡 現在選択されている楽曲がWEか判定
    const isWE = row.diff && (String(row.diff).toUpperCase() === "WE" || String(row.diff).includes("WORLD"));

    const playDataMap = new Map();
    if (row.players) {
        row.players.forEach(p => {
            playDataMap.set(p.name, {
                score: p.score,
                isAchieved: p.isAchieved
            });
        });
    }

    const allPlayers = lastStatsResponse.playerRanking.map(p => p.playerName);

    const displayList = allPlayers.map(name => {
        const data = playDataMap.get(name);
        return {
            name: name,
            score: data ? data.score : -1,
            isAchieved: data ? data.isAchieved : false
        };
    });

    displayList.sort((a, b) => {
        if (a.score === -1 && b.score !== -1) return 1;
        if (a.score !== -1 && b.score === -1) return -1;
        return b.score - a.score;
    });

    displayList.forEach(p => {
        const tr = document.createElement('tr');

        // 💡 達成判定の同期（条件指定達成、または平均スコアモード時に対象スコアを満たしているか）
        let shouldHighlight = p.isAchieved;
        if (currentDisplayType === 'avg' && p.score !== -1) {
            const cutoff = isWE ? 900000 : 990000; // 💡 WEなら90万点、通常は99万点
            shouldHighlight = p.score >= cutoff;
        }

        if (shouldHighlight) {
            tr.style.backgroundColor = "rgba(255, 71, 87, 0.15)";
            tr.style.fontWeight = "bold";
        }

        const scoreDisplay = (p.score === -1)
            ? `<span style="color:#ccc;">-</span>`
            : p.score.toLocaleString();

        tr.innerHTML = `
            <td style="text-align:center; padding-left: 15px;">${p.name}</td>
            <td style="text-align:center;">${scoreDisplay}</td>
        `;
        subTbody.appendChild(tr);
    });

    subModal.style.display = "flex";
}

async function fetchAndShowPlayerDetail(playerName) {
    console.log(playerName + "の詳細を取得中...");

    const subModal = document.getElementById('sub-modal');
    const title = document.getElementById('sub-modal-title');
    const tbody = document.getElementById('sub-modal-tbody');

    if (subModal && title) {
        title.innerText = `${playerName} の詳細を読み込み中...`;
        if (tbody) tbody.innerHTML = "";
        subModal.style.display = "flex";
    }

    const filterMode = document.getElementById('filter-mode')?.value;

    let rMin = "0";
    let rMax = "1010000";

    if (filterMode === "score") {
        rMin = document.getElementById('min-score')?.value || "0";
        rMax = document.getElementById('max-score')?.value || "1010000";
    } else {
        rMin = document.getElementById('rank-min')?.value || "0";
        rMax = document.getElementById('rank-max')?.value || "1010000";
    }

    const trendSwitch = document.getElementById('trend-enable-switch');
    const isTrendEnabled = trendSwitch ? trendSwitch.checked : false;
    const activeTrends = isTrendEnabled
        ? Array.from(document.querySelectorAll('.btn-trend-filter.active')).map(btn => btn.getAttribute('data-trend'))
        : [];

    // 💡 難易度マルチ選択ボタンの状態を配列として取得
    const activeDiffs = Array.from(document.querySelectorAll('.btn-diff-filter.active'))
        .map(btn => btn.getAttribute('data-diff'));

    const params = {
        mode: "get_player_detail",
        filterMode: filterMode,
        playerName: playerName,
        diffFilter: activeDiffs, // 💡 GAS側に選択中の難易度配列を送信
        minConst: document.getElementById('min-constant')?.value || "0",
        maxConst: document.getElementById('max-constant')?.value || "16.0",
        minRate: document.getElementById('min-rating')?.value || "0",
        maxRate: document.getElementById('max-rating')?.value || "21.0",
        rankMin: rMin,
        rankMax: rMax,
        lampFilter: document.getElementById('lamp-filter')?.value || 'all',
        typeFilter: document.querySelector('.btn-filter.active')?.getAttribute('data-value') || 'all',
        isTrendEnabled: isTrendEnabled,
        activeTrends: activeTrends
    };

    try {
        const response = await fetch(GAS_URL, {
            method: "POST",
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(params)
        });
        const result = await response.json();

        if (result.status === "success") {
            showPlayerDetailModal({
                playerName: playerName,
                details: result.data
            });
        } else {
            alert("詳細データの取得に失敗しました: " + (result.message || "Unknown error"));
        }
    } catch (e) {
        console.error("詳細取得エラー:", e);
        alert("詳細データの取得に失敗しました。");
    }
}

/**
 * 取得した個人詳細データをモーダルに表示する
 */
function showPlayerDetailModal(playerData) {
    const subModal = document.getElementById('sub-modal');
    const tbody = document.getElementById('sub-modal-tbody');
    const title = document.getElementById('sub-modal-title');
    const thead = document.querySelector('#sub-modal-table thead tr');

    if (!title || !tbody || !thead) return;

    title.innerText = `${playerData.playerName} の詳細`;
    tbody.innerHTML = "";

    thead.innerHTML = `
        <th style="text-align: center; padding-left: 0px; width: 70%;">楽曲名</th>
        <th style="text-align: center; width: 30%;">スコア</th>
    `;

    const styleId = "scrollbar-hide-style";
    if (!document.getElementById(styleId)) {
        const styleTag = document.createElement('style');
        styleTag.id = styleId;
        styleTag.textContent = `#sub-modal-tbody div::-webkit-scrollbar { display: none; }`;
        document.head.appendChild(styleTag);
    }

    const noScrollbarStyle = "scrollbar-width: none; -ms-overflow-style: none;";

    // 🎨 個人詳細内用のバッジカラー設定（WEはレインボー仕様）
    const badgeColors = {
        'EXP': 'background: #ff4c4c; color: #fff;',
        'MAS': 'background: #aa33ff; color: #fff;',
        'ULT': 'background: #222; color: #ffcc00;',
        'WE': 'background: linear-gradient(90deg, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #4b0082, #9400d3); color: #fff; text-shadow: 1px 1px 1px rgba(0,0,0,0.6);'
    };

    playerData.details.forEach(item => {
        const tr = document.createElement('tr');

        if (item.isAchieved === true) {
            tr.style.backgroundColor = "rgba(240, 46, 46, 0.1)";
            tr.style.color = "#d63031";
            tr.style.fontWeight = "bold";
        }

        // 💡 曲名文字列（"楽曲名 [MAS]" など）から曲名本体と難易度表記をきれいに分離する処理
        let songTitle = item.title;
        let badgeHtml = "";
        const diffMatch = item.title.match(/(.*)\s\[(.*?)\]$/);

        if (diffMatch) {
            songTitle = diffMatch[1].trim(); // 曲名だけ抽出
            const diffStr = diffMatch[2].toUpperCase().trim();
            const style = badgeColors[diffStr] || 'background: #718093; color: #fff;';
            badgeHtml = `<span style="${style} font-size: 9px; padding: 1px 4px; border-radius: 3px; margin-left: 5px; font-weight: bold; vertical-align: middle;">${diffStr}</span>`;
        }

        tr.innerHTML = `
            <td style="text-align: left; padding-left: 0px; font-size: 0.85em; width: 70%; max-width: 0;">
                <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; padding-left: 5px; padding-right: 5px;">
                    <span style="overflow-x: auto; white-space: nowrap; ${noScrollbarStyle}" title="${item.title}">${songTitle}</span>
                    ${badgeHtml}
                </div>
            </td>
            <td style="text-align: center; width: 30%; font-size: 0.80em;">
                ${item.score.toLocaleString()}
            </td>
        `;

        tbody.appendChild(tr);
    });

    document.getElementById('sub-modal').style.display = 'flex';
}

/**
 * ==========================================================================
 * VS機能 フロントエンド処理 JavaScript（未プレイ除外スイッチ完全対応版）
 * ==========================================================================
 */

document.addEventListener("DOMContentLoaded", () => {
    const vsBtn = document.getElementById('vs-btn');
    if (vsBtn) {
        vsBtn.innerText = "VS (スコア比較)";
        vsBtn.onclick = openVsModal;
    }
});

let cachedVsPlayers = [];
let lastVsResponseData = null;

/**
 * ログイン中のプレイヤー名を自動取得する共通ヘルパー関数
 */
function getLoggedInPlayerName() {
    const nameElement = document.querySelector('#rating-average strong')
        || document.querySelector('.rating-container strong')
        || document.querySelector('.user-name');

    if (nameElement) {
        const name = nameElement.innerText || nameElement.textContent;
        if (name && name.trim() !== "Player" && name.trim() !== "") {
            return name.trim();
        }
    }

    let cachedName = localStorage.getItem('chuni_player_name');
    if (cachedName) return cachedName.trim();

    return "";
}

/**
 * モーダル起動・プレイヤー一覧の読み込み
 */
async function openVsModal() {
    const vsBtn = document.getElementById('vs-btn');
    if (vsBtn) { vsBtn.disabled = true; vsBtn.innerText = "プレイヤー読込中..."; }

    try {
        const response = await fetch(GAS_URL, {
            method: "POST",
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ mode: "get_vs_players" })
        });
        const result = await response.json();

        if (result.status === "success") {
            cachedVsPlayers = result.players || [];

            // 自分の名前を自動取得して表示
            const myName = getLoggedInPlayerName();
            const myNameDisplay = document.getElementById('vs-my-name-display');
            if (myNameDisplay) {
                myNameDisplay.innerText = myName || "（プレイヤー未同期）";
            }

            // メイン画面の定数フィルターの値を引き継ぎ
            const mainMinC = document.getElementById('min-constant')?.value || "13.5";
            const mainMaxC = document.getElementById('max-constant')?.value || "16.0";
            const minConstEl = document.getElementById('vs-min-const');
            const maxConstEl = document.getElementById('vs-max-const');

            if (minConstEl) {
                const parsedMin = parseFloat(mainMinC);
                minConstEl.value = isNaN(parsedMin) ? "13.5" : parsedMin.toFixed(1);
            }
            if (maxConstEl) {
                const parsedMax = parseFloat(mainMaxC);
                maxConstEl.value = isNaN(parsedMax) ? "16.0" : parsedMax.toFixed(1);
            }

            // メイン画面の難易度フィルターの選択状態をVSモーダル側のボタンに同期
            const mainActiveDiffs = Array.from(document.querySelectorAll('.btn-diff-filter.active'))
                .map(btn => btn.getAttribute('data-diff'));

            const vsDiffButtons = document.querySelectorAll('#vs-diff-buttons-container .vs-btn-diff-filter');
            vsDiffButtons.forEach(btn => {
                const diffVal = btn.getAttribute('data-diff');
                if (mainActiveDiffs.length === 0 || mainActiveDiffs.includes(diffVal)) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });

            // 初期同期時にWEと通常難易度が混ざっていた場合のセーフティ排他
            sanitizeVsDiffSelection();

            renderVsOpponents();
            document.getElementById('vs-setup-modal').style.display = "flex";
        } else {
            alert("プレイヤー名の取得に失敗しました: " + result.message);
        }
    } catch (e) {
        console.error("VSシステムエラー:", e);
        alert("通信に失敗しました。");
    } finally {
        if (vsBtn) { vsBtn.disabled = false; vsBtn.innerText = "VS (スコア比較)"; }
    }
}

/**
 * 対戦相手リストの描画（システム用シートの除外）
 */
function renderVsOpponents() {
    const container = document.getElementById('vs-opponents-container');
    if (!container) return;
    container.innerHTML = "";

    const myName = getLoggedInPlayerName();
    const excludeSheets = ["VideoRequests", "VideoSupplies", "MasterData", "Template"];

    cachedVsPlayers.forEach(p => {
        if (p === myName || excludeSheets.includes(p)) return;

        const div = document.createElement('div');
        div.className = "vs-checkbox-item";
        div.innerHTML = `<label><input type="checkbox" class="vs-opp-checkbox" value="${p}" onchange="checkVsOpponentLimit(this)"><span>${p}</span></label>`;
        container.appendChild(div);
    });
}

function checkVsOpponentLimit(checkbox) {
    const checkedBoxes = document.querySelectorAll('.vs-opp-checkbox:checked');
    if (checkedBoxes.length > 3) { checkbox.checked = false; alert("対戦相手は最大3人までしか選択できません。"); }
}

function closeVsSetupModal() { document.getElementById('vs-setup-modal').style.display = "none"; }
function closeVsResultModal() { document.getElementById('vs-result-modal').style.display = "none"; }

/**
 * VS専用 難易度フィルターボタンの排他選択ロジック
 */
function toggleVsDiffButton(buttonElement) {
    const clickedDiff = buttonElement.getAttribute('data-diff');

    buttonElement.classList.toggle('active');

    const container = document.getElementById('vs-diff-buttons-container');
    const normalDiffButtons = container.querySelectorAll('.vs-btn-diff-filter:not([data-diff="WE"])');
    const weButton = container.querySelector('.vs-btn-diff-filter[data-diff="WE"]');

    if (buttonElement.classList.contains('active')) {
        if (clickedDiff === "WE") {
            normalDiffButtons.forEach(btn => btn.classList.remove('active'));
        } else {
            if (weButton) weButton.classList.remove('active');
        }
    }
}

/**
 * 初期化時用の排他セーフティ関数
 */
function sanitizeVsDiffSelection() {
    const container = document.getElementById('vs-diff-buttons-container');
    if (!container) return;
    const weButton = container.querySelector('.vs-btn-diff-filter[data-diff="WE"]');
    const normalActive = container.querySelectorAll('.vs-btn-diff-filter:not([data-diff="WE"]).active');

    if (weButton && weButton.classList.contains('active') && normalActive.length > 0) {
        weButton.classList.remove('active');
    }
}

/**
 * VS設定画面の傾向フィルタースイッチのON/OFF制御
 */
function toggleVsTrendFilters() {
    const switchEl = document.getElementById('vs-trend-enable-switch');
    const containerEl = document.getElementById('vs-trend-buttons-container');
    if (!switchEl || !containerEl) return;

    if (switchEl.checked) {
        containerEl.classList.remove('vs-disabled');
    } else {
        containerEl.classList.add('vs-disabled');
        const activeButtons = containerEl.querySelectorAll('.vs-btn-trend-filter.active');
        activeButtons.forEach(btn => btn.classList.remove('active'));
    }
}

/**
 * VS専用 傾向フィルターボタンの選択/解除切り替え
 */
function toggleVsTrendButton(buttonElement) {
    const switchEl = document.getElementById('vs-trend-enable-switch');
    if (!switchEl || !switchEl.checked) return;
    buttonElement.classList.toggle('active');
}

/**
 * VS設定画面の定数セレクトボックス（0.1刻み）を自動生成する処理
 */
document.addEventListener("DOMContentLoaded", () => {
    const minSelect = document.getElementById("vs-min-const");
    const maxSelect = document.getElementById("vs-max-const");

    if (!minSelect || !maxSelect) return;

    const start = 13.5;
    const end = 16.0;
    const step = 0.1;

    for (let i = Math.round(start * 10); i <= Math.round(end * 10); i += Math.round(step * 10)) {
        const val = (i / 10).toFixed(1);
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = val;
        if (val === "13.5") opt.selected = true;
        minSelect.appendChild(opt);
    }

    for (let i = Math.round(end * 10); i >= Math.round(start * 10); i -= Math.round(step * 10)) {
        const val = (i / 10).toFixed(1);
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = val;
        if (val === "16.0") opt.selected = true;
        maxSelect.appendChild(opt);
    }
});

/**
 * スコアが有効（0より大きい数値）であるかを判定するヘルパー関数
 */
function isValidScore(score) {
    if (score === null || score === undefined) return false;
    const num = Number(score);
    return !isNaN(num) && num > 0;
}

/**
 * スコア比較実行
 */
async function startVsCompare() {
    const myName = getLoggedInPlayerName();
    if (!myName) { alert("あなたのプレイヤー名が取得できません。一度同期を行ってください。"); return; }

    const checkedBoxes = document.querySelectorAll('.vs-opp-checkbox:checked');
    const opponents = Array.from(checkedBoxes).map(cb => cb.value);
    if (opponents.length === 0) { alert("対戦相手を少なくとも1人選択してください。"); return; }

    const minC = document.getElementById('vs-min-const')?.value || "13.5";
    const maxC = document.getElementById('vs-max-const')?.value || "16.0";

    const vsTrendSwitch = document.getElementById('vs-trend-enable-switch');
    const isTrendEnabled = vsTrendSwitch ? vsTrendSwitch.checked : false;

    const activeTrends = isTrendEnabled
        ? Array.from(document.querySelectorAll('#vs-trend-buttons-container .vs-btn-trend-filter.active')).map(btn => btn.getAttribute('data-trend'))
        : [];

    const activeDiffs = Array.from(document.querySelectorAll('#vs-diff-buttons-container .vs-btn-diff-filter.active'))
        .map(btn => btn.getAttribute('data-diff'));

    if (activeDiffs.length === 0) {
        alert("難易度は少なくとも1つ以上選択してください。");
        return;
    }

    // 💡 HTML内の未プレイ除外スイッチ（vs-hide-unplayed-switch）の状態を取得
    const hideUnplayedSwitch = document.getElementById('vs-hide-unplayed-switch');
    const hideUnplayed = hideUnplayedSwitch ? hideUnplayedSwitch.checked : false;

    const startBtn = document.getElementById('vs-start-btn');
    if (startBtn) { startBtn.disabled = true; startBtn.innerText = "比較中..."; }

    try {
        const response = await fetch(GAS_URL, {
            method: "POST",
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                mode: "get_vs_data",
                myName: myName,
                opponents: opponents,
                diffFilter: activeDiffs,
                minConst: parseFloat(minC),
                maxConst: parseFloat(maxC),
                isTrendEnabled: isTrendEnabled,
                activeTrends: activeTrends
            })
        });
        const result = await response.json();

        if (result.status === "success") {
            closeVsSetupModal();

            let vsData = result.data;

            // 💡【未プレイ除外処理】スイッチがONの場合、自分＋選択された相手全員のスコアが > 0 の楽曲のみ残す
            if (hideUnplayed && vsData && vsData.vsRows) {
                vsData.vsRows = vsData.vsRows.filter(row => {
                    // 1. 自分のスコアチェック
                    if (!isValidScore(row.myScore)) return false;

                    // 2. 選択対戦相手全員のスコアチェック
                    return opponents.every(oppName => {
                        const oppData = row.rankList?.find(p => p.name === oppName);
                        return oppData && isValidScore(oppData.score);
                    });
                });

                // 1対1比較時の勝敗数（WIN / DRAW / LOSE）を除外後のデータで再計算
                if (vsData.opponents.length === 1) {
                    const oppName = vsData.opponents[0];
                    let win = 0, draw = 0, lose = 0;

                    vsData.vsRows.forEach(row => {
                        const oppScore = row.rankList?.find(p => p.name === oppName)?.score || 0;
                        if (row.myScore > oppScore) {
                            row.matchResult = "WIN";
                            win++;
                        } else if (row.myScore < oppScore) {
                            row.matchResult = "LOSE";
                            lose++;
                        } else {
                            row.matchResult = "DRAW";
                            draw++;
                        }
                    });
                    vsData.summary = { win, draw, lose };
                }
            }

            lastVsResponseData = vsData;
            renderVsResult();
        } else {
            alert("エラー: " + result.message);
        }
    } catch (e) {
        console.error("VS通信エラー:", e);
        alert("通信に失敗しました。");
    } finally {
        if (startBtn) { startBtn.disabled = false; startBtn.innerText = "スコアを比較する"; }
    }
}

function handleBasePlayerChange(selectElement) {
    renderVsResult(selectElement.value);
}

/**
 * 共通ヘルパー：曲名テキストから難易度バッジHTMLを生成する
 */
function getVsTitleAndBadgeHtml(fullTitle) {
    const badgeColors = {
        'EXP': 'background: #ff4c4c; color: #fff;',
        'MAS': 'background: #aa33ff; color: #fff;',
        'ULT': 'background: #222; color: #ffcc00;',
        'WE': 'background: linear-gradient(90deg, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #4b0082, #9400d3); color: #fff; text-shadow: 1px 1px 1px rgba(0,0,0,0.6);'
    };

    let songTitle = fullTitle;
    let badgeHtml = "";
    const diffMatch = fullTitle.match(/(.*)\s\[(.*?)\]$/);

    if (diffMatch) {
        songTitle = diffMatch[1].trim();
        const diffStr = diffMatch[2].toUpperCase().trim();
        const style = badgeColors[diffStr] || 'background: #718093; color: #fff;';
        badgeHtml = `<span style="${style} font-size: 9px; padding: 1px 4px; border-radius: 3px; margin-left: 5px; font-weight: bold; vertical-align: middle; white-space: nowrap;">${diffStr}</span>`;
    }

    const noScrollbarStyle = "scrollbar-width: none; -ms-overflow-style: none;";

    return `
        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
            <span style="overflow-x: auto; white-space: nowrap; ${noScrollbarStyle}" title="${fullTitle}">${songTitle}</span>
            ${badgeHtml}
        </div>
    `;
}

/**
 * 全件がWORLD'S END(WE)楽曲のみであるかを判定する関数
 */
function isAllSongsWe(vsRows) {
    if (!vsRows || vsRows.length === 0) return false;
    return vsRows.every(row => /\[WE\]$/i.test(row.title));
}

/**
 * 結果画面のメイン描画
 */
function renderVsResult(forcedBasePlayer) {
    const container = document.getElementById('vs-result-dynamic-container');
    if (!container || !lastVsResponseData) return;
    container.innerHTML = "";

    const data = lastVsResponseData;
    const oppCount = data.opponents.length;
    const totalPlayersCount = oppCount + 1;
    const formatScore = (sc) => sc === 0 ? `<span style="color:#aaa;">-</span>` : sc.toLocaleString();

    const isWeMode = isAllSongsWe(data.vsRows);

    let trendHtml = "";
    const vsTrendSwitch = document.getElementById('vs-trend-enable-switch');
    const isTrendEnabled = vsTrendSwitch ? vsTrendSwitch.checked : false;

    if (isTrendEnabled && !isWeMode) {
        const activeTrends = Array.from(document.querySelectorAll('#vs-trend-buttons-container .vs-btn-trend-filter.active')).map(btn => btn.getAttribute('data-trend'));
        const trendColors = {
            'POWER': { bg: '#36a2eb', text: '#ffffff' },
            'NOTES': { bg: '#be901f', text: '#ffffff' },
            'CHUNI': { bg: '#239898', text: '#ffffff' },
            'TRICKY': { bg: '#9966ff', text: '#ffffff' }
        };

        if (activeTrends.length === 0) {
            trendHtml = ` / <span style="color: #94a3b8; font-weight: bold;">傾向: 表示なし</span>`;
        } else {
            const badges = activeTrends.map(trend => {
                const colors = trendColors[trend] || { bg: '#718093', text: '#ffffff' };
                return `<span style="background: ${colors.bg}; color: ${colors.text}; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-left: 4px; font-weight: bold; display: inline-block; vertical-align: middle;">${trend}</span>`;
            }).join('');
            trendHtml = ` / <span style="font-weight: bold; display: inline-block; align-items: center;">傾向:${badges}</span>`;
        }
    }

    const actionButtonsHtml = `
        <div class="vs-action-row" style="display: flex; justify-content: center; gap: 12px; margin: 15px 0;">
            <button class="vs-btn-back-setup" 
                    onclick="document.getElementById('vs-result-modal').style.display='none'; if(document.getElementById('vs-setup-modal')){ document.getElementById('vs-setup-modal').style.display='flex'; }" 
                    style="padding: 10px 16px; font-size: 14px; font-weight: bold; background-color: #0076f6; color: #fff; border: none; border-radius: 6px; cursor: pointer; flex: 1; max-width: 160px; white-space: nowrap;">
                設定画面に戻る
            </button>
            <button class="vs-btn-close-modal" 
                    onclick="closeVsResultModal()" 
                    style="padding: 10px 16px; font-size: 14px; font-weight: bold; background-color: #8e8e93; color: #fff; border: none; border-radius: 6px; cursor: pointer; flex: 1; max-width: 120px; white-space: nowrap;">
                閉じる
            </button>
        </div>
    `;

    if (oppCount === 1) {
        const oppName = data.opponents[0];
        const vsRows = [...data.vsRows];
        const totalSongs = vsRows.length;

        let html = `
            <div class="vs-header-left" style="line-height: 1.6; margin-bottom: 10px;">
                ${isWeMode ? '<strong>難易度タイプ:</strong> WORLD\'S END' : '<strong>定数:</strong> ' + data.minConst + ' ～ ' + data.maxConst}${trendHtml} （全 ${totalSongs} 曲）<br>
                <strong>対戦相手:</strong> ${oppName}
            </div>
        `;

        html += `
            <div class="vs-header-center">
                <span style="color:#f02e2e; font-weight:bold; margin:0 10px;">WIN: <span style="font-size:18px;">${data.summary.win}</span> 曲</span>
                <span style="color:#00a310; font-weight:bold; margin:0 10px;">DRAW: <span style="font-size:18px;">${data.summary.draw}</span> 曲</span>
                <span style="color:#2e7df0; font-weight:bold; margin:0 10px;">LOSE: <span style="font-size:18px;">${data.summary.lose}</span> 曲</span>
            </div>
        `;

        html += actionButtonsHtml;

        // ソート処理
        vsRows.sort((a, b) => {
            const resPriority = { "WIN": 1, "DRAW": 2, "LOSE": 3 };
            const pA = resPriority[a.matchResult] || 99;
            const pB = resPriority[b.matchResult] || 99;
            if (pA !== pB) return pA - pB;

            const oppScoreA = a.rankList?.find(p => p.name === oppName)?.score || 0;
            const diffA = a.myScore - oppScoreA;
            const oppScoreB = b.rankList?.find(p => p.name === oppName)?.score || 0;
            const diffB = b.myScore - oppScoreB;

            if (a.matchResult === "WIN" || a.matchResult === "LOSE") return diffB - diffA;
            return isWeMode ? a.title.localeCompare(b.title) : b.constant - a.constant;
        });

        html += `
            <div class="vs-table-scroll-container">
                <table class="vs-table-single">
                    <thead>
                        <tr>
                            <th class="vs-col-title">曲名</th>
                            ${isWeMode ? '' : '<th class="vs-col-const">定数</th>'}
                            <th class="vs-col-score">${data.myName}</th>
                            <th class="vs-col-diff">点差</th>
                            <th class="vs-col-score">${oppName}</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        if (totalSongs === 0) {
            const colspanVal = isWeMode ? 4 : 5;
            html += `<tr><td colspan="${colspanVal}" style="text-align:center; padding:20px; color:#999;">該当する楽曲がありません。</td></tr>`;
        }

        vsRows.forEach(row => {
            const myScore = row.myScore;
            const oppScore = row.rankList?.find(p => p.name === oppName)?.score || 0;
            const diff = myScore - oppScore;

            let diffStr = "0";
            let diffClass = "vs-diff-draw";
            if (row.matchResult === "WIN") {
                diffStr = "+" + diff.toLocaleString();
                diffClass = "vs-diff-win";
            } else if (row.matchResult === "LOSE") {
                diffStr = diff.toLocaleString();
                diffClass = "vs-diff-lose";
            }

            const titleContent = getVsTitleAndBadgeHtml(row.title);

            html += `
                <tr>
                    <td class="vs-col-title">${titleContent}</td>
                    ${isWeMode ? '' : '<td class="vs-col-const">' + (row.constant ? row.constant.toFixed(1) : '-') + '</td>'}
                    <td class="vs-col-score">${formatScore(myScore)}</td>
                    <td class="vs-col-diff ${diffClass}">${diffStr}</td>
                    <td class="vs-col-score">${formatScore(oppScore)}</td>
                </tr>
            `;
        });

        html += `</tbody></table></div>`;
        html += actionButtonsHtml;
        container.innerHTML = html;

    } else {
        // 複数人比較モード
        const basePlayer = forcedBasePlayer || data.myName;
        const vsRows = [...data.vsRows];
        const totalSongs = vsRows.length;
        const allActivePlayers = [data.myName, ...data.opponents];

        let html = `
            <div style="text-align:left; margin-bottom:15px; font-size:16px; font-weight:bold;">
                <select id="vs-base-player-select" class="vs-select" style="width:auto; display:inline-block; font-size:15px; padding:4px 8px; margin-right:5px;" onchange="handleBasePlayerChange(this)">
        `;
        allActivePlayers.forEach(p => {
            const selected = (p === basePlayer) ? "selected" : "";
            html += `<option value="${p}" ${selected}>${p}</option>`;
        });
        html += `</select> のスコア比較結果</div>`;

        const displayOpponents = allActivePlayers.filter(p => p !== basePlayer).join('、');
        html += `
            <div class="vs-header-left" style="line-height: 1.6; margin-bottom: 10px;">
                ${isWeMode ? '<strong>難易度タイプ:</strong> WORLD\'S END' : '<strong>定数:</strong> ' + data.minConst + ' ～ ' + data.maxConst}${trendHtml} （全 ${totalSongs} 曲）<br>
                <strong>対戦相手:</strong> ${displayOpponents}
            </div>
        `;

        const buckets = {};
        for (let r = 1; r <= totalPlayersCount; r++) { buckets[r] = []; }

        vsRows.forEach(row => {
            const baseScore = row.rankList?.find(p => p.name === basePlayer)?.score || 0;
            let exactRank = 1;
            (row.rankList || []).forEach(p => {
                if (p.name !== basePlayer && p.score > baseScore) { exactRank++; }
            });

            if (exactRank > totalPlayersCount) exactRank = totalPlayersCount;

            const othersSorted = (row.rankList || [])
                .filter(p => p.name !== basePlayer)
                .sort((a, b) => b.score - a.score);

            buckets[exactRank].push({
                title: row.title,
                constant: row.constant,
                baseScore: baseScore,
                others: othersSorted
            });
        });

        html += `<div class="vs-header-center">`;
        for (let r = 1; r <= totalPlayersCount; r++) {
            html += `<span style="font-weight:bold; margin:0 10px;">${r}位: <span style="font-size:18px;">${buckets[r].length}</span> 曲</span>`;
        }
        html += `</div>`;

        html += actionButtonsHtml;

        for (let dRank = 1; dRank <= totalPlayersCount; dRank++) {
            const songList = buckets[dRank];

            if (isWeMode) {
                songList.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
            } else {
                songList.sort((a, b) => b.constant - a.constant);
            }

            html += `
                <details class="vs-drawer" ${dRank === 1 ? 'open' : ''}>
                    <summary>${dRank}位の楽曲 (${songList.length} 曲)</summary>
                    <div class="vs-drawer-content">
                        <div class="vs-table-scroll-container">
                            <table class="vs-table-single">
                                <thead>
                                    <tr>
                                        <th class="vs-col-title">曲名</th>
                                        ${isWeMode ? '' : '<th class="vs-col-const">定数</th>'}
            `;

            for (let idx = 1; idx <= totalPlayersCount; idx++) {
                if (idx === dRank) {
                    html += `<th class="vs-col-score vs-multi-my-column-header">${basePlayer}</th>`;
                } else {
                    html += `<th class="vs-col-score">${idx === 1 ? '1位' : idx + '位'}</th>`;
                }
            }

            html += `
                                    </tr>
                                </thead>
                                <tbody>
            `;

            if (songList.length === 0) {
                const colspanVal = isWeMode ? (1 + totalPlayersCount) : (2 + totalPlayersCount);
                html += `<tr><td colspan="${colspanVal}" style="text-align:center; padding:20px; color:#999;">該当する楽曲がありません。</td></tr>`;
            }

            songList.forEach(song => {
                const titleContent = getVsTitleAndBadgeHtml(song.title);

                html += `
                    <tr>
                        <td class="vs-col-title">${titleContent}</td>
                        ${isWeMode ? '' : '<td class="vs-col-const">' + (song.constant ? song.constant.toFixed(1) : '-') + '</td>'}
                `;

                for (let idx = 1; idx <= totalPlayersCount; idx++) {
                    if (idx === dRank) {
                        html += `
                            <td class="vs-col-score vs-multi-my-cell">
                                <div class="vs-multi-player-score-large">${formatScore(song.baseScore)}</div>
                            </td>
                        `;
                    } else {
                        const otherIdx = (idx < dRank) ? (idx - 1) : (idx - 2);
                        const otherPlayer = song.others[otherIdx];

                        if (otherPlayer) {
                            html += `
                                <td class="vs-col-score">
                                    <div class="vs-multi-player-name">${otherPlayer.name}</div>
                                    <div class="vs-multi-player-score">${formatScore(otherPlayer.score)}</div>
                                </td>
                            `;
                        } else {
                            html += `<td class="vs-col-score" style="color:#aaa;">-</td>`;
                        }
                    }
                }
                html += `</tr>`;
            });

            html += `</tbody></table></div></div></details>`;
        }

        html += actionButtonsHtml;
        container.innerHTML = html;
    }

    document.getElementById('vs-result-modal').style.display = "flex";
}

/**
 * サブモーダルを閉じる
 */
function closeSubModal() {
    const subModal = document.getElementById('sub-modal');
    if (subModal) subModal.style.display = "none";
}





function resetTableVisibility() {
    const rows = document.querySelectorAll("#ranking-body tr");
    rows.forEach(row => {
        row.style.display = "";
    });
    // ★ グラフを再描画して点も全員分戻す
    drawRankingChart();
}

// ==========================================
// 手元動画プラットフォーム：リアルタイム管理データ
// ==========================================
let liveRequests = [];
let liveSupplies = [];
let currentToolPlayerName = "ゲストプレイヤー";

// ==========================================
// 1. モーダルの開閉 ＆ リアルタイム同期（全表示修正版）
// ==========================================
async function openVideoHubModal() {
    // 1. ローカルストレージからプレイヤー名を取得
    const savedName = localStorage.getItem('chunirec_player_name');
    currentToolPlayerName = savedName ? savedName : "ゲストプレイヤー";

    // 2. まず先にプラットフォームのモーダル枠を表示する
    const hubModal = document.getElementById("video-hub-modal");
    if (hubModal) {
        hubModal.style.display = "flex";
    }

    // 3. 【超重要】まず最優先でGASから「全員分」の最新30件データを完全に取得して描画する
    await fetchVideoHubData();

    // 4. データが全件表示された「後」に、入力欄のサジェストや文字入力センサーを初期化する
    if (typeof updateSongSuggestions === 'function') {
        updateSongSuggestions("");
    }
    if (typeof initSongSuggestionListeners === 'function') {
        initSongSuggestionListeners();
    }
}

function closeVideoHubModal() {
    document.getElementById("video-hub-modal").style.display = "none";
}

// ==========================================
// 【通信】GASからプラットフォーム全体の最新30件を取得する
// ==========================================
async function fetchVideoHubData() {
    const reqTbody = document.getElementById("video-request-tbody");
    const supTbody = document.getElementById("video-supply-tbody");

    if (reqTbody) reqTbody.innerHTML = "<tr><td colspan='4' style='text-align:center; color:#888;'>読込中...</td></tr>";
    if (supTbody) supTbody.innerHTML = "<tr><td colspan='4' style='text-align:center; color:#888;'>読込中...</td></tr>";

    try {
        console.log("【追跡】① fetchVideoHubData が呼び出されました。GASへ通信を開始します。");

        const response = await fetch(GAS_URL, {
            method: "POST",
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ mode: "get_video_history" })
        });
        const result = await response.json();

        console.log("【追跡】② GASからレスポンスを受信しました。生のデータ構造:", result);

        if (result && result.status === "success" && result.data) {
            liveRequests = result.data.requests || [];
            liveSupplies = result.data.supplies || [];
        } else {
            const actualData = result.data || result;
            liveRequests = actualData.requests || [];
            liveSupplies = actualData.supplies || [];
        }

        console.log("【追跡】③ 変数への格納が完了しました。現在保持している全プレイヤーの動画データ:", liveSupplies);

        renderVideoHubTables();

        console.log("【追跡】④ renderVideoHubTables の実行が完了しました。現在の liveSupplies:", liveSupplies);

        setTimeout(() => {
            console.log("【追跡】⑤ 描画から1秒後の liveSupplies:", liveSupplies);
        }, 1000);

    } catch (e) {
        console.error("動画データ同期エラー:", e);
        if (reqTbody) reqTbody.innerHTML = "<tr><td colspan='4' style='text-align:center; color:red;'>データ同期エラー</td></tr>";
        if (supTbody) supTbody.innerHTML = "<tr><td colspan='4' style='text-align:center; color:red;'>データ同期エラー</td></tr>";
    }
}

// ==========================================
// 2. タブ切り替えロジック
// ==========================================
function switchVideoTab(tabType) {
    const reqTab = document.getElementById("tab-request-btn");
    const supTab = document.getElementById("tab-supply-btn");
    const reqPanel = document.getElementById("video-request-panel");
    const supPanel = document.getElementById("video-supply-panel");

    if (tabType === 'request') {
        reqTab.classList.add("active");
        supTab.classList.remove("active");
        reqPanel.style.display = "flex";
        supPanel.style.display = "none";
    } else if (tabType === 'supply') {
        reqTab.classList.remove("active");
        supTab.classList.add("active");
        reqPanel.style.display = "none";
        supPanel.style.display = "flex";
    }
}

// ==========================================
// 3. フォーム送信処理（安心の厳密チェック維持版）
// ==========================================

// --- リクエストの投稿 / 修正更新 ---
async function submitVideoRequest() {
    const titleInput = document.getElementById("req-title-input");
    const diffInput = document.getElementById("req-diff-input");
    const commentInput = document.getElementById("req-comment-input");
    const editIndexInput = document.getElementById("req-edit-index");

    const inputTitle = titleInput.value.trim();
    const selectedDiff = diffInput.value;
    const inputComment = commentInput ? commentInput.value.trim() : "";
    const editIndex = parseInt(editIndexInput.value);

    if (!inputTitle) return alert("曲名を入力してください。");

    // 💡 所持データチェックは元の綺麗な「厳密一致」をそのまま採用！
    const targetData = (typeof myCurrentRecords !== 'undefined' ? myCurrentRecords : []);
    const exactSongWithDiff = targetData.find(item =>
        String(item.title || "").toLowerCase() === inputTitle.toLowerCase() &&
        String(item.diff || "").toUpperCase() === selectedDiff.toUpperCase()
    );

    if (!exactSongWithDiff) {
        const isSongExistOnly = targetData.some(item => String(item.title || "").toLowerCase() === inputTitle.toLowerCase());
        if (isSongExistOnly) {
            alert(`「${inputTitle}」は見つかりましたが、選択された難易度 [${selectedDiff === "WE" ? "WORLD'S END" : selectedDiff}] のプレイデータが存在しません。`);
        } else {
            alert("該当する楽曲が見つかりません。予測候補から正しい曲名を選択してください。");
        }
        return;
    }

    const finalTitle = exactSongWithDiff.title;
    const targetId = editIndex > -1 ? liveRequests[editIndex].id : null;

    try {
        const response = await fetch(GAS_URL, {
            method: "POST",
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                mode: "add_video_request",
                id: targetId,
                title: finalTitle,
                diff: selectedDiff,
                requester: currentToolPlayerName,
                comment: inputComment
            })
        });
        const result = await response.json();
        if (result.status === "success") {
            alert(targetId ? "リクエストを修正しました。" : "リクエストを登録しました。");
            cancelRequestEdit();
            titleInput.value = "";
            if (commentInput) commentInput.value = "";
            await fetchVideoHubData();
        } else {
            alert("エラー: " + result.message);
        }
    } catch (e) {
        alert("送信に失敗しました。");
    }
}

/**
 * 💡 ランキング画面から「手元動画をリクエスト」ボタンを押したときのジャンプ処理（WE対応版）
 */
function jumpToVideoRequest(songTitle, diff) {
    const rankingModal = document.getElementById('ranking-modal');
    if (rankingModal) rankingModal.style.display = "none";

    openVideoHubModal().then(() => {
        switchVideoTab('request');
        cancelRequestEdit();

        const reqTitleInput = document.getElementById("req-title-input");
        const reqDiffInput = document.getElementById("req-diff-input");

        if (reqTitleInput) reqTitleInput.value = songTitle;
        if (reqDiffInput) {
            // ランキング側から "WE" や "WORLD'S END" で飛んできても、セレクトボックスの "WE" に綺麗に一致させる
            let shortDiff = "MAS";
            const upperDiff = diff.toUpperCase();
            if (upperDiff.includes("EXP")) shortDiff = "EXP";
            else if (upperDiff.includes("MAS")) shortDiff = "MAS";
            else if (upperDiff.includes("ULT")) shortDiff = "ULT";
            else if (upperDiff.includes("WE") || upperDiff.includes("WORLD")) shortDiff = "WE";

            reqDiffInput.value = shortDiff;
        }

        const commentInput = document.getElementById("req-comment-input");
        if (commentInput) {
            commentInput.focus();
        }
    });
}

/**
 * 💡 ランキング画面から「手元動画を登録する」ボタンを押したときのジャンプ処理（WE対応版）
 */
function jumpToVideoSupply(songTitle, diff) {
    const rankingModal = document.getElementById('ranking-modal');
    if (rankingModal) rankingModal.style.display = "none";

    openVideoHubModal().then(() => {
        // アップロード（サプライ）側のタブを開き、フォームをリセット
        switchVideoTab('supply');
        cancelSupplyEdit();

        const supTitleInput = document.getElementById("sup-title-input");
        const supDiffInput = document.getElementById("sup-diff-input");

        // 曲名と難易度を自動注入
        if (supTitleInput) supTitleInput.value = songTitle;
        if (supDiffInput) {
            let shortDiff = "MAS";
            const upperDiff = diff.toUpperCase();
            if (upperDiff.includes("EXP")) shortDiff = "EXP";
            else if (upperDiff.includes("MAS")) shortDiff = "MAS";
            else if (upperDiff.includes("ULT")) shortDiff = "ULT";
            else if (upperDiff.includes("WE") || upperDiff.includes("WORLD")) shortDiff = "WE";

            supDiffInput.value = shortDiff;
        }

        // 入力をスムーズにするため、URL入力欄に自動フォーカス
        const urlInput = document.getElementById("sup-url-input");
        if (urlInput) {
            urlInput.focus();
        }
    });
}

// --- アップロードの登録 / 修正更新 ---
async function submitVideoSupply() {
    const titleInput = document.getElementById("sup-title-input");
    const diffInput = document.getElementById("sup-diff-input");
    const urlInput = document.getElementById("sup-url-input");
    const nameInput = document.getElementById("sup-name-input");
    const editIndexInput = document.getElementById("sup-edit-index");
    const inputTitle = titleInput.value.trim();
    const selectedDiff = diffInput.value;
    const editIndex = parseInt(editIndexInput.value);

    if (!inputTitle || !urlInput.value.trim()) return alert("曲名と動画URLは必須入力です。");

    // 💡 アップロード側も元の綺麗な「厳密一致」をそのまま採用！
    const targetData = (typeof myCurrentRecords !== 'undefined' ? myCurrentRecords : []);
    const exactSongWithDiff = targetData.find(item =>
        String(item.title || "").toLowerCase() === inputTitle.toLowerCase() &&
        String(item.diff || "").toUpperCase() === selectedDiff.toUpperCase()
    );

    if (!exactSongWithDiff) {
        const isSongExistOnly = targetData.some(item => String(item.title || "").toLowerCase() === inputTitle.toLowerCase());
        if (isSongExistOnly) {
            alert(`「${inputTitle}」は見つかりましたが、選択された難易度 [${selectedDiff === "WE" ? "WORLD'S END" : selectedDiff}] のプレイデータが存在しません。`);
        } else {
            alert("該当する楽曲が見つかりません。予測候補から正しい曲名を選択してください。");
        }
        return;
    }

    const finalTitle = exactSongWithDiff.title;
    const videoTitle = nameInput.value.trim() ? nameInput.value.trim() : "手元動画";
    const targetId = editIndex > -1 ? liveSupplies[editIndex].id : null;

    try {
        const response = await fetch(GAS_URL, {
            method: "POST",
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                mode: "add_video_supply",
                id: targetId,
                title: finalTitle,
                diff: selectedDiff,
                contributor: currentToolPlayerName,
                videoUrl: urlInput.value.trim(),
                videoTitle: videoTitle
            })
        });
        const result = await response.json();
        if (result.status === "success") {
            alert(targetId ? "動画リンクを修正しました。" : "動画リンクを共有しました。");
            cancelSupplyEdit();
            titleInput.value = "";
            urlInput.value = "";
            nameInput.value = "";
            await fetchVideoHubData();
        } else {
            alert("エラー: " + result.message);
        }
    } catch (e) {
        alert("送信に失敗しました。");
    }
}

// ==========================================
// 4. 履歴テーブルの描画処理（曲名検索のみ・安定版）
// ==========================================
function renderVideoHubTables() {
    const reqInput = document.getElementById("req-title-input");
    const supInput = document.getElementById("sup-title-input");

    const reqQuery = reqInput ? reqInput.value.toLowerCase().trim() : "";
    const supQuery = supInput ? supInput.value.toLowerCase().trim() : "";

    // --- ① リクエストテーブルの描画 ---
    const reqTbody = document.getElementById("video-request-tbody");
    if (reqTbody) {
        reqTbody.innerHTML = "";

        const filteredRequests = liveRequests.filter(req => {
            return !reqQuery || String(req.title || "").toLowerCase().includes(reqQuery);
        });

        if (filteredRequests.length === 0) {
            reqTbody.innerHTML = `<tr><td colspan='4' style='text-align:center; color:#888;'>条件に合うリクエストは見つかりません。</td></tr>`;
        } else {
            filteredRequests.forEach((req) => {
                const globalIndex = liveRequests.findIndex(r => r.id === req.id);

                let actionHtml = "<td style='text-align:center;'>-</td>";
                if (req.user === currentToolPlayerName) {
                    actionHtml = `
                        <td style='text-align:center;'>
                            <button class="btn-video-action edit" onclick="event.stopPropagation(); startRequestEdit(${globalIndex})">編集</button>
                            <button class="btn-video-action delete" onclick="event.stopPropagation(); deleteVideoItem('${req.id}')">削除</button>
                        </td>
                    `;
                }

                let displayDate = req.date || "";
                if (displayDate.includes("T")) {
                    try {
                        const d = new Date(displayDate);
                        if (!isNaN(d.getTime())) {
                            displayDate = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                        }
                    } catch (e) {
                        displayDate = displayDate.replace("T", " ").substring(5, 16);
                    }
                } else {
                    displayDate = displayDate.replace(/^\d{4}\//, "");
                }

                const displayDiffTxt = (String(req.diff).toUpperCase() === "WE") ? "WE" : req.diff;

                const trBasic = document.createElement("tr");
                trBasic.style.cursor = "pointer";
                trBasic.innerHTML = `
                    <td>
                        <div style="font-weight: bold; font-size: 14px; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${req.title}">
                            ${req.title}
                        </div>
                        <div style="font-size: 11px; color: #777; margin-top: 3px;">
                            難易度: <span style="font-weight: bold; color: #333;">${displayDiffTxt}</span>
                        </div>
                    </td>
                    <td style="max-width: 65px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: top; padding-top: 12px;" title="${req.user}">${req.user}</td>
                    <td style="font-size: 11px; color: #666; white-space: nowrap; vertical-align: top; padding-top: 12px;">${displayDate}</td>
                    ${actionHtml}
                `;

                trBasic.onclick = () => { closeVideoHubModal(); openSongRankingDirectly(req.title, req.diff); };
                reqTbody.appendChild(trBasic);

                if (req.comment && req.comment.trim() !== "") {
                    const trComment = document.createElement("tr");
                    trComment.style.cursor = "pointer";
                    trComment.style.backgroundColor = "#fffdf3";
                    trComment.innerHTML = `
                        <td colspan="4" style="padding: 6px 12px; border-top: none;">
                            <div style="font-size: 12px; color: #856404; border-left: 3px solid #ffc107; padding-left: 8px; word-break: break-all; font-weight: normal;">
                                 <strong>リクエスト内容:</strong> ${req.comment}
                            </div>
                        </td>
                    `;
                    trComment.onclick = () => { closeVideoHubModal(); openSongRankingDirectly(req.title, req.diff); };
                    reqTbody.appendChild(trComment);
                }
            });
        }
    }

    // --- ② アップロードテーブルの描画 ---
    const supTbody = document.getElementById("video-supply-tbody");
    if (supTbody) {
        supTbody.innerHTML = "";

        const filteredSupplies = liveSupplies.filter(sup => {
            return !supQuery || String(sup.title || "").toLowerCase().includes(supQuery);
        });

        if (filteredSupplies.length === 0) {
            supTbody.innerHTML = `<tr><td colspan='4' style='text-align:center; color:#888;'>条件に合う共有動画は見つかりません。</td></tr>`;
        } else {
            filteredSupplies.forEach((sup) => {
                const globalIndex = liveSupplies.findIndex(s => s.id === sup.id);

                let actionHtml = "<td style='text-align:center;'>-</td>";
                if (sup.user === currentToolPlayerName) {
                    actionHtml = `
                        <td style='text-align:center;'>
                            <button class="btn-video-action edit" onclick="event.stopPropagation(); startSupplyEdit(${globalIndex})">編集</button>
                            <button class="btn-video-action delete" onclick="event.stopPropagation(); deleteVideoItem('${sup.id}')">削除</button>
                        </td>
                    `;
                }

                const displayDiffTxt = (String(sup.diff).toUpperCase() === "WE") ? "WE" : sup.diff;

                const tr = document.createElement("tr");
                tr.style.cursor = "pointer";
                tr.innerHTML = `
                    <td>
                        <div style="font-weight: bold; font-size: 14px; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${sup.title}">
                            ${sup.title}
                        </div>
                        <div style="font-size: 11px; color: #777; margin-top: 3px;">
                            難易度: <span style="font-weight: bold; color: #333;">${displayDiffTxt}</span>
                        </div>
                    </td>
                    <td>
                        <a href="${sup.url}" target="_blank" onclick="event.stopPropagation();" style="color: #3498db; text-decoration: underline; font-weight: bold;" title="${sup.videoTitle}">${sup.videoTitle}</a>
                    </td>
                    <td style="max-width: 55px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: top; padding-top: 12px;" title="${sup.user}">${sup.user}</td>
                    ${actionHtml}
                `;
                tr.onclick = () => { closeVideoHubModal(); openSongRankingDirectly(sup.title, sup.diff); };
                supTbody.appendChild(tr);
            });
        }
    }
}

// ==========================================
// 5. 編集・削除のコントロールと通信関数
// ==========================================
async function deleteVideoItem(id) {
    if (!confirm("本当にこの投稿を削除しますか？")) return;
    try {
        const response = await fetch(GAS_URL, {
            method: "POST",
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                mode: "delete_video_item",
                id: id,
                playerName: currentToolPlayerName
            })
        });
        const result = await response.json();
        if (result.status === "success") {
            alert("削除しました。");
            await fetchVideoHubData();
        } else {
            alert("削除失敗: " + result.message);
        }
    } catch (e) {
        alert("通信エラーにより削除できませんでした。");
    }
}

function startRequestEdit(index) {
    const req = liveRequests[index];
    document.getElementById("req-title-input").value = req.title;
    document.getElementById("req-diff-input").value = req.diff;
    if (document.getElementById("req-comment-input")) {
        document.getElementById("req-comment-input").value = req.comment || "";
    }
    document.getElementById("req-edit-index").value = index;
    document.getElementById("req-form-title").innerText = "リクエストを編集する";
    document.getElementById("btn-req-submit").innerText = "更新する";
    document.getElementById("btn-req-cancel").style.display = "inline-block";
}

function cancelRequestEdit() {
    document.getElementById("req-title-input").value = "";
    document.getElementById("req-diff-input").value = "MAS";
    if (document.getElementById("req-comment-input")) {
        document.getElementById("req-comment-input").value = "";
    }
    document.getElementById("req-edit-index").value = "-1";
    document.getElementById("req-form-title").innerText = "新しい手元動画をリクエストする";
    document.getElementById("btn-req-submit").innerText = "リクエストを投稿";
    document.getElementById("btn-req-cancel").style.display = "none";
}

function startSupplyEdit(index) {
    const sup = liveSupplies[index];
    document.getElementById("sup-title-input").value = sup.title;
    document.getElementById("sup-diff-input").value = sup.diff;
    document.getElementById("sup-url-input").value = sup.url;
    document.getElementById("sup-name-input").value = sup.videoTitle === "手元動画" ? "" : sup.videoTitle;
    document.getElementById("sup-edit-index").value = index;
    document.getElementById("sup-form-title").innerText = "共有リンクを編集する";
    document.getElementById("btn-sup-submit").innerText = "更新する";
    document.getElementById("btn-sup-cancel").style.display = "inline-block";
}

function cancelSupplyEdit() {
    document.getElementById("sup-title-input").value = "";
    document.getElementById("sup-diff-input").value = "MAS";
    document.getElementById("sup-url-input").value = "";
    document.getElementById("sup-name-input").value = "";
    document.getElementById("sup-edit-index").value = "-1";
    document.getElementById("sup-form-title").innerText = "手元動画のリンクを共有する";
    document.getElementById("btn-sup-submit").innerText = "動画リンクを登録";
    document.getElementById("btn-sup-cancel").style.display = "none";
}

// ==========================================
// 6. 頭文字（前方一致）最優先サジェストロジック
// ==========================================
function updateSongSuggestions(searchText = "") {
    const datalist = document.getElementById("song-suggestions");
    if (!datalist) return;

    const targetData = (typeof myCurrentRecords !== 'undefined' ? myCurrentRecords : []);
    if (targetData.length === 0) return;

    const uniqueTitles = [...new Set(targetData.map(item => item.title))].filter(Boolean);

    if (searchText.trim() !== "") {
        const query = searchText.toLowerCase().trim();
        uniqueTitles.sort((a, b) => {
            const aStr = a.toLowerCase();
            const bStr = b.toLowerCase();
            const aStarts = aStr.startsWith(query);
            const bStarts = bStr.startsWith(query);

            if (aStarts && !bStarts) return -1;
            if (!aStarts && bStarts) return 1;
            return a.localeCompare(b, 'ja');
        });
    } else {
        uniqueTitles.sort((a, b) => a.localeCompare(b, 'ja'));
    }
    datalist.innerHTML = uniqueTitles.map(title => `<option value="${title}"></option>`).join("");
}

function initSongSuggestionListeners() {
    const reqInput = document.getElementById("req-title-input");
    const supInput = document.getElementById("sup-title-input");

    if (reqInput) {
        reqInput.addEventListener("input", (e) => {
            const val = e.target.value;
            updateSongSuggestions(val);
            renderVideoHubTables();
        });
    }
    if (supInput) {
        supInput.addEventListener("input", (e) => {
            const val = e.target.value;
            updateSongSuggestions(val);
            renderVideoHubTables();
        });
    }
}

function openSongRankingDirectly(songTitle, diff) {
    if (typeof loadRanking === "function") {
        loadRanking(songTitle, diff, null);
    }
}

// ==========================================
// 7. ランキング最下部への動画・リクエスト連動描画（防御力最大・リクエスト空白対応版）
// ==========================================
function updateRankingVideoSection(songTitle, diff, directVideoList = null) {
    const videoSection = document.getElementById("ranking-video-section");
    const videoList = document.getElementById("ranking-video-list");
    if (!videoSection || !videoList) return;

    videoSection.style.display = "block";

    const sectionHeader = videoSection.querySelector('h4');
    if (sectionHeader) sectionHeader.style.display = 'none';

    // 💡【原因解決の鍵】プレイヤー名を確実・安全に取得する
    if (!window.currentToolPlayerName || window.currentToolPlayerName.trim() === "") {
        window.currentToolPlayerName = localStorage.getItem('chunirec_player_name') || "";
    }
    const myPlayerName = window.currentToolPlayerName;

    const isDataLoading = (!directVideoList && (!window.liveSupplies || window.liveSupplies.length === 0));

    const rawSearchTitle = songTitle ? String(songTitle).trim().toLowerCase() : "";
    const searchDiffUpper = diff ? String(diff).trim().toUpperCase() : "";
    const isSearchWe = (searchDiffUpper === "WE" || searchDiffUpper.includes("WORLD") || searchDiffUpper.includes("END"));

    const cleanWeTitle = (str) => {
        return String(str || "").replace(/【[^】]+】/g, "").replace(/\s+/g, "").toLowerCase().trim();
    };
    const cleanSearchTitleWE = cleanWeTitle(songTitle);

    // ==========================================
    // 📦 A. リクエスト欄のデータ抽出
    // ==========================================
    let matchedRequests = [];
    if (!isDataLoading && window.liveRequests && window.liveRequests.length > 0) {
        matchedRequests = window.liveRequests.filter(req => {
            if (!req || !req.title) return false;
            const reqDiffUpper = req.diff ? String(req.diff).trim().toUpperCase() : "";
            const isReqWe = (reqDiffUpper.startsWith("WE") || reqDiffUpper.includes("WORLD") || reqDiffUpper.includes("END"));

            if (isSearchWe && isReqWe) {
                return cleanWeTitle(req.title) === cleanSearchTitleWE;
            }
            if (!isSearchWe && !isReqWe) {
                return (String(req.title).trim().toLowerCase() === rawSearchTitle) && (reqDiffUpper === searchDiffUpper);
            }
            return false;
        });
    }

    // ==========================================
    // 📦 B. 動画リンク欄のデータ抽出
    // ==========================================
    let matchedVideos = directVideoList;
    if (!matchedVideos) {
        if (isDataLoading) {
            matchedVideos = [];
        } else {
            matchedVideos = window.liveSupplies.filter(sup => {
                if (!sup || !sup.title) return false;
                const videoDiffUpper = sup.diff ? String(sup.diff).trim().toUpperCase() : "";
                const isVideoWe = (videoDiffUpper.startsWith("WE") || videoDiffUpper.includes("WORLD") || videoDiffUpper.includes("END"));

                if (isSearchWe && isVideoWe) {
                    const cleanVideoTitleWE = cleanWeTitle(sup.title);
                    return (
                        cleanVideoTitleWE === cleanSearchTitleWE ||
                        cleanVideoTitleWE.includes(cleanSearchTitleWE) ||
                        cleanSearchTitleWE.includes(cleanVideoTitleWE)
                    );
                }
                if (!isSearchWe && !isVideoWe) {
                    return (String(sup.title).trim().toLowerCase() === rawSearchTitle) && (videoDiffUpper === searchDiffUpper);
                }
                return false;
            });
        }
    }

    // ==========================================
    // 🎨 C. HTMLの組み立て
    // ==========================================
    let htmlContent = "";

    // ------------------------------------------
    // 📌 【第1ブロック】この譜面の手元等に関するリクエスト
    // ------------------------------------------
    htmlContent += `
        <div class="ranking-req-block" style="margin-bottom: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #e67e22; padding-bottom: 6px; margin-bottom: 10px; gap: 10px; flex-wrap: wrap;">
                <span style="margin: 0; font-size: 15px; font-weight: bold; color: #d35400; white-space: nowrap;">この譜面の手元等に関するリクエスト</span>
                <button class="btn-video-jump-req" onclick="jumpToVideoRequest('${songTitle.replace(/'/g, "\\'")}', '${diff}')" 
                    style="background: #e67e22; color: white; border: none; padding: 4px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; font-weight: bold; transition: 0.2s; white-space: nowrap;">
                    ＋ 新しくリクエストする
                </button>
            </div>
            <div class="ranking-req-list-inner">
    `;

    if (isDataLoading) {
        htmlContent += `<div style="color: #e67e22; font-size: 12px; padding: 6px 0; font-style: italic;">データを読み込み中...</div>`;
    } else if (matchedRequests.length > 0) {
        const tempReqContainer = document.createElement("div");

        matchedRequests.forEach(req => {
            const reqUser = req.user || req.requester || req.playerName || req.contributor || "名無しプレイヤー";
            const reqNote = req.note || req.comment || req.text || "";

            const reqItem = document.createElement("div");
            reqItem.style.cssText = "background: #fff5eb; border-left: 4px solid #e67e22; padding: 8px 10px; margin-bottom: 6px; border-radius: 0 4px 4px 0; font-size: 13px; position: relative; display: flex; justify-content: space-between; align-items: center; gap: 12px;";

            // 💡 上部で安全に確保した myPlayerName と比較
            const myNameClean = typeof myPlayerName === "string" ? myPlayerName.trim().toLowerCase() : "";
            const reqUserClean = typeof reqUser === "string" ? reqUser.trim().toLowerCase() : "";
            const isMyPost = (myNameClean !== "" && reqUserClean === myNameClean);

            let inlineReqActionHtml = "";
            if (isMyPost && req.id) {
                const globalReqIndex = window.liveRequests.findIndex(r => r && String(r.id) === String(req.id));
                if (globalReqIndex !== -1) {
                    inlineReqActionHtml = `
                        <div style="display: flex; gap: 4px; flex-shrink: 0;">
                            <button class="btn-video-action edit" onclick="event.stopPropagation(); jumpToVideoRequestEdit(${globalReqIndex})" style="background: #3498db; color: #ffffff; border: none; padding: 3px 6px; font-size: 11px; border-radius: 3px; cursor: pointer; transition: background 0.2s;">編集</button>
                            <button class="btn-video-action delete" onclick="event.stopPropagation(); deleteRequestItemFromRanking('${req.id}', '${songTitle.replace(/'/g, "\\'")}', '${diff}')" style="background: #e74c3c; color: #ffffff; border: none; padding: 3px 6px; font-size: 11px; border-radius: 3px; cursor: pointer; transition: background 0.2s;">削除</button>
                        </div>
                    `;
                }
            }

            const displayNote = reqNote.trim() !== "" ? `<strong style="color: #333; display: block; word-break: break-all; margin-bottom: 2px;">${reqNote}</strong>` : "";

            reqItem.innerHTML = `
                <div style="flex: 1; min-width: 0;">
                    ${displayNote}
                    <div style="font-size: 11px; color: #777;">リクエスト者: ${reqUser}</div>
                </div>
                ${inlineReqActionHtml}
            `;
            tempReqContainer.appendChild(reqItem);
        });
        htmlContent += tempReqContainer.innerHTML;
    } else {
        htmlContent += `<div style="color: #888; font-size: 12px; padding: 6px 0;">現在リクエストはありません。</div>`;
    }

    htmlContent += `
            </div>
        </div>
    `;

    // ------------------------------------------
    // 📌 【第2ブロック】この譜面の手元動画等のリンク
    // ------------------------------------------
    htmlContent += `
        <div class="ranking-video-block">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #2ecc71; padding-bottom: 6px; margin-bottom: 10px; gap: 10px; flex-wrap: wrap;">
                <span style="margin: 0; font-size: 15px; font-weight: bold; color: #27ae60; white-space: nowrap;">この譜面の手元動画等のリンク</span>
                <button class="btn-video-jump-sup" onclick="jumpToVideoSupply('${songTitle.replace(/'/g, "\\'")}', '${diff}')" 
                    style="background: #2ecc71; color: white; border: none; padding: 4px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; font-weight: bold; transition: 0.2s; white-space: nowrap;">
                    ＋ 新しくリンクを登録する
                </button>
            </div>
            <div class="ranking-video-list-inner">
    `;

    if (isDataLoading) {
        htmlContent += `<div style="color: #2ecc71; font-size: 12px; padding: 6px 0; font-style: italic;">データを読み込み中...</div>`;
    } else if (matchedVideos.length > 0) {
        const tempContainer = document.createElement("div");
        matchedVideos.forEach(video => {
            const videoUser = video.user || video.contributor || "名無しプレイヤー";
            const videoUrl = video.url || video.videoUrl || "#";
            const videoDisplayTitle = video.videoTitle || video.title || "手元動画";

            const videoItem = document.createElement("div");
            videoItem.className = "ranking-video-item";
            videoItem.style.cssText = "position: relative; background: #f9f9f9; padding: 8px; margin-bottom: 6px; border-radius: 4px; border: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; gap: 12px;";

            // 💡 上部で安全に確保した myPlayerName と比較
            const myNameClean = typeof myPlayerName === "string" ? myPlayerName.trim().toLowerCase() : "";
            const videoUserClean = typeof videoUser === "string" ? videoUser.trim().toLowerCase() : "";
            const isMyVideo = (myNameClean !== "" && videoUserClean === myNameClean);

            let inlineActionHtml = "";
            if (isMyVideo && video.id) {
                const globalIndex = window.liveSupplies.findIndex(s => s && s.id === video.id);
                if (globalIndex !== -1) {
                    inlineActionHtml = `
                        <div style="display: flex; gap: 4px; flex-shrink: 0;">
                            <button class="btn-video-action edit" onclick="event.stopPropagation(); jumpToVideoSupplyEdit(${globalIndex})" style="background: #3498db; color: #ffffff; border: none; padding: 3px 6px; font-size: 11px; border-radius: 3px; cursor: pointer; transition: background 0.2s;">編集</button>
                            <button class="btn-video-action delete" onclick="event.stopPropagation(); deleteVideoItemFromRanking('${video.id}', '${songTitle.replace(/'/g, "\\'")}', '${diff}')" style="background: #e74c3c; color: #ffffff; border: none; padding: 3px 6px; font-size: 11px; border-radius: 3px; cursor: pointer; transition: background 0.2s;">削除</button>
                        </div>
                    `;
                }
            }

            videoItem.innerHTML = `
                <div class="video-item-left" style="flex: 1; min-width: 0;">
                    <a href="${videoUrl}" target="_blank" class="video-item-url" onclick="event.stopPropagation();" style="display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: bold; color: #3498db; font-size: 13px;">${videoDisplayTitle}</a>
                    <span class="video-item-title" style="font-size: 11px; color: #777;">提供: ${videoUser}</span>
                </div>
                ${inlineActionHtml}
            `;
            tempContainer.appendChild(videoItem);
        });
        htmlContent += tempContainer.innerHTML;
    } else {
        htmlContent += `<div style="color: #888; font-size: 12px; padding: 6px 0;">現在登録されているリンクはありません。</div>`;
    }

    htmlContent += `
            </div>
        </div>
    `;

    videoList.innerHTML = htmlContent;
}

function jumpToVideoSupplyEdit(globalIndex) {
    const rankingModal = document.getElementById('ranking-modal');
    if (rankingModal) rankingModal.style.display = "none";

    openVideoHubModal().then(() => {
        switchVideoTab('supply');

        if (typeof startSupplyEdit === 'function') {
            startSupplyEdit(globalIndex);

            const urlInput = document.getElementById("sup-url-input");
            if (urlInput) urlInput.focus();
        }
    });
}

async function deleteVideoItemFromRanking(id, songTitle, diff) {
    if (!confirm("この動画リンクを削除してもよろしいですか？")) return;

    try {
        const response = await fetch(GAS_URL, {
            method: "POST",
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                mode: "delete_video_item",
                id: id,
                user: currentToolPlayerName
            })
        });
        const result = await response.json();
        if (result.status === "success") {
            alert("動画リンクを削除しました。");
            await fetchVideoHubData();
            updateRankingVideoSection(songTitle, diff);
        } else {
            alert("エラー: " + result.message);
        }
    } catch (e) {
        alert("通信に失敗しました。");
    }
}

/**
 * 💡 ランキング画面から特定のリクエストの「編集」を押したときのジャンプ処理
 */
function jumpToVideoRequestEdit(globalReqIndex) {
    const rankingModal = document.getElementById('ranking-modal');
    if (rankingModal) rankingModal.style.display = "none";

    openVideoHubModal().then(() => {
        // リクエスト（求む）側のタブを開く
        switchVideoTab('request');

        // 動画ハブ側に元々あるリクエスト編集開始関数を呼び出す
        if (typeof startRequestEdit === 'function') {
            startRequestEdit(globalReqIndex);

            // コメント入力欄に自動フォーカス
            const noteInput = document.getElementById("req-note-input");
            if (noteInput) noteInput.focus();
        }
    });
}

/**
 * 💡 ランキング画面からダイレクトにリクエストを削除する処理
 */
async function deleteRequestItemFromRanking(id, songTitle, diff) {
    if (!confirm("このリクエストを削除してもよろしいですか？")) return;

    try {
        const response = await fetch(GAS_URL, {
            method: "POST",
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                mode: "delete_video_item", // 💡 GAS側が共通化されている前提
                id: id,
                user: currentToolPlayerName
            })
        });
        const result = await response.json();
        if (result.status === "success") {
            alert("リクエストを削除しました。");

            // 最新データを再取得（グローバル変数の liveRequests が更新される）
            await fetchVideoHubData();

            // ランキング最下部を再描画
            updateRankingVideoSection(songTitle, diff);
        } else {
            alert("エラー: " + result.message);
        }
    } catch (e) {
        console.error(e);
        alert("通信に失敗しました。");
    }
}

window.openVideoHubModal = openVideoHubModal;
window.closeVideoHubModal = closeVideoHubModal;



/**
 * モーダルの内容を画像化してDiscordへ送信
 * @param {string} modalId - 送信対象モーダルのID ('rating-modal' または 'ranking-modal')
 */
async function shareToDiscord(modalId = 'rating-modal') {
    let webhookUrl = localStorage.getItem('discord_webhook_url');

    // 💡 Webhook URL の簡易検証関数
    const isValidDiscordUrl = (url) => {
        if (!url || typeof url !== 'string') return false;
        const trimmed = url.trim();
        return trimmed.startsWith('https://discord.com/api/webhooks/') ||
            trimmed.startsWith('https://canary.discord.com/api/webhooks/');
    };

    // 保存されているURLが無効な形式の場合はクリア
    if (webhookUrl && !isValidDiscordUrl(webhookUrl)) {
        localStorage.removeItem('discord_webhook_url');
        webhookUrl = null;
    }

    if (!webhookUrl) {
        webhookUrl = prompt("DiscordのWebhook URLを入力してください。\n(https://discord.com/api/webhooks/... で始まるURL)");
        if (webhookUrl && isValidDiscordUrl(webhookUrl)) {
            webhookUrl = webhookUrl.trim();
            localStorage.setItem('discord_webhook_url', webhookUrl);
        } else if (webhookUrl) {
            alert("入力されたURLの形式が正しくありません。\nhttps://discord.com/api/webhooks/ から始まるURLを入力してください。");
            return;
        } else {
            return;
        }
    }

    const targetModal = document.getElementById(modalId);
    if (!targetModal) return;

    const modalContent = targetModal.querySelector('.modal-content');
    const sendBtn = targetModal.querySelector('.discord-btn');

    if (!modalContent || !sendBtn) return;

    // UIを送信中状態に変更
    sendBtn.innerText = "送信中...";
    sendBtn.disabled = true;
    sendBtn.classList.add('sending');

    let clonedContainer = null;

    try {
        // 💡 撮影専用クローンを一時生成
        clonedContainer = modalContent.cloneNode(true);

        // 💡【キャンバスの複製】Chart.js等のcanvas描画内容をクローン側にコピー
        const originalCanvases = modalContent.querySelectorAll('canvas');
        const clonedCanvases = clonedContainer.querySelectorAll('canvas');
        originalCanvases.forEach((origCanvas, idx) => {
            if (clonedCanvases[idx]) {
                const destCtx = clonedCanvases[idx].getContext('2d');
                destCtx.drawImage(origCanvas, 0, 0);
            }
        });

        // 💡【不要要素の削除】
        const clonedFooter = clonedContainer.querySelector('.modal-footer');
        if (clonedFooter) clonedFooter.remove();

        const clonedVideoSection = clonedContainer.querySelector('#ranking-video-section, .ranking-video-box');
        if (clonedVideoSection) clonedVideoSection.remove();

        const updateBtns = clonedContainer.querySelectorAll('.range-selector ~ button, header button');
        updateBtns.forEach(btn => btn.remove());

        // 💡【強力余白対策1】クローン全体の高さを可変（fit-content）に強制固定
        Object.assign(clonedContainer.style, {
            position: 'fixed',
            top: '-9999px',
            left: '0',
            width: '1050px',
            maxWidth: '1050px',
            minWidth: '1050px',
            padding: '20px 24px',
            height: 'fit-content',
            minHeight: '0px',
            maxHeight: 'none',
            overflow: 'hidden',
            boxSizing: 'border-box',
            opacity: '1',
            visibility: 'visible',
            pointerEvents: 'none',
            display: 'block' // flex構造を解除してブロック化
        });

        // 💡【強力余白対策2】全配下要素の flex 伸ばし・最小高さをすべて強制リセット
        const allElements = clonedContainer.querySelectorAll('*');
        allElements.forEach(el => {
            el.style.flex = '0 0 auto';
            el.style.flexGrow = '0';
            el.style.minHeight = '0px';
            el.style.maxHeight = 'none';
            if (el.tagName !== 'CANVAS' && el.tagName !== 'IMG') {
                el.style.height = 'auto';
            }
        });

        // 💡 2カラムレイアウトの再適用（親がblock化されたため明示的に指定）
        const clonedGrid = clonedContainer.querySelector('.two-column-grid');
        if (clonedGrid) {
            clonedGrid.style.display = 'grid';
            clonedGrid.style.gridTemplateColumns = '1fr 1fr';
            clonedGrid.style.gap = '20px';
            clonedGrid.style.height = 'auto';
        }

        // thead の sticky（固定表示）を解除
        const theads = clonedContainer.querySelectorAll('table thead');
        theads.forEach(th => {
            th.style.position = 'static';
            th.style.display = 'table-header-group';
        });

        const thCells = clonedContainer.querySelectorAll('table th');
        thCells.forEach(cell => {
            cell.style.position = 'static';
            cell.style.top = 'auto';
        });

        document.body.appendChild(clonedContainer);
        sendBtn.innerText = "作成中...";

        await new Promise(resolve => setTimeout(resolve, 200));

        // 💡【強力余白対策3】コンテンツの最下部要素の位置を算出して正確な描画高さを決める
        const targetWidth = clonedContainer.offsetWidth;
        const lastChild = clonedContainer.lastElementChild;
        let targetHeight = clonedContainer.offsetHeight;

        if (lastChild) {
            const containerRect = clonedContainer.getBoundingClientRect();
            const lastChildRect = lastChild.getBoundingClientRect();
            targetHeight = Math.ceil(lastChildRect.bottom - containerRect.top) + 20;
        }

        // html2canvas 実行
        const canvas = await html2canvas(clonedContainer, {
            backgroundColor: "#ffffff",
            scale: 2,
            useCORS: true,
            allowTaint: true,
            width: targetWidth,
            height: targetHeight,
            windowWidth: 1200,
            windowHeight: targetHeight,
            scrollY: 0,
            scrollX: 0
        });

        // 💡 canvas.toBlob を Promise 化
        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob((b) => {
                if (b) resolve(b);
                else reject(new Error("画像の生成に失敗しました (Blob生成エラー)"));
            }, "image/png");
        });

        sendBtn.innerText = "送信中...";

        const formData = new FormData();
        formData.append("file", blob, `share_${Date.now()}.png`);
        formData.append("payload_json", JSON.stringify({ content: "みろよみろよ" }));

        // 💡 15秒のタイムアウト制御
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(webhookUrl, {
            method: "POST",
            body: formData,
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
            alert("Discordに送信しました！");
        } else {
            const status = response.status;
            let errorMsg = `送信に失敗しました (ステータスコード: ${status})`;

            if (status === 429) {
                errorMsg = "連続送信の制限（レートリミット）がかかっています。数秒待ってから再試行してください。";
            } else if (status === 404 || status === 401) {
                errorMsg = "Webhook URLが無効または削除されています。";
            } else if (status === 413) {
                errorMsg = "画像ファイルサイズが大きすぎるためDiscordで受信できませんでした。";
            }

            if (confirm(`${errorMsg}\n\n保存されているWebhook URLをクリアしてリセットしますか？`)) {
                localStorage.removeItem('discord_webhook_url');
            }
        }

    } catch (err) {
        console.error("Discord送信エラー:", err);

        let alertMsg = "送信処理中にエラーが発生しました。";
        if (err.name === 'AbortError') {
            alertMsg = "タイムアウト: 通信に時間がかかりすぎたため処理を中断しました。";
        } else if (err.name === 'TypeError' && err.message.includes('fetch')) {
            alertMsg = "【通信エラー (Failed to fetch)】\nWebhook URLが間違っているか、ネットワーク/ブラウザによって通信が遮断されました。";
        } else if (err.message) {
            alertMsg += `\n内容: ${err.message}`;
        }

        // 💡 catch 時にも URL のリセット機会を提供する
        if (confirm(`${alertMsg}\n\n登録されているWebhook URLをクリアしてリセットしますか？`)) {
            localStorage.removeItem('discord_webhook_url');
        }

    } finally {
        if (clonedContainer && document.body.contains(clonedContainer)) {
            document.body.removeChild(clonedContainer);
        }
        sendBtn.innerText = "Discordに送信";
        sendBtn.disabled = false;
        sendBtn.classList.remove('sending');
    }
}


/**
 * ログアウト処理
 * キャッシュをクリアして画面をリロードする
 */
function logout() {
    if (confirm("ログアウトしますか？（保存されたスコアやトークンが消去されます）")) {
        // localStorageのデータを削除
        localStorage.removeItem('chunirec_token');
        localStorage.removeItem('chunirec_scores');
        localStorage.removeItem('chunirec_player_name');
        localStorage.removeItem('chunirec_cache_time');

        // ページをリロードして初期画面に戻す
        window.location.reload();
    }
}
