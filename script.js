const GAS_URL = "https://script.google.com/macros/s/AKfycbwmfWR-hxo5U_xmnCVDQH4WRlxV-rRtzd_ygL-v2csdDPGN_royidW6Or49toubi-xRBg/exec"

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
 * 起動時に実行
 */
window.onload = function () {
    initFilters();
};

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

/**
 * 💡 ページ読み込み完了時の初期化・統合処理
 */
document.addEventListener('DOMContentLoaded', async () => {
    // 1. プレイヤー選択用セレクトボックス一覧の取得
    if (typeof fetchPlayerNames === 'function') {
        await fetchPlayerNames();
    }

    // 2. URLパラメータのチェック（ブックマークレットからの自動遷移時: ?player=〇〇）
    const urlParams = new URLSearchParams(window.location.search);
    const targetPlayerFromUrl = urlParams.get("player");

    // 保存されているトークンとキャッシュの取得
    const savedToken = localStorage.getItem('chunirec_token');
    const cachedData = localStorage.getItem('chunirec_scores');
    const savedName = localStorage.getItem('chunirec_player_name');

    // トークンフォームの初期値復元
    const tokenInput = document.getElementById('token-input');
    if (tokenInput && savedToken) {
        tokenInput.value = savedToken;
    }

    // =========================================================================
    // パターンA: ブックマークレットから遷移してきた場合 (?player=〇〇)
    // =========================================================================
    if (targetPlayerFromUrl) {
        console.log(`ブックマークレットからの遷移を検出: ${targetPlayerFromUrl}`);

        // 古い画面キャッシュを削除
        localStorage.removeItem('chunirec_scores');
        localStorage.setItem('chunirec_player_name', targetPlayerFromUrl);

        // 画面切り替え（トークン画面を隠してメイン画面を表示）
        const tokenScreen = document.getElementById("token-screen");
        const mainScreen = document.getElementById("main-screen");
        if (tokenScreen) tokenScreen.style.display = "none";
        if (mainScreen) mainScreen.style.display = "block";

        // URLパラメータを削除してアドレスバーを整形（?player=〇〇 を消す）
        window.history.replaceState({}, document.title, window.location.pathname);

        // 💡 新設した関数で対象プレイヤーの最新データを取得して描画
        if (typeof loadPlayerDataByName === 'function') {
            await loadPlayerDataByName(targetPlayerFromUrl);
        } else if (typeof getPlayerDataByName === 'function') {
            await getPlayerDataByName(targetPlayerFromUrl);
        } else if (typeof loadScores === 'function') {
            await loadScores();
        }
        return;
    }

    // =========================================================================
    // パターンB: 通常アクセス（トークンあり → 自動再同期）
    // =========================================================================
    if (savedToken) {
        console.log("トークンを検出しました。自動再同期を開始します...");

        const btn = document.querySelector('.refresh-btn');
        let originalText = "";
        if (btn) {
            originalText = btn.innerText;
            btn.disabled = true;
            btn.innerText = "自動同期中...";
        }

        await new Promise(resolve => setTimeout(resolve, 50));

        let isSuccess = false;
        if (typeof loadScores === 'function') {
            isSuccess = await loadScores();
        }

        if (btn) {
            btn.disabled = false;
            btn.innerText = originalText;
        }

        if (isSuccess) {
            console.log("起動時自動同期が正常完了しました");
        } else {
            console.warn("起動時自動同期に失敗しました");
        }
        return;
    }

    // =========================================================================
    // パターンC: トークンなし ＋ キャッシュありの場合のローカル表示
    // =========================================================================
    if (cachedData && cachedData !== "undefined" && savedName) {
        try {
            myCurrentRecords = JSON.parse(cachedData);

            const tokenScreen = document.getElementById("token-screen");
            const mainScreen = document.getElementById("main-screen");
            if (tokenScreen) tokenScreen.style.display = "none";
            if (mainScreen) mainScreen.style.display = "block";

            if (typeof calculatechuniRate === 'function') calculatechuniRate(savedName);
            if (typeof displayScores === 'function') displayScores(myCurrentRecords);
        } catch (e) {
            console.error("キャッシュ破損のため初期化します", e);
            if (typeof clearUserCache === 'function') clearUserCache();
        }
        return;
    }

    // =========================================================================
    // パターンD: 初回アクセス（トークンもキャッシュもなし）
    // =========================================================================
    const tokenScreen = document.getElementById("token-screen");
    const mainScreen = document.getElementById("main-screen");
    if (tokenScreen) tokenScreen.style.display = "block";
    if (mainScreen) mainScreen.style.display = "none";
});

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
 */
