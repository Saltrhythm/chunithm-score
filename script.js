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

/** * キャッシュ（DOM読み込み完了時に実行）
 */
window.addEventListener('DOMContentLoaded', () => {
    const savedToken = localStorage.getItem('chunirec_token');
    const cachedData = localStorage.getItem('chunirec_scores');
    const savedName = localStorage.getItem('chunirec_player_name');

    // 正しいIDである token-input に統一してトークンを復元
    if (savedToken) {
        const tokenInput = document.getElementById('token-input');
        if (tokenInput) tokenInput.value = savedToken;
    }

    // ★24時間制限（isFresh）を完全に撤廃し、キャッシュがあれば無期限に自動表示
    // ※ 過去の"undefined"という壊れたキャッシュによるエラーを防ぐ安全弁も追加
    if (cachedData && cachedData !== "undefined" && savedName) {
        myCurrentRecords = JSON.parse(cachedData);

        document.getElementById("token-screen").style.display = "none";
        document.getElementById("main-screen").style.display = "block";

        calculatechuniRate(savedName);
        displayScores(myCurrentRecords);
    }
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
 * スコア読み込み
 */
async function loadScores() {
    const tokenInput = document.getElementById("token-input");
    const loadBtn = document.getElementById("load-btn");
    const loadingMsg = document.getElementById("loading-msg");
    const errorMsg = document.getElementById("token-error");
    const token = tokenInput.value.trim();

    if (!token) return false;

    // 開始
    loadBtn.disabled = true;
    loadBtn.innerText = "同期中...";
    loadingMsg.style.display = "block";
    errorMsg.style.display = "none";

    try {
        const response = await fetch(GAS_URL, {
            method: "POST",
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ mode: "checker", token: token })
        });

        let result = await response.json();

        if (result.status === "need_name") {
            const name = prompt("新規ユーザーです。ユーザー名を入力してください（以後自分では変更不可）");
            if (!name) throw new Error("登録をキャンセルしました");

            const res2 = await fetch(GAS_URL, {
                method: "POST",
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ mode: "checker", token: token, playerName: name })
            });
            result = await res2.json();
        }

        if (result.status === "success") {
            handleSuccess(result);
            return true; // 成功
        } else {
            throw new Error(result.message);
        }
    } catch (e) {
        console.error(e);
        errorMsg.innerText = "エラー: " + e.message;
        errorMsg.style.display = "block";
        return false; // 失敗
    } finally {
        loadBtn.disabled = false;
        loadBtn.innerText = "スコアを表示";
        loadingMsg.style.display = "none";
    }
}

/**
 * データを再同期する（ボタン用）
 * スマホでの「同期中...」描画対策、完了/エラーメッセージのポップアップを追加
 */
async function refreshScores() {
    const btn = document.querySelector('.refresh-btn');
    if (!btn || btn.disabled) return;

    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "同期中...";

    // スマホの画面更新時間を確保するため50ミリ秒だけわざと待つ
    await new Promise(resolve => setTimeout(resolve, 50));

    // 同期処理を実行
    const isSuccess = await loadScores();

    btn.disabled = false;
    btn.innerText = originalText;

    btn.blur();

    if (isSuccess) {
        alert("データの再同期が正常に完了しました！");
    } else {
        const errorMsgEl = document.getElementById("token-error");
        const errMsg = errorMsgEl ? errorMsgEl.innerText : "原因不明のエラー";
        alert("同期に失敗しました。\n" + errMsg);
    }
}

/**
 * 同期成功時の処理
 */
function handleSuccess(result) {
    console.log("成功ルート突入", result);

    // 1. データの保存（GASの仕様に合わせて result.records を確実に代入）
    myCurrentRecords = result.records || [];

    // 2. トークンの安全な取得と保存（IDを token-input に統一）
    const tokenInput = document.getElementById('token-input');
    if (tokenInput) {
        localStorage.setItem('chunirec_token', tokenInput.value.trim());
    }

    // スコアと名前をキャッシュに保存（無期限ロード用）
    localStorage.setItem('chunirec_scores', JSON.stringify(myCurrentRecords));
    localStorage.setItem('chunirec_player_name', result.playerName);
    localStorage.setItem('chunirec_cache_time', Date.now().toString());

    // 3. UIの切り替え
    document.getElementById("token-screen").style.display = "none";
    document.getElementById("main-screen").style.display = "block";

    // 4. レート計算と表示
    calculatechuniRate(result.playerName);

    // 確実にデータを引き渡す
    displayScores(myCurrentRecords);

    // 再同期ボタンを元に戻す
    const refreshBtn = document.querySelector('.refresh-btn');
    if (refreshBtn) {
        refreshBtn.disabled = false;
        refreshBtn.innerText = "データを再同期";
    }
}