async function refreshScores() {
    const btn = document.querySelector('.refresh-btn');
    if (!btn || btn.disabled) return;

    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "同期中...";

    await new Promise(resolve => setTimeout(resolve, 50));

    const isSuccess = await loadScores();

    btn.disabled = false;
    btn.innerText = originalText;
    btn.blur();

    if (isSuccess) {
        alert("データの再同期が正常に完了しました！");
    } else {
        const errorMsgEl = document.getElementById("token-error");
        const errMsg = errorMsgEl ? errorMsgEl.innerText : "認証・同期エラー";
        alert("同期に失敗しました。\n" + errMsg);
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
    if (typeof displayScores === 'function') displayScores(myCurrentRecords);
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

    // Rank / スコア切り替え用
    const filterModeSelect = document.getElementById('filter-mode');
    const rankMinSelect = document.getElementById('rank-min');
    const rankMaxSelect = document.getElementById('rank-max');
    const minScoreInput = document.getElementById('min-score');
    const maxScoreInput = document.getElementById('max-score');

    if (!searchInput || !minConstSelect || !maxConstSelect || !rankMinSelect || !rankMaxSelect || !lampSelect) return;

    const searchText = searchInput.value.toLowerCase().trim();
    const minConst = parseFloat(minConstSelect.value);
    const maxConst = parseFloat(maxConstSelect.value);

    // 切り替えモード（"rank" または "score"）を取得
    const filterMode = filterModeSelect ? filterModeSelect.value : 'rank';
    const rankMin = parseFloat(rankMinSelect.value);
    const rankMax = parseFloat(rankMaxSelect.value);

    // スコア入力の値を取得
    const minScoreVal = minScoreInput ? minScoreInput.value : "";
    const maxScoreVal = maxScoreInput ? maxScoreInput.value : "";
    const minScore = minScoreVal !== "" ? parseFloat(minScoreVal) : 0;
    const maxScore = maxScoreVal !== "" ? parseFloat(maxScoreVal) : 1010000;

    const minRateVal = minRateInput ? minRateInput.value : "";
    const maxRateVal = maxRateInput ? maxRateInput.value : "";

    const minRate = minRateVal !== "" ? parseFloat(minRateVal) : 0;
    const maxRate = maxRateVal !== "" ? parseFloat(maxRateVal) : 99.99;

    const lampValue = lampSelect.value;

    // トレンド有効化スイッチの状態およびアクティブな傾向を取得
    const trendSwitch = document.getElementById('trend-enable-switch');
    const isTrendEnabled = trendSwitch ? trendSwitch.checked : false;
    const activeTrends = Array.from(document.querySelectorAll('.btn-trend-filter.active')).map(btn => btn.getAttribute('data-trend'));

    // アクティブな難易度（diff）を取得
    const activeDiffs = Array.from(document.querySelectorAll('.btn-diff-filter.active')).map(btn => btn.getAttribute('data-diff'));

    // フィルタリング実行
    const filteredData = myCurrentRecords.filter(item => {
        // 1. 曲名で絞り込み
        const title = String(item.title || "").toLowerCase();
        const matchesTitle = title.includes(searchText);

        // 2. Ratingで絞り込み
        const currentRate = parseFloat(item.rating) || 0;
        const matchesRating = (currentRate >= minRate && currentRate <= maxRate);

        // 3. 難易度（diff）で絞り込み
        const itemDiff = String(item.diff || "").toUpperCase();
        const matchesDiff = activeDiffs.includes(itemDiff);

        // 4. 定数で絞り込み
        const constant = parseFloat(item.const) || 0;
        const isWeExempt = (itemDiff === "WE" && activeDiffs.includes("WE"));
        const matchesConstant = isWeExempt || (constant >= minConst && constant <= maxConst);

        // 5. Rank または スコア で絞り込み
        const tScore = parseFloat(item.score) || 0;
        let matchesRankOrScore = true;

        if (filterMode === 'rank') {
            matchesRankOrScore = (tScore >= rankMin && tScore <= getUpperLimit(rankMax));
        } else {
            matchesRankOrScore = (tScore >= minScore && tScore <= maxScore);
        }

        // 6. ランプで絞り込み
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

        // 7. 表示対象（全曲/旧曲/新曲）判定
        let matchesType = true;
        if (currentTypeFilter === 'old') matchesType = !item.isNew;
        if (currentTypeFilter === 'new') matchesType = item.isNew;

        // 💡 8. トレンド判定（絞り込みは行わず、全楽曲を通す）
        const matchesTrend = true;

        return matchesTitle && matchesRating && matchesDiff && matchesConstant && matchesRankOrScore && matchesLamp && matchesType && matchesTrend;
    });

    // 9. ソートの実行（POWER等の数値順含む）
    sortData(filteredData);

    // 10. 描画
    displayScores(filteredData);

    // 💡 11. ソートボタンのラベル・色更新
    updateSortButtonLabels();

    // =================================================================
    // 💡 適用中のフィルター条件をバッジでリアルタイム表示
    // =================================================================
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

        // 💡 トレンドバッジ表記を「表示切替中」へ調整
        if (isTrendEnabled && activeTrends.length > 0) {
            addBadge(`表示切替: ${activeTrends[0]}`);
        }

        if (hasActiveFilter) {
            activeContainer.style.display = 'flex';
        } else {
            activeContainer.style.display = 'none';
        }
    }
}

/**
 * フィルター初期化（傾向フィルターの単一選択化を追加）
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
                btn.classList.remove('active'); // トグルON時も最初は非選択
                if (isEnabled) {
                    btn.classList.remove('trend-disabled');
                } else {
                    btn.classList.add('trend-disabled');
                }
            });
            updateFilters();
        });
    }

    // 💡【修正】傾向フィルターの単一選択（ラジオボタン挙動）クリックイベント
    document.querySelectorAll('.btn-trend-filter').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (trendSwitch && !trendSwitch.checked) return;

            const targetBtn = e.target;
            const isAlreadyActive = targetBtn.classList.contains('active');

            // 一旦すべての傾向ボタンのactiveを解除
            document.querySelectorAll('.btn-trend-filter').forEach(b => b.classList.remove('active'));

            // 既に選択されていたボタンでなければactiveを付与（トグル解除も可能）
            if (!isAlreadyActive) {
                targetBtn.classList.add('active');
            }

            updateFilters();
        });
    });

    // リセットボタン
    const clearBtn = document.getElementById('clear-filter');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
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
            document.getElementById('filter-all').classList.add('active');
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

            updateSortButtonLabels();
            updateFilters();
        });
    }

// ソート切り替えボタン
    const sortRatingBtn = document.getElementById('sort-Rating');
    const sortScoreBtn = document.getElementById('sort-score');
    if (sortRatingBtn) {
        sortRatingBtn.addEventListener('click', () => {
            currentSortKey = 'rating';
            sortRatingBtn.classList.add('active');
            sortScoreBtn.classList.remove('active');
            updateSortButtonLabels(); 
            updateFilters();
        });
    }
    if (sortScoreBtn) {
        sortScoreBtn.addEventListener('click', () => {
            currentSortKey = 'techScore';
            sortScoreBtn.classList.add('active');
            sortRatingBtn.classList.remove('active');
            updateSortButtonLabels(); 
            updateFilters();
        });
    }
}

/**
 * 💡 ソートボタンのラベルおよび背景スタイルを動的に切り替える関数
 */