/**
 * フィルター（検索窓 + セレクトボックス + トレンド）の値を読み取って表示を更新する
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

    // スコア入力の値を取得し、空文字なら初期値（0〜1010000）を割り振る
    const minScoreVal = minScoreInput ? minScoreInput.value : "";
    const maxScoreVal = maxScoreInput ? maxScoreInput.value : "";
    const minScore = minScoreVal !== "" ? parseFloat(minScoreVal) : 0;
    const maxScore = maxScoreVal !== "" ? parseFloat(maxScoreVal) : 1010000;

    // .value を付けて値を取得し、空文字判定を行います
    const minRateVal = minRateInput ? minRateInput.value : "";
    const maxRateVal = maxRateInput ? maxRateInput.value : "";

    const minRate = minRateVal !== "" ? parseFloat(minRateVal) : 0;
    const maxRate = maxRateVal !== "" ? parseFloat(maxRateVal) : 99.99;

    const lampValue = lampSelect.value;

    // 💡 トレンド有効化スイッチの状態を取得
    const trendSwitch = document.getElementById('trend-enable-switch');
    const isTrendEnabled = trendSwitch ? trendSwitch.checked : false;
    const activeTrends = Array.from(document.querySelectorAll('.btn-trend-filter.active')).map(btn => btn.getAttribute('data-trend'));

    // フィルタリング実行
    const filteredData = myCurrentRecords.filter(item => {
        // 1. 曲名で絞り込み
        const title = String(item.title || "").toLowerCase();
        const matchesTitle = title.includes(searchText);

        // 2. Ratingで絞り込み
        const currentRate = parseFloat(item.rating) || 0;
        const matchesRating = (currentRate >= minRate && currentRate <= maxRate);

        // 3. 定数で絞り込み
        const constant = parseFloat(item.const) || 0;
        const matchesConstant = (constant >= minConst && constant <= maxConst);

        // 4. Rank または スコア で絞り込み
        const tScore = parseFloat(item.score) || 0;
        let matchesRankOrScore = true;

        if (filterMode === 'rank') {
            matchesRankOrScore = (tScore >= rankMin && tScore <= getUpperLimit(rankMax));
        } else {
            matchesRankOrScore = (tScore >= minScore && tScore <= maxScore);
        }

        // 5. ランプで絞り込み
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

        // 💡 修正：トレンドフィルター判定
        let matchesTrend = true;
        if (isTrendEnabled) {
            // トレンド機能有効時：設定されているトレンドが現在ONのボタンに含まれている曲のみ（未設定Noneは自動除外）
            const songTrend = item.mainTrend || "None";
            matchesTrend = activeTrends.includes(songTrend);
        } else {
            // トレンド機能無効時：未設定含め全ての曲を通過させる
            matchesTrend = true;
        }

        return matchesTitle && matchesRating && matchesConstant && matchesRankOrScore && matchesLamp && matchesType && matchesTrend;
    });

    // 6. ソートの実行
    sortData(filteredData);

    // 描画
    displayScores(filteredData);


    // =================================================================
    // ★適用中のフィルター条件をバッジでリアルタイム表示
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

        if (minConstSelect.value !== '13.5' || maxConstSelect.value !== '16.0') {
            addBadge(`定数: ${minConstSelect.value}〜${maxConstSelect.value}`);
        }

        if (typeof currentTypeFilter !== 'undefined' && currentTypeFilter !== 'all') {
            const targetBtn = document.getElementById(`filter-${currentTypeFilter}`);
            const targetText = targetBtn ? targetBtn.textContent.trim() : currentTypeFilter;
            addBadge(`対象: ${targetText}`);
        }

        // 💡 修正：トレンド有効時のみバッジを連動
        if (isTrendEnabled) {
            const inactiveTrends = Array.from(document.querySelectorAll('.btn-trend-filter:not(.active)')).map(btn => btn.getAttribute('data-trend'));
            if (inactiveTrends.length > 0 && inactiveTrends.length < 4) {
                addBadge(`除外傾向: ${inactiveTrends.join(', ')}`);
            } else if (inactiveTrends.length === 4) {
                addBadge(`傾向: 表示なし`);
            } else {
                addBadge(`傾向フィルター適用中`);
            }
        }

        if (hasActiveFilter) {
            activeContainer.style.display = 'flex';
        } else {
            activeContainer.style.display = 'none';
        }
    }
}

/**
 * フィルター初期化
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

    // 定数セレクトボックスの中身生成
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

    // 💡 修正：初期状態の設定（デフォルトは無効化、ボタンは全OFF風グレー）
    if (trendSwitch) {
        trendSwitch.checked = false; // デフォルトOFF
    }
    document.querySelectorAll('.btn-trend-filter').forEach(btn => {
        btn.classList.remove('active');
        btn.classList.add('trend-disabled'); // 専用のグレーアウトクラス付与
    });

    // 💡 修正：有効化スイッチの切り替えイベント
    if (trendSwitch) {
        trendSwitch.addEventListener('change', (e) => {
            const isEnabled = e.target.checked;
            document.querySelectorAll('.btn-trend-filter').forEach(btn => {
                if (isEnabled) {
                    // スイッチがONになったら：すべてのトレンドボタンをONにする
                    btn.classList.add('active');
                    btn.classList.remove('trend-disabled');
                } else {
                    // スイッチがOFFになったら：すべて非活性化のグレーに戻す
                    btn.classList.remove('active');
                    btn.classList.add('trend-disabled');
                }
            });
            updateFilters();
        });
    }

    // 💡 修正：トレンドボタン自体のクリックイベント
    document.querySelectorAll('.btn-trend-filter').forEach(btn => {
        btn.addEventListener('click', (e) => {
            // スイッチがOFFの時はボタンを押しても何もさせない
            if (trendSwitch && !trendSwitch.checked) return;

            e.target.classList.toggle('active');
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

            // 💡 修正：リセット時はトレンド機能自体をデフォルト（無効化）に戻す
            if (trendSwitch) trendSwitch.checked = false;
            document.querySelectorAll('.btn-trend-filter').forEach(b => {
                b.classList.remove('active');
                b.classList.add('trend-disabled');
            });

            currentSortKey = 'rating';
            document.getElementById('sort-Rating')?.classList.add('active');
            document.getElementById('sort-score')?.classList.remove('active');

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
            updateFilters();
        });
    }
    if (sortScoreBtn) {
        sortScoreBtn.addEventListener('click', () => {
            currentSortKey = 'techScore';
            sortScoreBtn.classList.add('active');
            sortRatingBtn.classList.remove('active');
            updateFilters();
        });
    }
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

/** * Ratingかテクニカルスコアでのソート
 */
function sortData(data) {
    data.sort((a, b) => {
        if (currentSortKey === 'rating') {
            const ratingA = parseFloat(a.rating) || 0;
            const ratingB = parseFloat(b.rating) || 0;
            if (ratingB !== ratingA) return ratingB - ratingA;
        }
        // Ratingが同じ、またはスコア順選択時はスコアで比較
        const scoreA = parseFloat(a.score) || 0;
        const scoreB = parseFloat(b.score) || 0;
        return scoreB - scoreA;
    });
}



/**
 * 3. レート計算（新20 + 旧30）
 * 単曲Ratingを第3位切り捨てした状態で平均を算出
 */
function calculatechuniRate(playerName) {
    const rateDisplay = document.getElementById('rating-average');
    if (!rateDisplay) return;

    const targetData = (typeof allRecords !== 'undefined' ? allRecords : myCurrentRecords) || [];

    if (targetData.length === 0) {
        rateDisplay.innerText = "データがありません。同期を行ってください。";
        return;
    }

    // --- 切り捨て用ヘルパー関数 ---
    // 第3位切り捨て (単曲Rating & トータルレート用)
    const floorTo2nd = (num) => {
        if (!num || isNaN(num)) return 0;
        return Math.floor((num + 0.0000001) * 100) / 100;
    };

    // 第5位切り捨て (枠平均表示用)
    const floorTo4th = (num) => {
        if (!num || isNaN(num)) return 0;
        return Math.floor((num + 0.0000001) * 10000) / 10000;
    };

    const newSongs = targetData.filter(s => s.isNew);
    const bestSongs = targetData.filter(s => !s.isNew);

    const getTopData = (list, count) => {
        const sorted = list
            .map(s => {
                // 【重要】一曲ずつのRatingをまず第3位切り捨てにする
                return floorTo2nd(parseFloat(s.rating) || 0);
            })
            .sort((a, b) => b - a);

        const top = sorted.slice(0, count);

        // 切り捨て済みの数値を使って平均を算出
        const rawAvg = top.length > 0 ? top.reduce((a, b) => a + b, 0) / count : 0;

        // 平均値そのものも第5位で切り捨て
        const avg = floorTo4th(rawAvg);

        // 閾値（ハイライト用）も切り捨て済みの値から取得
        const threshold = sorted.length >= count ? sorted[count - 1] : (sorted[sorted.length - 1] || 0);

        return { avg, threshold };
    };

    const newData = getTopData(newSongs, 20);
    const bestData = getTopData(bestSongs, 30);

    rateThresholds.new20 = newData.threshold;
    rateThresholds.best30 = bestData.threshold;

    // トータルレート算出：切り捨て済みの枠平均から算出し、最後に第5位切り捨て
    const totalRate = floorTo4th((newData.avg * 20 + bestData.avg * 30) / 50);

    // --- HTML出力 ---
    const displayName = playerName || "Player";

    rateDisplay.innerHTML = `
        <div class="rating-container">
            <span class="user-name"><strong>${displayName}</strong></span>
            <span class="divider">|</span>
            <span class="rate-total">Rating: <span class="highlight-number main-rate">${totalRate.toFixed(4)}</span></span>
            <span class="divider">|</span>
            <span>BEST: <span class="highlight-number">${bestData.avg.toFixed(4)}</span></span>
            <span class="divider">|</span>
            <span>NEW: <span class="highlight-number">${newData.avg.toFixed(4)}</span></span>
        </div>
    `;
}