function updateSortButtonLabels() {
    const sortRatingBtn = document.getElementById('sort-Rating');
    const sortScoreBtn = document.getElementById('sort-score');
    if (!sortRatingBtn || !sortScoreBtn) return;

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
        } else if (sortScoreBtn.classList.contains('active')) {
            sortScoreBtn.style.backgroundColor = activeColor;
            sortScoreBtn.style.color = '#ffffff';
            sortScoreBtn.style.borderColor = activeColor;

            sortRatingBtn.style.backgroundColor = '';
            sortRatingBtn.style.color = '';
            sortRatingBtn.style.borderColor = '';
        }
    } else {
        // 💡 傾向OFF時：通常ラベルへ戻し、インラインCSSをクリア（デフォルトの黒背景/白文字に戻る）
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

    // 1. 現在アクティブな傾向（POWER, NOTES, CHUNI, TRICKY）を取得
    const trendSwitch = document.getElementById('trend-enable-switch');
    const isTrendEnabled = trendSwitch ? trendSwitch.checked : false;
    const activeTrendBtn = isTrendEnabled ? document.querySelector('.btn-trend-filter.active') : null;
    const selectedTrend = activeTrendBtn ? activeTrendBtn.getAttribute('data-trend') : null;

    // 2. ソート実行
    data.sort((a, b) => {
        // 💡 傾向フィルターがON（傾向が選択されている）の場合
        if (selectedTrend) {
            if (currentSortKey === 'rating') {
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
            // 💡 傾向フィルターがOFFの場合（今まで通り）
            if (currentSortKey === 'rating') {
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
 * 💡 ユーザー名一覧を取得して表示を更新（fetch統一版）
 */
async function fetchPlayerNames() {
    try {
        const response = await fetch(GAS_URL, {
            method: "POST",
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ mode: "get_vs_players" }) // 既存のプレイヤー取得APIを共通利用
        });
        const result = await response.json();

        if (result.status === "success" && Array.isArray(result.players)) {
            console.log("取得できたユーザー一覧:", result.players);
            allPlayerNames = result.players;

            // モーダルが開いていれば再描画して選択肢を更新
            if (document.getElementById('modal-tab-content')) {
                renderTabContent(currentTab);
            }
        } else {
            console.warn("ユーザー一覧の取得に失敗しました:", result.message);
        }
    } catch (e) {
        console.error("ユーザー一覧取得の通信エラー:", e);
    }
}


/**
 * 💡 プレイヤー選択ドロップダウン変更時の処理（fetch統一版）
 */
async function handlePlayerChange(selectedName) {
    currentModalPlayerName = selectedName;

    const container = document.getElementById('modal-tab-content');
    if (container) {
        container.innerHTML = "<p style='text-align:center; padding: 20px;'>データを読み込み中...</p>";
    }

    // 既にキャッシュがあればそれを使用して再描画
    if (allUsersRecords[selectedName]) {
        renderTabContent(currentTab);
        return;
    }

    // GASへデータ取得リクエスト
    try {
        const response = await fetch(GAS_URL, {
            method: "POST",
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ mode: "get_player_data", playerName: selectedName })
        });
        const result = await response.json();

        if (result.status === "success") {
            allUsersRecords[selectedName] = result.records || [];
            renderTabContent(currentTab);
        } else {
            alert("データの取得に失敗しました: " + result.message);
        }
    } catch (e) {
        console.error("通信エラー:", e);
        alert("通信に失敗しました。");
    }
}

/**
 * タブ内容の生成（ドロップダウンでのプレイヤー切替、平均、左右2列リスト）
 */
function renderTabContent(tabKey) {
    const container = document.getElementById('modal-tab-content');
    if (!container) return;

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
            songs = getTopAbilitySongs(targetData, "tairyoku", 30).map(s => ({
                ...s,
                displayConst: getRawConstant(s, "rawTairyoku", "tairyoku")
            }));
            break;

        case 'notes':
            tabTitle = "NOTES";
            colorClass = "color-notes";
            columnHeader = "NOTES";
            songs = getTopAbilitySongs(targetData, "kenban", 30).map(s => ({
                ...s,
                displayConst: getRawConstant(s, "rawKenban", "kenban")
            }));
            break;

        case 'chuni':
            tabTitle = "CHUNI";
            colorClass = "color-chuni";
            columnHeader = "CHUNI";
            songs = getTopAbilitySongs(targetData, "chuni", 30).map(s => ({
                ...s,
                displayConst: getRawConstant(s, "rawChuni", "chuni")
            }));
            break;

        case 'tricky':
            tabTitle = "TRICKY";
            colorClass = "color-tricky";
            columnHeader = "TRICKY";
            songs = getTopAbilitySongs(targetData, "kuse", 30).map(s => ({
                ...s,
                displayConst: getRawConstant(s, "rawKuse", "kuse")
            }));
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

    // 💡 取得済みの全プレイヤーリスト（allPlayerNames）とキャッシュのキーからドロップダウン選択肢を作成
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

    let html = `
        <div class="modal-header-summary">
            <!-- 💡 プレイヤー選択ドロップダウン -->
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
 * 能力値ソート用ヘルパー
 */
function getTopAbilitySongs(data, key, count) {
    return data
        .filter(s => (parseFloat(s[key]) || 0) > 0)
        .map(s => ({ ...s, calcVal: parseFloat(s[key]) || 0 }))
        .sort((a, b) => b.calcVal - a.calcVal)
        .slice(0, count);
}

/**
 * 💡 生定数を安全に取得（0.0の場合は補正値とスコアから逆算、それも不可能な場合は定数を代用）
 */
function getRawConstant(item, rawKey, modifiedKey) {
    // 1. すでに raw 値が存在すればそれを使用
    const rawVal = parseFloat(item[rawKey] || 0);
    if (rawVal > 0) return rawVal.toFixed(1);

    // 2. 補正後値とスコアが存在すれば逆算する
    const modifiedVal = parseFloat(item[modifiedKey] || 0);
    const score = parseInt(item.score || 0, 10);
    const lamp = String(item.lamp || "");

    if (modifiedVal > 0 && score > 0 && typeof calculateScoreModifier === "function") {
        const mod = calculateScoreModifier(score, lamp);
        if (mod > 0) {
            const calculatedRaw = modifiedVal / mod;
            return calculatedRaw.toFixed(1);
        }
    }

    // 3. 逆算も不可能な場合は曲の譜面定数(const)をフォールバックとして表示
    const fallbackConst = parseFloat(item.const || 0);
    return fallbackConst > 0 ? fallbackConst.toFixed(1) : "0.0";
}


/**
 * 画面にスコアを表示する（全曲中上位30曲ハイライト対応 ＆ 判定失点数完全対応版）
 */
function displayScores(data) {
    console.log("--- displayScores開始 ---");

    const body = document.getElementById('score-body');
    if (!body) return;

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

    const ratingHeader = document.getElementById('rating-header') || document.querySelector('thead th:last-child');

    if (ratingHeader) {
        if (selectedTrend === 'POWER') {
            ratingHeader.textContent = "POWER値";
        } else if (selectedTrend === 'NOTES') {
            ratingHeader.textContent = "NOTES値";
        } else if (selectedTrend === 'CHUNI') {
            ratingHeader.textContent = "CHUNI値";
        } else if (selectedTrend === 'TRICKY') {
            ratingHeader.textContent = "TRICKY値";
        } else {
            ratingHeader.textContent = "単曲レート";
        }
    }

    if (!data || data.length === 0) {
        body.innerHTML = "<tr><td colspan='5'>表示できるデータがありません</td></tr>";
        return;
    }

    const top30Set = new Set();
    if (selectedTrend) {
        const sourceData = (typeof myCurrentRecords !== "undefined" && Array.isArray(myCurrentRecords) && myCurrentRecords.length > 0)
            ? myCurrentRecords 
            : data;

        const getVal = (item) => {
            if (selectedTrend === 'POWER') return parseFloat(item.tairyoku ?? item.rawTairyoku ?? 0);
            if (selectedTrend === 'NOTES') return parseFloat(item.kenban ?? item.rawKenban ?? 0);
            if (selectedTrend === 'CHUNI') return parseFloat(item.chuni ?? item.rawChuni ?? 0);
            if (selectedTrend === 'TRICKY') return parseFloat(item.kuse ?? item.rawKuse ?? 0);
            return 0;
        };

        [...sourceData]
            .sort((a, b) => getVal(b) - getVal(a))
            .slice(0, 30)
            .forEach(item => {
                if (item && item.title && item.diff) {
                    const key = `${item.title}_${item.diff}`;
                    top30Set.add(key);
                }
            });
    }

    body.innerHTML = "";
    const fragment = document.createDocumentFragment();
    const limitedData = data.slice(0, 200);

    limitedData.forEach((item, index) => {
        const diffRaw = String(item.diff || "");
        const diffLower = diffRaw.toLowerCase();
        const isWE = (diffRaw.toUpperCase() === "WE");
        const isNew = isNewSongCheck(item.isNew); // 💡 安全にboolean化

        const currentConst = parseFloat(item.const) || 0;
        const tScore = parseFloat(item.score) || 0;
        const RatingNum = parseFloat(item.rating) || 0;

        let diffLevelHtml = "";
        let RatingHtml = "-";

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
            const coloredCostHtml = `<span style="color: ${activeColor}; font-weight: bold;">${displayCostStr}</span>`;

            if (isWE) {
                const attr = item.weAttr || item.attribute || "";
                diffLevelHtml = `WORLD'S END ${attr ? `【${attr}】` : ""}`;
            } else {
                diffLevelHtml = `${diffRaw} ${coloredCostHtml}`;
            }

            const ratingStr = ratingVal > 0 ? ratingVal.toFixed(2) : "-";
            RatingHtml = `<span style="color: ${activeColor}; font-weight: bold;">${ratingStr}</span>`;

        } else {
            if (isWE) {
                const attr = item.weAttr || item.attribute || "";
                diffLevelHtml = `WORLD'S END ${attr ? `【${attr}】` : ""}`;
            } else {
                const displayLevel = currentConst > 0 ? currentConst.toFixed(1) : "-";
                diffLevelHtml = `${diffRaw} ${displayLevel}`;
            }

            const ratingStr = (!isWE && RatingNum > 0)
                ? (Math.floor((RatingNum + 0.000001) * 100) / 100).toFixed(2)
                : "-";
            RatingHtml = ratingStr;
        }

        // ランプおよび内訳描画
        let lampHtml = "";
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
                lampHtml = `<span class="${comboClass}">${lampText}</span>`;
                const jCount = Math.round(jTotal);
                if (!lampText.includes("AJC") && jCount > 0) {
                    lampHtml += `<div class="justice-count" style="font-size: 0.75rem; color: #ff9500; font-weight: bold; margin-top: 2px;">-${jCount}</div>`;
                }
            } else if (lampText.includes("FC")) {
                lampHtml = `<span class="${comboClass}">${lampText}</span>`;
                if (jTotal >= 51 && jTotal <= 101) {
                    lampHtml += `<div class="attack-count" style="font-size: 0.75rem; color: #2ecc71; font-weight: bold; margin-top: 2px;">-1</div>`;
                }
            } else {
                if (jTotal >= 101 && jTotal <= 151) {
                    lampHtml = `<span style="color: #888888; font-weight: bold; font-size: 0.85rem;">-1</span>`;
                } else {
                    lampHtml = "-";
                }
            }
        } else if (lampText) {
            lampHtml = `<span class="${comboClass}">${lampText}</span>`;
        }

        const newBadge = isNew ? `<span class="new-song-label">NEW</span>` : "";

        let trendHtml = "";
        if (!selectedTrend && item.mainTrend && item.mainTrend !== "None") {
            const trendColor = colorMap[item.mainTrend] || "#555";
            trendHtml = ` / <span style="color: ${trendColor};">${item.mainTrend}</span>`;
        }

        const tr = document.createElement('tr');
        tr.className = diffLower;
        tr.style.cursor = "pointer";

        tr.onclick = () => {
            if (typeof loadRanking === "function") {
                loadRanking(item.title, diffRaw, item.const);
            }
        };

        if (selectedTrend) {
            const itemKey = `${item.title}_${item.diff}`;
            if (top30Set.has(itemKey)) {
                const trendClass = `is-${selectedTrend.toLowerCase()}-target`;
                tr.classList.add(trendClass);
            }
        } else if (!isWE && RatingNum > 0) {
            // 💡 安全に型チェックしたisNewとwindow.rateThresholdsで判定
            if (isNew && RatingNum >= window.rateThresholds.new20) {
                tr.classList.add('is-new-target');
            } else if (!isNew && RatingNum >= window.rateThresholds.best30) {
                tr.classList.add('is-best-target');
            }
        }

        tr.innerHTML = `
            <td class="num-cell">${index + 1}</td> 
            <td>
                <div class="title-cell">${newBadge}${item.title || "Unknown"}</div>
                <div class="diff-level-cell">${diffLevelHtml}${trendHtml}</div>
            </td>
            <td class="lamp-cell">${lampHtml}</td>
            <td class="t-score-cell"><span class="t-score">${tScore.toLocaleString()}</span></td>
            <td class="t-rating-cell"><span class="t-rating">${RatingHtml}</span></td>
        `;

        fragment.appendChild(tr);
    });

    body.appendChild(fragment);
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
 * VS機能 フロントエンド処理 JavaScript（WE排他＆定数動的高速非表示版）
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

            // 💡 初期同期時にWEと通常難易度が混ざっていた場合のセーフティ排他
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
 * 💡【修正】VS専用 難易度フィルターボタンの排他選択ロジック
 */