/**
 * 画面にスコアを表示する（💡既存CSS完全継承・Main Trend色変更版）
 */
function displayScores(data) {
    console.log("--- displayScores開始 ---");
    console.log("受け取ったデータ:", data);

    const body = document.getElementById('score-body');
    if (!body) {
        console.error("エラー: HTMLに 'score-body' というIDを持つ要素が見つかりません。");
        return;
    }

    if (!data || data.length === 0) {
        console.warn("警告: 表示するデータが0件です。");
        body.innerHTML = "<tr><td colspan='4'>表示できるデータがありません</td></tr>";
        return;
    }

    body.innerHTML = "";
    const fragment = document.createDocumentFragment();

    // ★ 表示件数を上位200件に制限
    const limitedData = data.slice(0, 200);

    // 各属性に対応する専用カラーコード
    const colorMap = {
        'POWER': '#36a2eb', // 青
        'NOTES': '#d7a62e', // 黄
        'CHUNI': '#239898', // 緑
        'TRICKY': '#9966ff'  // 紫
    };

    limitedData.forEach((item, index) => {
        // GAS側から送られてくる diff (MAS, ULT等) を取得
        const diff = String(item.diff || "").toLowerCase();

        // 数値としての定数とスコア、Ratingを取得
        const currentConst = parseFloat(item.const) || 0;
        const tScore = parseFloat(item.score) || 0;
        const RatingNum = parseFloat(item.rating) || 0;

        // 表示用の定数 (0の場合は - と表示)
        const displayLevel = currentConst > 0 ? currentConst.toFixed(1) : "-";
        const RatingText = RatingNum > 0
            ? (Math.floor((RatingNum + 0.000001) * 100) / 100).toFixed(2)
            : "-";

        // --- 1. ランプ表示（GAS側で作った item.lamp を利用） ---
        let lampHtml = "";
        if (item.lamp) {
            let comboClass = "";
            if (item.lamp === "AJC") comboClass = "ajc-badge";
            else if (item.lamp === "AJ") comboClass = "aj-badge";
            else if (item.lamp === "FC") comboClass = "fc-badge";

            lampHtml = `<span class="${comboClass}">${item.lamp}</span>`;
        }

        // 2. 新曲バッジ (item.isNew判定は既存ロジックを継続)
        const newBadge = item.isNew ? `<span class="new-song-label">NEW</span>` : "";

        // 💡【修正】既存CSSを100%活かし、カラーだけを綺麗に上書きするトレンドHTML
        let trendHtml = "";
        if (item.mainTrend && item.mainTrend !== "None") {
            const trendColor = colorMap[item.mainTrend] || "#555";
            // スラッシュ「/」はインライン色指定をせず、.diff-level-cell の元の色（#555）をそのまま適用
            // トレンド名だけ span で囲って color のみを指定（太さやサイズはCSSを継承）
            trendHtml = ` / <span style="color: ${trendColor};">${item.mainTrend}</span>`;
        }

        // --- 3. テーブル行の作成 ---
        const tr = document.createElement('tr');
        tr.className = diff;
        tr.style.cursor = "pointer"; // クリック可能であることを示す

        // クリックイベント：ランキング機能を呼び出す
        tr.onclick = () => {
            if (typeof loadRanking === "function") {
                loadRanking(item.title, item.diff, item.const);
            }
        };

        // ハイライト判定 (rateThresholdsとの比較)
        if (RatingNum > 0) {
            if (item.isNew && RatingNum >= rateThresholds.new20) {
                tr.classList.add('is-new-target');
            } else if (!item.isNew && RatingNum >= rateThresholds.best30) {
                tr.classList.add('is-best-target');
            }
        }

        // HTML組み立て (💡diff-level-cellの本来のスタイルを一切崩さずに結合)
        tr.innerHTML = `
            <td class="num-cell">${index + 1}</td> 
            <td>
                <div class="title-cell">${newBadge}${item.title || "Unknown"}</div>
                <div class="diff-level-cell">${diff} ${displayLevel}${trendHtml}</div>
            </td>
            <td class="lamp-cell">${lampHtml}</td>
            <td class="t-score-cell"><span class="t-score">${tScore.toLocaleString()}</span></td>
            <td class="t-rating-cell"><span class="t-rating">${RatingText}</span></td>
        `;

        fragment.appendChild(tr);
    });

    body.appendChild(fragment);
    console.log("--- 表の描画完了 ---");
}

/**
 * 選曲中の演出付きランダム選出
 */
function pickRandomSong() {
    // 1. 現在適用されているフィルタ条件で候補（candidates）を絞り込む
    const searchInput = document.getElementById('search-input');
    const minConstSelect = document.getElementById('min-constant');
    const maxConstSelect = document.getElementById('max-constant');
    const minRateInput = document.getElementById('min-rating');
    const maxRateInput = document.getElementById('max-rating');
    const lampSelect = document.getElementById('lamp-filter');

    // ★【連動拡張】Rank / スコア切り替え要素を新しく取得
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

    // モード（"rank" または "score"）と、それぞれの境界値を取得
    const filterMode = filterModeSelect ? filterModeSelect.value : 'rank';
    const rankMin = rankMinSelect ? parseFloat(rankMinSelect.value) : 0;
    const rankMax = rankMaxSelect ? parseFloat(rankMaxSelect.value) : 1010000;

    const minScoreVal = minScoreInput ? minScoreInput.value : "";
    const maxScoreVal = maxScoreInput ? maxScoreInput.value : "";
    const minScore = minScoreVal !== "" ? parseFloat(minScoreVal) : 0;
    const maxScore = maxScoreVal !== "" ? parseFloat(maxScoreVal) : 1010000;

    // 💡 トレンド有効化スイッチと、ONになっているトレンドボタンの情報を取得
    const trendSwitch = document.getElementById('trend-enable-switch');
    const isTrendEnabled = trendSwitch ? trendSwitch.checked : false;
    const activeTrends = Array.from(document.querySelectorAll('.btn-trend-filter.active')).map(btn => btn.getAttribute('data-trend'));

    // ここで candidates を定義
    const candidates = myCurrentRecords.filter(item => {
        const title = String(item.title || "").toLowerCase();
        if (!title.includes(searchText)) return false;

        const currentRate = parseFloat(item.rating) || 0;
        if (currentRate < minRate || currentRate > maxRate) return false;

        const constant = parseFloat(item.const) || 0;
        if (constant < minConst || constant > maxConst) return false;

        // ★【修正】Rankモードかスコアモードかに応じて判定をスイッチ
        const tScore = parseFloat(item.score) || 0;
        if (filterMode === 'rank') {
            // Rank選択時: 下限以上 かつ 上限区分の最大値以下
            if (tScore < rankMin || tScore > getUpperLimit(rankMax)) return false;
        } else {
            // スコア選択時: 直接入力された数値の範囲で判定
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

        // 💡 追加：傾向フィルター有効化スイッチとの完全連動判定
        if (isTrendEnabled) {
            // 傾向フィルターが「オン」のとき：未設定(None)は除外し、ONのトレンド属性のみを許可
            const songTrend = item.mainTrend || "None";
            if (!activeTrends.includes(songTrend)) return false;
        } else {
            // 傾向フィルターが「オフ」のとき：未設定も含めて全ての曲を通過させる
            // (何も判定せずスルーしてOK)
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
        <div id="roulette-diff" style="margin-top: 10px; padding: 5px 15px; border-radius: 20px; font-weight: bold;"></div>
    `;
    document.body.appendChild(overlay);

    const titleEl = document.getElementById('roulette-title');
    const diffEl = document.getElementById('roulette-diff');

    let count = 0;
    const maxTicks = 20;
    const interval = setInterval(() => {
        const temp = candidates[Math.floor(Math.random() * candidates.length)];
        titleEl.innerText = temp.title;
        diffEl.innerText = temp.diff;

        const diffColors = { 'basic': '#22ac22', 'advanced': '#f39c12', 'expert': '#e74c3c', 'master': '#9b59b6', 'ultima': '#222' };
        diffEl.style.backgroundColor = diffColors[temp.diff.toLowerCase()] || '#555';

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

        diffEl.innerText = picked.diff;
        const diffColors = { 'basic': '#22ac22', 'advanced': '#f39c12', 'expert': '#e74c3c', 'master': '#9b59b6', 'ultima': '#222' };
        diffEl.style.backgroundColor = diffColors[picked.diff.toLowerCase()] || '#555';
        diffEl.style.boxShadow = `0 0 20px ${diffEl.style.backgroundColor}`;

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

/**
 * 特定の曲のランキングを取得して表示（💡既存CSS完全対応・トレンド表示修正版）
 */
async function loadRanking(title, diff, songConst) {

    const modal = document.getElementById('ranking-modal');
    const rankingBody = document.getElementById('ranking-body');
    const titleContainer = document.getElementById('ranking-title-container');

    // --- 1. 表示エリアの切り替え（統計モードから通常モードへ復帰） ---
    const controls = document.getElementById('ranking-controls');
    const statsControlArea = document.getElementById('stats-control-area');
    const radarContainer = document.getElementById('radar-chart-container'); // ★追加

    if (controls) controls.style.display = 'block';           // グラフや範囲ボタンを表示
    if (statsControlArea) statsControlArea.style.display = 'none'; // 統計用切り替えボタンを隠す
    if (radarContainer) radarContainer.style.display = 'block';     // ★追加：通常モードなのでレーダーを表示する

    // --- 2. テーブルヘッダーを通常用にリセット ---
    const modalTableHead = document.querySelector('#ranking-modal table thead tr');
    if (modalTableHead) {
        modalTableHead.innerHTML = `
            <th>順位</th>
            <th>プレイヤー</th>
            <th>スコア</th>
            <th>ランプ</th>
        `;
    }

    // --- 3. その他のリセット処理 ---
    selectedPlayer = null;
    lastRankingData = [];

    const canvas = document.getElementById('ranking-canvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.style.display = 'block'; // キャンバスを表示
    }

    // レーダーチャートの古いインスタンスがあれば、モーダルを開いた瞬間に一度クリアする
    if (radarChartInstance) {
        radarChartInstance.destroy();
        radarChartInstance = null;
    }

    // 💡 修正：元のCSS（.title-sub-info）をそのまま使える1行構造に戻し、トレンドの受け皿を用意
    const displayDiff = diff ? diff.toUpperCase() : "";
    titleContainer.innerHTML = `
        ${title} 
        <span class="title-sub-info">
            <span class="diff-const-txt">${displayDiff} ${songConst || ""}</span>
            <span id="trend-container"></span>
        </span>
    `.trim();

    rankingBody.innerHTML = "<tr><td colspan='4'>読み込み中...</td></tr>";
    modal.style.display = "flex";

    try {
        console.log("送るデータ:", { title, diff, const: songConst });
        const response = await fetch(GAS_URL, {
            method: "POST",
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                mode: "get_ranking",
                title: title,
                diff: diff,
                const: songConst
            })
        });

        const result = await response.json();

        if (result.status === "success" && result.data) {
            rankingBody.innerHTML = "";
            result.data.forEach((row, index) => {
                const tr = document.createElement('tr');
                tr.style.cursor = "pointer"; // クリック可能であることを示す
                tr.dataset.playerName = row.playerName; // グラフ連動用に名前を保持

                // ★ 行タップ：非表示にしてグラフを再描画
                tr.onclick = function (e) {
                    this.style.display = "none";
                    drawRankingChart();
                };

                // 自分の名前を強調
                const myName = localStorage.getItem('chunirec_player_name');
                if (row.playerName === myName) tr.classList.add('my-rank');

                // スコアの表示処理
                let scoreVal = row.score;
                const displayScore = (typeof scoreVal === 'number') ? scoreVal.toLocaleString() : scoreVal;

                const lampText = row.lamp || "";
                let badgeClass = "";

                if (lampText.includes("AJC")) badgeClass = "ajc-badge";
                else if (lampText.includes("AJ")) badgeClass = "aj-badge";
                else if (lampText.includes("FC")) badgeClass = "fc-badge";
                else badgeClass = "";

                tr.innerHTML = `
                    <td class="rank-cell">${index + 1}</td>
                    <td>${row.playerName}</td>
                    <td>${displayScore}</td> 
                    <td style="text-align: center;">
                     <span class="${badgeClass}">${lampText}</span>
                    </td>
                `;

                rankingBody.appendChild(tr);
            });

            // 初回描画（数直線グラフ）
            drawRankingChart(result.data);

            // ★【修正】レーダーチャートの初回描画に、loadRankingが受け取った songConst をバトンタッチする
            drawRadarChart(result.songProps, songConst);

            // 💡【修正】読み込み完了後に、トレンドテキストをインラインで安全に流し込む
            const trendContainer = document.getElementById('trend-container');
            if (trendContainer && result.songProps) {
                const props = result.songProps;

                // 各属性に対応する専用カラーコード
                const colorMap = {
                    'POWER': '#36a2eb', // 青
                    'NOTES': '#d7a62e', // 黄
                    'CHUNI': '#239898', // 緑
                    'TRICKY': '#9966ff'  // 紫
                };

                let html = "";

                // Main Trendの記述
                if (props.mainTrend && props.mainTrend !== "None") {
                    const mainColor = colorMap[props.mainTrend] || "#666";
                    // 難易度と少し離すために左マージン
                    html += `<span style="color: ${mainColor}; font-weight: 900; margin-left: 12px;">${props.mainTrend}</span>`;

                    // Sub Trendの記述 (None以外かつMainと重複しない場合)
                    if (props.subTrend && props.subTrend !== "None" && props.subTrend !== props.mainTrend) {
                        const subColor = colorMap[props.subTrend] || "#666";
                        html += ` <span style="color: #888; font-weight: normal;">/</span> <span style="color: ${subColor}; font-weight: 900;">${props.subTrend}</span>`;
                    }
                }
                trendContainer.innerHTML = html;
            }

        } else {
            rankingBody.innerHTML = "<tr><td colspan='4'>データがありません</td></tr>";
            drawRadarChart(null, songConst);
        }
    } catch (e) {
        console.error(e);
        rankingBody.innerHTML = "<tr><td colspan='4'>エラーが発生しました</td></tr>";
        drawRadarChart(null, songConst);
    }
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
 * 💡 完全修正版：レーダーチャートを描画する関数
 * （呼び出し元から渡された定数を確実に反映するバージョン）
 */
function drawRadarChart(props, songConst) {
    const canvas = document.getElementById('radar-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // すでにグラフが描画されている場合は一度破棄して初期化
    if (radarChartInstance) {
        radarChartInstance.destroy();
        radarChartInstance = null;
    }

    // 譜面傾向データがない、またはすべて0の場合はキャンバスをクリアして終了
    if (!props || (!props.tairyoku && !props.kenban && !props.chuni && !props.kuse)) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
    }

    // ----------------------------------------------------
    // ★ 渡された引数を確実に数値化し、計算誤差を排除
    // ----------------------------------------------------
    let currentConst = parseFloat(songConst);

    // 万が一、定数が渡されなかった場合の最終安全策（デフォルト15.0）
    if (isNaN(currentConst)) {
        currentConst = 15.0;
    }

    // 小数点第1位に確実に丸める（例: 15.1000003 などを 15.1 に）
    currentConst = Math.round(currentConst * 10) / 10;

    // 15.0を基準とした差分を整数（0.1 = 1）として算出
    const diffDiff = Math.round((currentConst - 15.0) * 10);
    
    // 基本の上限値16に、差分×4を加算
    let maxLimit = 16 + (diffDiff * 4);
    
    // 【安全ガード】定数が15.0未満（14.5など）の曲でも、上限は16未満に下げない
    if (maxLimit < 16) {
        maxLimit = 16;
    }

    // 上限を確実に4等分するための1マスの幅
    const stepInterval = maxLimit / 4;
    // ----------------------------------------------------

    // 各属性の値を配列化
    const dataValues = [
        props.tairyoku || 0,
        props.kenban || 0,
        props.chuni || 0,
        props.kuse || 0
    ];

    const chartBgColor = 'rgba(255, 71, 87, 0.18)';     // 網掛け（赤色の透明）
    const chartBorderColor = 'rgba(255, 71, 87, 1)';   // 外枠の線（不透明な赤）
    const pointColor = 'rgba(255, 71, 87, 1)';         // 頂点のポインター（不透明な赤）

    // レーダーチャートを新規生成
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
                    max: maxLimit, // 正確な上限値をロック
                    ticks: {
                        stepSize: stepInterval, // 均等な幅
                        maxTicksLimit: 5,       // 確実に4分割（線5本）
                        font: { size: 9 },
                        backdropColor: 'transparent'
                    },
                    pointLabels: {
                        font: {
                            size: 13,
                            weight: '900',
                            family: 'sans-serif',
                            lineHeight: 1.4  // ★【追加】1行目と2行目の間に程よい上下の余白を作る
                        },
                        // ★【最重要】すべての行のテキストを「中央寄せ」に強制固定する
                        textAlign: 'center', 
                        
                        // 頂点ラベルのテキストを動的にカスタマイズ
                        callback: function(label, index) {
                            let val = 0;
                            if (label === 'POWER') val = props.tairyoku || 0;
                            if (label === 'NOTES') val = props.kenban || 0;
                            if (label === 'CHUNI') val = props.chuni || 0;
                            if (label === 'TRICKY') val = props.kuse || 0;
                            
                            // 前方のスペース（空白）を無くし、純粋な数値だけにします
                            // textAlign: 'center' の効果で、これだけで自動的に真ん中にドカンと配置されます
                            return [label, `${val.toFixed(2)}`];
                        },
                        // ラベルの個別カラー（青・黄・緑・紫）
                        color: function (context) {
                            const colors = [
                                'rgba(54, 162, 235, 1)',   // POWER (青)
                                'rgba(215, 166, 46, 1)',   // NOTES (黄)
                                'rgba(35, 152, 152, 1)',   // CHUNI (緑)
                                'rgba(153, 102, 255, 1)'  // TRICKY (紫)
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

    // ★ 表で非表示（display: none）になっていないプレイヤーだけを抽出
    const visibleNames = Array.from(document.querySelectorAll('#ranking-body tr'))
        .filter(tr => tr.style.display !== 'none')
        .map(tr => tr.dataset.playerName);

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

    // ★【重要修正】傾向フィルターの選択状態を取得
    const trendSwitch = document.getElementById('trend-enable-switch');
    const isTrendEnabled = trendSwitch ? trendSwitch.checked : false;
    const activeTrends = isTrendEnabled
        ? Array.from(document.querySelectorAll('.btn-trend-filter.active')).map(btn => btn.getAttribute('data-trend'))
        : [];

    const requestParams = {
        mode: "get_stats",
        filterMode: filterMode,
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

            const statsControlArea = document.getElementById('stats-control-area');
            if (statsControlArea) statsControlArea.style.display = 'block';

            const radarContainer = document.getElementById('radar-chart-container'); // ★追加
            if (radarContainer) radarContainer.style.display = 'none';     // ★追加：統計モードなのでレーダーを隠す

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

function displayStatsRanking() {
    const tbody = document.getElementById('ranking-body');
    const modal = document.getElementById('ranking-modal');
    if (!tbody || !currentStatsData) return;

    tbody.innerHTML = "";

    const statsData = [...currentStatsData];
    if (currentDisplayType === 'avg') {
        statsData.sort((a, b) => (b.avgScore || 0) - (a.avgScore || 0));
    } else {
        statsData.sort((a, b) => b.count - a.count);
    }

    const thead = modal.querySelector('table thead tr');
    if (thead) {
        const nameLabel = currentStatsMode === 'song' ? '楽曲名' : 'プレイヤー';

        if (currentDisplayType === 'avg') {
            const col4Label = currentStatsMode === 'song' ? '全プレイ人数' : '全プレイ曲数';
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

    statsData.forEach((row, index) => {
        const displayName = (currentStatsMode === 'song') ? (row.title || "不明") : (row.playerName || "不明");
        const unit = (currentStatsMode === 'song') ? "人" : "曲";
        const tr = document.createElement('tr');

        let col3, col4;
        if (currentDisplayType === 'avg') {
            const avgVal = (row.avgScore && row.avgScore > 0) ? row.avgScore.toLocaleString() : "---";

            let totalCount = 0;
            if (currentStatsMode === 'song') {
                totalCount = row.totalCountAll || 0;
            } else {
                totalCount = row.allPlayCount || 0;
            }

            col3 = `<td style="text-align:center; font-weight:bold; color: #2e7df0;">${avgVal}</td>`;
            col4 = `<td style="text-align:center;">${totalCount}<span style="font-size:10px;"> ${unit}</span></td>`;
        } else {
            const rateStr = currentDenominator > 0 ? ((row.count / currentDenominator) * 100).toFixed(1) + "%" : "-";

            col3 = `<td style="text-align:right; font-weight:bold;">${row.count} ${unit}</td>`;
            col4 = `<td style="text-align:center; color: #f02e2e;">${rateStr}</td>`;
        }

        tr.innerHTML = `
            <td class="rank-cell" style="text-align:center;">${index + 1}</td>
            <td style="text-align:left;">${displayName}</td>
            ${col3}
            ${col4}
        `;

        tr.style.cursor = "pointer";

        if (currentStatsMode === 'song') {
            tr.onclick = () => showSubModal(row);
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
 * 統計モーダルのタイトル更新
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
    let subInfo = "";

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
        subInfo = `定数: ${minC} ～ ${maxC}${trendHtml}`;
    } else {
        let scoreLabel = "";
        if (filterMode === 'score') {
            const rMin = document.getElementById('min-score')?.value || "0";
            const rMax = document.getElementById('max-score')?.value || "1010000";
            const displayMin = Number(rMin).toLocaleString();
            const displayMax = Number(rMax).toLocaleString();
            scoreLabel = `スコア: ${displayMin}～${displayMax}`;
        } else {
            const rankMinSelect = document.getElementById('rank-min');
            const rankMaxSelect = document.getElementById('rank-max');
            const minText = rankMinSelect ? rankMinSelect.options[rankMinSelect.selectedIndex]?.text : "0";
            const maxText = rankMaxSelect ? rankMaxSelect.options[rankMaxSelect.selectedIndex]?.text : "1010000";
            scoreLabel = `Rank: ${minText}～${maxText}`;
        }

        subInfo = `定数: ${minC}～${maxC} / レート: ${minRate}～${maxRate} / ${scoreLabel} / ランプ: ${lampLabel}${trendHtml}`;
    }

    titleContainer.innerHTML = `
        ${mainTitle}
        <div class="title-sub-info" style="display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-start; gap: 4px;">${subInfo}</div>
    `;
}

function showSubModal(row) {
    const subModal = document.getElementById('sub-modal');
    const subTbody = document.getElementById('sub-modal-tbody');
    const subTitle = document.getElementById('sub-modal-title');
    const thead = document.querySelector('#sub-modal-table thead tr');

    if (!subModal || !subTbody || !lastStatsResponse) return;

    subTitle.innerText = row.title || "プレイヤー状況一覧";
    subTbody.innerHTML = "";

    if (thead) {
        thead.innerHTML = `
            <th style="text-align:center; padding-left: 15px;">プレイヤー</th>
            <th style="text-align:center;">スコア</th>
        `;
    }

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

        if (p.isAchieved === true) {
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

/**
 * 個人別詳細を取得して表示
 */
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

    // ★【重要修正】個人詳細取得時にも傾向フィルターの状態を取得
    const trendSwitch = document.getElementById('trend-enable-switch');
    const isTrendEnabled = trendSwitch ? trendSwitch.checked : false;
    const activeTrends = isTrendEnabled
        ? Array.from(document.querySelectorAll('.btn-trend-filter.active')).map(btn => btn.getAttribute('data-trend'))
        : [];

    const params = {
        mode: "get_player_detail",
        filterMode: filterMode,
        playerName: playerName,
        minConst: document.getElementById('min-constant')?.value || "0",
        maxConst: document.getElementById('max-constant')?.value || "16.0",
        minRate: document.getElementById('min-rating')?.value || "0",
        maxRate: document.getElementById('max-rating')?.value || "21.0",
        rankMin: rMin,
        rankMax: rMax,
        lampFilter: document.getElementById('lamp-filter')?.value || 'all',
        typeFilter: document.querySelector('.btn-filter.active')?.getAttribute('data-value') || 'all',
        // ★【重要修正】GAS側に傾向フィルターの情報を送信する
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

    playerData.details.forEach(item => {
        const tr = document.createElement('tr');

        if (item.isAchieved === true) {
            tr.style.backgroundColor = "rgba(240, 46, 46, 0.1)";
            tr.style.color = "#d63031";
            tr.style.fontWeight = "bold";
        }

        tr.innerHTML = `
            <td style="text-align: left; padding-left: 0px; font-size: 0.85em; width: 70%; max-width: 0;">
                <div style="display: block; width: 100%; text-align: left; overflow-x: auto; white-space: nowrap; -webkit-overflow-scrolling: touch; padding-left: 5px; padding-right: 5px; ${noScrollbarStyle}">
                    ${item.title}
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
 * VS機能 フロントエンド処理 JavaScript（タイマン＆複数人 完全統合版）
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
let lastVsResponseData = null; // GASから返ってきた比較データを保持するグローバル変数

/**
 * ログイン中のプレイヤー名を自動取得する共通ヘルパー関数
 * 既存の rating-container 内の表示や構造は一切変えず、
 * そこに表示されているテキストからプレイヤー名だけを安全にサンプリングします。
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

            // 自分の名前を自動取得
            const myName = getLoggedInPlayerName();

            // ★修正：HTML側のID「vs-my-name-display」をピンポイントで取得して名前を書き換える
            const myNameDisplay = document.getElementById('vs-my-name-display');
            if (myNameDisplay) {
                myNameDisplay.innerText = myName || "（プレイヤー未同期）";
            }

            // メイン画面の定数フィルター（min-constant / max-constant）から現在の値を引き継ぎ
            const mainMinC = document.getElementById('min-constant')?.value || "13.5";
            const mainMaxC = document.getElementById('max-constant')?.value || "16.0";

            // VSモーダル側のセレクトボックスにメイン画面の選択値をセット（小数点第1位の文字列として確実にセット）
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

function renderVsOpponents() {
    const container = document.getElementById('vs-opponents-container');
    if (!container) return;
    container.innerHTML = "";

    // 自動取得した自分の名前をベースに除外処理を行う
    const myName = getLoggedInPlayerName();

    cachedVsPlayers.forEach(p => {
        if (p === myName) return; // 自分を対戦相手リストに出さない
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
 * ★追加：VS設定画面の傾向フィルタースイッチのON/OFF制御
 */
function toggleVsTrendFilters() {
    const switchEl = document.getElementById('vs-trend-enable-switch');
    const containerEl = document.getElementById('vs-trend-buttons-container');
    if (!switchEl || !containerEl) return;

    if (switchEl.checked) {
        containerEl.classList.remove('vs-disabled'); // 明るくしてクリック可能にする
    } else {
        containerEl.classList.add('vs-disabled');    // 半透明にしてクリック不可にする
        // スイッチがOFFになったら、選択されていたボタンのactiveクラスをすべて解除する
        const activeButtons = containerEl.querySelectorAll('.vs-btn-trend-filter.active');
        activeButtons.forEach(btn => btn.classList.remove('active'));
    }
}

/**
 * ★追加：VS専用 傾向フィルターボタンの選択/解除切り替え
 */
function toggleVsTrendButton(buttonElement) {
    // スイッチ自体がOFFなら何もしない
    const switchEl = document.getElementById('vs-trend-enable-switch');
    if (!switchEl || !switchEl.checked) return;

    // activeクラスがついていれば外し、ついていなければつける
    buttonElement.classList.toggle('active');
}

/**
 * ★追加：VS設定画面の定数セレクトボックス（0.1刻み）を自動生成する処理
 * ページ読み込み時に実行されます
 */
document.addEventListener("DOMContentLoaded", () => {
    const minSelect = document.getElementById("vs-min-const");
    const maxSelect = document.getElementById("vs-max-const");

    if (!minSelect || !maxSelect) return;

    const start = 13.5;
    const end = 16.0;
    const step = 0.1;

    // 1. 下限側の生成：昇順（13.5 -> 16.0）
    for (let i = Math.round(start * 10); i <= Math.round(end * 10); i += Math.round(step * 10)) {
        const val = (i / 10).toFixed(1);
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = val;

        if (val === "13.5") opt.selected = true; // 初期状態
        minSelect.appendChild(opt);
    }

    // 2. 上限側の生成：降順（16.0 -> 13.5）
    for (let i = Math.round(end * 10); i >= Math.round(start * 10); i -= Math.round(step * 10)) {
        const val = (i / 10).toFixed(1);
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = val;

        if (val === "16.0") opt.selected = true; // 初期状態
        maxSelect.appendChild(opt);
    }
});

/**
 * 【完全統合版】比較実行・データ受信（VS専用の傾向フィルター連動）
 */
async function startVsCompare() {
    const myName = getLoggedInPlayerName();
    if (!myName) { alert("あなたのプレイヤー名が取得できません。一度同期を行ってください。"); return; }

    const checkedBoxes = document.querySelectorAll('.vs-opp-checkbox:checked');
    const opponents = Array.from(checkedBoxes).map(cb => cb.value);
    if (opponents.length === 0) { alert("対戦相手を少なくとも1人選択してください。"); return; }

    // VSモーダル内のセレクトボックスから選択範囲を取得
    const minC = document.getElementById('vs-min-const')?.value || "13.5";
    const maxC = document.getElementById('vs-max-const')?.value || "16.0";

    // ----------------------------------------------------
    // VS設定画面専用のUIから傾向フィルターの状態を取得
    // ----------------------------------------------------
    const vsTrendSwitch = document.getElementById('vs-trend-enable-switch');
    const isTrendEnabled = vsTrendSwitch ? vsTrendSwitch.checked : false;
    
    // コンテナ内にある「active」クラスが付いたボタンの data-trend 値（POWER, NOTES等）を集める
    const activeTrends = isTrendEnabled
        ? Array.from(document.querySelectorAll('#vs-trend-buttons-container .vs-btn-trend-filter.active')).map(btn => btn.getAttribute('data-trend'))
        : [];
    // ----------------------------------------------------

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
                minConst: parseFloat(minC), 
                maxConst: parseFloat(maxC),
                isTrendEnabled: isTrendEnabled, // GAS側に独立したスイッチの状態を送信
                activeTrends: activeTrends       // GAS側に選択された具体的な傾向リストを送信
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

/**
 * 誰を基準にするかセレクトボックスが変更された際のリレンダー用関数（複数人用）
 */
function handleBasePlayerChange(selectElement) {
    renderVsResult(selectElement.value);
}

/**
 * 結果画面のメイン描画（タイマンと複数人を完全分離して生成）
 * ★修正：既存の傾向表示ロジック・カラー（NOTES: #be901f 等）と完全に統一
 */
function renderVsResult(forcedBasePlayer) {
    const container = document.getElementById('vs-result-dynamic-container');
    if (!container || !lastVsResponseData) return;
    container.innerHTML = "";

    const data = lastVsResponseData;
    const oppCount = data.opponents.length;
    const totalPlayersCount = oppCount + 1;
    const formatScore = (sc) => sc === 0 ? `<span style="color:#aaa;">-</span>` : sc.toLocaleString();

    // ----------------------------------------------------
    // ★【修正】ご提示いただいた既存の傾向表示ロジックとの完全統合
    // ----------------------------------------------------
    let trendHtml = "";
    const vsTrendSwitch = document.getElementById('vs-trend-enable-switch');
    const isTrendEnabled = vsTrendSwitch ? vsTrendSwitch.checked : false;

    if (isTrendEnabled) {
        // VS専用コンテナ内のアクティブなボタンから data-trend を取得
        const activeTrends = Array.from(document.querySelectorAll('#vs-trend-buttons-container .vs-btn-trend-filter.active')).map(btn => btn.getAttribute('data-trend'));

        const trendColors = {
            'POWER': { bg: '#36a2eb', text: '#ffffff' },
            'NOTES': { bg: '#be901f', text: '#ffffff' }, // 統一されたカラー
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
    // ----------------------------------------------------

    // 💡 共通で利用する「横並びボタン」のHTMLコンポーネント
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

    // ==========================================================================
    // A. 【タイマンの場合（対戦相手が1人の場合）】
    // ==========================================================================
    if (oppCount === 1) {
        const oppName = data.opponents[0];
        const vsRows = [...data.vsRows];
        const totalSongs = vsRows.length;

        // ★ 定数の横辺りに自然に繋がるように ${trendHtml} を配置
        let html = `
            <div class="vs-header-left" style="line-height: 1.6; margin-bottom: 10px;">
                <strong>定数:</strong> ${data.minConst} ～ ${data.maxConst}${trendHtml} （全 ${totalSongs} 曲）<br>
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

        // [上部] 横並びボタンを配置
        html += actionButtonsHtml;

        // ソートロジック（WIN -> DRAW -> LOSE の順）
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
            return b.constant - a.constant;
        });

        html += `
            <div class="vs-table-scroll-container">
                <table class="vs-table-single">
                    <thead>
                        <tr>
                            <th class="vs-col-title">曲名</th>
                            <th class="vs-col-const">定数</th>
                            <th class="vs-col-score">${data.myName}</th>
                            <th class="vs-col-diff">点差</th>
                            <th class="vs-col-score">${oppName}</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        if (totalSongs === 0) {
            html += `<tr><td colspan="5" style="text-align:center; padding:20px; color:#999;">対象データがありません。</td></tr>`;
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

            html += `
                <tr>
                    <td class="vs-col-title"><div class="vs-song-title-scroll">${row.title}</div></td>
                    <td class="vs-col-const">${row.constant.toFixed(1)}</td>
                    <td class="vs-col-score">${formatScore(myScore)}</td>
                    <td class="vs-col-diff ${diffClass}">${diffStr}</td>
                    <td class="vs-col-score">${formatScore(oppScore)}</td>
                </tr>
            `;
        });

        html += `</tbody></table></div>`;

        // [下部] 横並びボタンを配置
        html += actionButtonsHtml;
        container.innerHTML = html;

        // ==========================================================================
        // B. 【3人、4人対戦の場合】
        // ==========================================================================
    } else {
        const basePlayer = forcedBasePlayer || data.myName;
        const vsRows = [...data.vsRows];
        const totalSongs = vsRows.length;
        const allActivePlayers = [data.myName, ...data.opponents];

        // 基準プレイヤー選択セレクトボックス
        let html = `
            <div style="text-align:left; margin-bottom:15px; font-size:16px; font-weight:bold;">
                <select id="vs-base-player-select" class="vs-select" style="width:auto; display:inline-block; font-size:15px; padding:4px 8px; margin-right:5px;" onchange="handleBasePlayerChange(this)">
        `;
        allActivePlayers.forEach(p => {
            const selected = (p === basePlayer) ? "selected" : "";
            html += `<option value="${p}" ${selected}>${p}</option>`;
        });
        html += `</select> のスコア比較結果</div>`;

        // ★ 定数の横辺りに自然に繋がるように ${trendHtml} を配置
        const displayOpponents = allActivePlayers.filter(p => p !== basePlayer).join('、');
        html += `
            <div class="vs-header-left" style="line-height: 1.6; margin-bottom: 10px;">
                <strong>定数:</strong> ${data.minConst} ～ ${data.maxConst}${trendHtml} （全 ${totalSongs} 曲）<br>
                <strong>対戦相手:</strong> ${displayOpponents}
            </div>
        `;

        // 各順位バケットの初期化
        const buckets = {};
        for (let r = 1; r <= totalPlayersCount; r++) { buckets[r] = []; }

        // 楽曲を順位ごとに仕分け
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

        // サマリー表示
        html += `<div class="vs-header-center">`;
        for (let r = 1; r <= totalPlayersCount; r++) {
            html += `<span style="font-weight:bold; margin:0 10px;">${r}位: <span style="font-size:18px;">${buckets[r].length}</span> 曲</span>`;
        }
        html += `</div>`;

        // [上部] 横並びボタンを配置
        html += actionButtonsHtml;

        // アコーディオン（順位ドロワー）の生成
        for (let dRank = 1; dRank <= totalPlayersCount; dRank++) {
            const songList = buckets[dRank];
            songList.sort((a, b) => b.constant - a.constant); // 定数降順

            html += `
                <details class="vs-drawer" ${dRank === 1 ? 'open' : ''}>
                    <summary>${dRank}位の楽曲 (${songList.length} 曲)</summary>
                    <div class="vs-drawer-content">
                        <div class="vs-table-scroll-container">
                            <table class="vs-table-single">
                                <thead>
                                    <tr>
                                        <th class="vs-col-title">曲名</th>
                                        <th class="vs-col-const">定数</th>
            `;

            // ヘッダー生成
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
                html += `<tr><td colspan="${2 + totalPlayersCount}" style="text-align:center; padding:20px; color:#999;">該当する楽曲がありません。</td></tr>`;
            }

            songList.forEach(song => {
                html += `
                    <tr>
                        <td class="vs-col-title"><div class="vs-song-title-scroll">${song.title}</div></td>
                        <td class="vs-col-const">${song.constant.toFixed(1)}</td>
                `;

                // 各順位列（1位〜最大4位）のデータを生成
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

        // [下部] 横並びボタンを配置
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



/**
 * モーダルの内容を画像化してDiscordへ送信
 */
async function shareToDiscord() {
    // 保存されているURLを取得
    let webhookUrl = localStorage.getItem('discord_webhook_url');

    // 保存されていない場合は入力を求める
    if (!webhookUrl) {
        webhookUrl = prompt("DiscordのWebhook URLを入力してください。\n(このURLはブラウザに保存され、公開されることはありません)");
        if (webhookUrl) {
            localStorage.setItem('discord_webhook_url', webhookUrl);
        } else {
            return; // キャンセルされた場合
        }
    }

    const modalContent = document.querySelector('#ranking-modal .modal-content');
    const sendBtn = document.getElementById('discord-share-btn');

    // 送信中スタイル適用
    sendBtn.innerText = "送信中...";
    sendBtn.disabled = true;
    sendBtn.classList.add('sending');

    try {
        sendBtn.innerText = "作成中...";
        sendBtn.disabled = true;

        // ★ 見切れ防止の修正：画像化するターゲットのスタイルを一時的に調整
        const originalWidth = modalContent.style.width;
        const originalMaxHeight = modalContent.style.maxHeight;
        const originalOverflow = modalContent.style.overflow;

        // 全体が入るように一時的に制限を解除
        modalContent.style.width = "850px"; // グラフ(800px)が余裕を持って収まる幅
        modalContent.style.maxHeight = "none";
        modalContent.style.overflow = "visible";

        const canvas = await html2canvas(modalContent, {
            backgroundColor: "#ffffff",
            scale: 2, // 高画質化
            useCORS: true,
            // 縦に長くなってもすべて収める設定
            windowWidth: 850,
            ignoreElements: (el) => el.tagName === 'BUTTON',
            onclone: (clonedDoc) => {
                // クローンされた方の要素だけさらに調整可能
                const clonedContent = clonedDoc.querySelector('.modal-content');
                clonedContent.style.padding = "20px";
            }
        });

        // 元に戻す
        modalContent.style.width = originalWidth;
        modalContent.style.maxHeight = originalMaxHeight;
        modalContent.style.overflow = originalOverflow

        canvas.toBlob(async (blob) => {
            const formData = new FormData();
            formData.append("file", blob, `ranking_${Date.now()}.png`);
            formData.append("payload_json", JSON.stringify({ content: "みろよみろよ" }));

            const response = await fetch(webhookUrl, { // 保存されたURLを使用
                method: "POST",
                body: formData
            });

            if (response.ok) {
                alert("Discordに送信しました！");
            } else {
                // URLが間違っている可能性があるため、一度クリアする
                if (confirm("送信に失敗しました。URLが間違っている可能性があります。設定をリセットしますか？")) {
                    localStorage.removeItem('discord_webhook_url');
                }
            }
            finishSending();
        }, "image/png");

    } catch (err) {
        console.error(err);
        alert("失敗しました。");
        finishSending();
    }

    function finishSending() {
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