function toggleVsDiffButton(buttonElement) {
    const clickedDiff = buttonElement.getAttribute('data-diff');

    // まずクリックされたボタン自身をトグル
    buttonElement.classList.toggle('active');

    const container = document.getElementById('vs-diff-buttons-container');
    const normalDiffButtons = container.querySelectorAll('.vs-btn-diff-filter:not([data-diff="WE"])');
    const weButton = container.querySelector('.vs-btn-diff-filter[data-diff="WE"]');

    if (buttonElement.classList.contains('active')) {
        if (clickedDiff === "WE") {
            // WEがアクティブになったら、通常難易度（EXP, MAS, ULT）をすべて非アクティブにする
            normalDiffButtons.forEach(btn => btn.classList.remove('active'));
        } else {
            // 通常難易度がアクティブになったら、WEを非アクティブにする
            if (weButton) weButton.classList.remove('active');
        }
    }
}

/**
 * 💡 初期化時用の排他セーフティ関数
 */
function sanitizeVsDiffSelection() {
    const container = document.getElementById('vs-diff-buttons-container');
    if (!container) return;
    const weButton = container.querySelector('.vs-btn-diff-filter[data-diff="WE"]');
    const normalActive = container.querySelectorAll('.vs-btn-diff-filter:not([data-diff="WE"]).active');

    // もしWEと通常難易度が両方アクティブなら、通常難易度を優先（WEを解除）する
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
 * 比較実行・データ受信
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
            lastVsResponseData = result.data;
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
 * 💡【修正版】全件がWORLD'S END(WE)楽曲のみであるかを判定する関数
 * GAS側から返ってくる row.title は「曲名 [難易度]」の形式（例: "看板娘のちょこっとサンバ [WE]"）になっています。
 */
function isAllSongsWe(vsRows) {
    if (!vsRows || vsRows.length === 0) return false;
    // 末尾が [WE] で終わっているかを正規表現で確実にキャッチします
    return vsRows.every(row => /\[WE\]$/i.test(row.title));
}

/**
 * 結果画面のメイン描画（💡 WEの定数非表示対応）
 */
function renderVsResult(forcedBasePlayer) {
    const container = document.getElementById('vs-result-dynamic-container');
    if (!container || !lastVsResponseData) return;
    container.innerHTML = "";

    const data = lastVsResponseData;
    const oppCount = data.opponents.length;
    const totalPlayersCount = oppCount + 1;
    const formatScore = (sc) => sc === 0 ? `<span style="color:#aaa;">-</span>` : sc.toLocaleString();

    // 💡【追加】取得された楽曲データが「すべてWE」であるかチェック
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
                    onclick="document.getElementById('vs-result-modal').style.display='none';" 
                    style="padding: 10px 16px; font-size: 14px; font-weight: bold; background-color: #8e8e93; color: #fff; border: none; border-radius: 6px; cursor: pointer; flex: 1; max-width: 120px; white-space: nowrap;">
                閉じる
            </button>
        </div>
    `;

    if (oppCount === 1) {
        const oppName = data.opponents[0];
        const vsRows = [...data.vsRows];
        const totalSongs = vsRows.length;

        // 💡 WEモードのときは定数のテキスト表示を隠す
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

            const oppScoreA = a.rankList.find(p => p.name === oppName)?.score || 0;
            const diffA = a.myScore - oppScoreA;
            const oppScoreB = b.rankList.find(p => p.name === oppName)?.score || 0;
            const diffB = b.myScore - oppScoreB;

            if (a.matchResult === "WIN") return diffB - diffA;
            if (a.matchResult === "LOSE") return diffB - diffA;
            return isWeMode ? a.title.localeCompare(b.title) : b.constant - a.constant;
        });

        // 💡 テーブルヘッダーから「定数」列を条件分岐で除外
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
            html += `<tr><td colspan="${colspanVal}" style="text-align:center; padding:20px; color:#999;">対象データがありません。</td></tr>`;
        }

        vsRows.forEach(row => {
            const myScore = row.myScore;
            const oppScore = row.rankList.find(p => p.name === oppName)?.score || 0;
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

            // 💡 データ行(td)からも定数列を非表示に
            html += `
                <tr>
                    <td class="vs-col-title">${titleContent}</td>
                    ${isWeMode ? '' : '<td class="vs-col-const">' + row.constant.toFixed(1) + '</td>'}
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
            const baseScore = row.rankList.find(p => p.name === basePlayer)?.score || 0;
            let exactRank = 1;
            row.rankList.forEach(p => {
                if (p.name !== basePlayer && p.score > baseScore) { exactRank++; }
            });

            if (exactRank > totalPlayersCount) exactRank = totalPlayersCount;

            const othersSorted = row.rankList
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

            // WEモードの時は曲名でソート、それ以外は定数でソート
            if (isWeMode) {
                songList.sort((a, b) => a.title.localeCompare(b.title));
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
                        ${isWeMode ? '' : '<td class="vs-col-const">' + song.constant.toFixed(1) + '</td>'}
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

    if (!webhookUrl) {
        webhookUrl = prompt("DiscordのWebhook URLを入力してください。\n(このURLはブラウザに保存され、公開されることはありません)");
        if (webhookUrl) {
            localStorage.setItem('discord_webhook_url', webhookUrl.trim());
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
            // 一番下の要素の下端 + パディング(20px)で正確な高さを求める
            targetHeight = Math.ceil(lastChildRect.bottom - containerRect.top) + 20;
        }

        // html2canvas 実行
        const canvas = await html2canvas(clonedContainer, {
            backgroundColor: "#ffffff",
            scale: 2,
            useCORS: true,
            allowTaint: true,
            width: targetWidth,
            height: targetHeight, // 余白カット済みの正確な高さ
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
        } else if (err.message) {
            alertMsg += `\n内容: ${err.message}`;
        }

        alert(alertMsg);

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
