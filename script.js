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
 * フィルター（検索窓 + セレクトボックス）の値を読み取って表示を更新する
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

        // 4. 【修正】Rank または スコア で絞り込み
        const tScore = parseFloat(item.score) || 0;
        let matchesRankOrScore = true;
        
        if (filterMode === 'rank') {
            // Rankモード時
            matchesRankOrScore = (tScore >= rankMin && tScore <= getUpperLimit(rankMax));
        } else {
            // スコアモード時（数値の範囲でダイレクトに判定）
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

        return matchesTitle && matchesRating && matchesConstant && matchesRankOrScore && matchesLamp && matchesType;
    });

    // 6. ソートの実行
    sortData(filteredData);

    // 描画
    displayScores(filteredData);


    // =================================================================
    // ★【連動拡張】適用中のフィルター条件をバッジでリアルタイム表示
    // =================================================================
    const activeContainer = document.getElementById('active-filters-container');
    const activeList = document.getElementById('active-filters-list');

    if (activeContainer && activeList) {
        activeList.innerHTML = ''; // 前回のバッジを一旦すべて消去
        let hasActiveFilter = false; // 初期値から変更されている条件があるかフラグ

        // バッジを生成して追加するミニ関数
        const addBadge = (text) => {
            const badge = document.createElement('span');
            badge.className = 'filter-badge';
            badge.textContent = text;
            activeList.appendChild(badge);
            hasActiveFilter = true; // 変更があったのでフラグを立てる
        };

        // 1. 単レ (下限または上限が入力されている場合)
        if (minRateVal !== "" || maxRateVal !== "") {
            addBadge(`単レ: ${minRateVal || '0'}〜${maxRateVal || '99.99'}`);
        }

        // 2. ランプ (すべて 'all' 以外の場合)
        if (lampValue !== 'all') {
            const lampText = lampSelect.options[lampSelect.selectedIndex]?.text || lampValue;
            addBadge(`ランプ: ${lampText}`);
        }

        // 3. 【修正】選択中のモード（Rankかスコア）に応じてバッジの中身をスイッチ
        if (filterMode === 'rank') {
            // Rank：下限が '0' 以外、または上限が '1010000(理論値)' 以外の場合に表示
            if (rankMinSelect.value !== '0' || rankMaxSelect.value !== '1010000') {
                const minText = rankMinSelect.options[rankMinSelect.selectedIndex]?.text || rankMin;
                const maxText = rankMaxSelect.options[rankMaxSelect.selectedIndex]?.text || rankMax;
                addBadge(`Rank: ${minText}〜${maxText}`);
            }
        } else {
            // スコア：下限または上限に入力がある場合に表示
            if (minScoreVal !== "" || maxScoreVal !== "") {
                // 三項演算子でカンマ区切りの見栄えにする（1010000 -> 1,010,000）
                const displayMin = minScoreVal !== "" ? Number(minScoreVal).toLocaleString() : '0';
                const displayMax = maxScoreVal !== "" ? Number(maxScoreVal).toLocaleString() : '1,010,000';
                addBadge(`スコア: ${displayMin}〜${displayMax}`);
            }
        }

        // 4. 定数 (下限が初期値 '13.5' 以外、または上限が初期値 '16.0' 以外の場合)
        if (minConstSelect.value !== '13.5' || maxConstSelect.value !== '16.0') {
            addBadge(`定数: ${minConstSelect.value}〜${maxConstSelect.value}`);
        }

        // 5. 対象 (全曲 'all' 以外の場合)
        if (typeof currentTypeFilter !== 'undefined' && currentTypeFilter !== 'all') {
            const targetBtn = document.getElementById(`filter-${currentTypeFilter}`);
            const targetText = targetBtn ? targetBtn.textContent.trim() : currentTypeFilter;
            addBadge(`対象: ${targetText}`);
        }

        // 変更されたフィルターが1つでもあれば表示、初期状態ならエリアごと隠す
        if (hasActiveFilter) {
            activeContainer.style.display = 'flex';
        } else {
            activeContainer.style.display = 'none';
        }
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

    // デフォルト値設定
    minConstSelect.value = "13.5";
    maxConstSelect.value = "16.0";

    // 各入力へのイベントリスナー登録 (セレクトボックス等)
    [minConstSelect, maxConstSelect, lampSelect, rankMinSelect, rankMaxSelect].forEach(el => {
        if (el) el.addEventListener('change', updateFilters);
    });
    // 各入力へのイベントリスナー登録 (数値入力・検索窓) ★スコア用の要素も追記
    [searchInput, minRateInput, maxRateInput, minScoreInput, maxScoreInput].forEach(el => {
        if (el) el.addEventListener('input', updateFilters);
    });

    // ★【新規追加】Rank / スコア モード切り替えイベントとカラー制御
    if (filterModeSelect) {
        filterModeSelect.addEventListener('change', (e) => {
            const currentMode = e.target.value;
            const rankContainer = document.getElementById('rank-filter-container');
            const scoreContainer = document.getElementById('score-filter-container');

            if (currentMode === 'rank') {
                // Rank選択時：赤色クラスを付与し、右側をRank用に切り替え
                filterModeSelect.classList.add('mode-rank');
                filterModeSelect.classList.remove('mode-score');
                if (rankContainer) rankContainer.style.display = 'flex';
                if (scoreContainer) scoreContainer.style.display = 'none';
            } else {
                // スコア選択時：青色クラスを付与し、右側をスコア用に切り替え
                filterModeSelect.classList.add('mode-score');
                filterModeSelect.classList.remove('mode-rank');
                if (rankContainer) rankContainer.style.display = 'none';
                if (scoreContainer) scoreContainer.style.display = 'flex';
            }
            // 表示とバッジを再計算
            updateFilters();
        });
    }

    // 7. 表示対象ボタン
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

    // 8. リセットボタン
    const clearBtn = document.getElementById('clear-filter');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (searchInput) searchInput.value = "";
            if (minConstSelect) minConstSelect.value = "13.5";
            if (maxConstSelect) maxConstSelect.value = "16.0";
            if (minRateInput) minRateInput.value = "";
            if (maxRateInput) maxRateInput.value = "";
            if (lampSelect) lampSelect.value = "all";

            // ランク・スコア範囲のリセット
            if (rankMinSelect) rankMinSelect.value = "0";
            if (rankMaxSelect) rankMaxSelect.value = "1010000";
            if (minScoreInput) minScoreInput.value = "";
            if (maxScoreInput) maxScoreInput.value = "";

            // ★【追加】リセット時にモード切り替えも初期の「Rank（赤色）」に戻す
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

            // ソートもデフォルト（Rating）に戻す場合
            currentSortKey = 'rating';
            document.getElementById('sort-Rating')?.classList.add('active');
            document.getElementById('sort-score')?.classList.remove('active');

            updateFilters();
        });
    }

    // 6. ソート切り替えボタン
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
 * 画面にスコアを表示する
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

    // ★ 表示件数を上位100件に制限
    const limitedData = data.slice(0, 200);

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

        // --- 3. テーブル行の作成 ---
        const tr = document.createElement('tr');
        tr.className = diff
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

        // HTML組み立て
        tr.innerHTML = `
            <td class="num-cell">${index + 1}</td> 
            <td>
                <div class="title-cell">${newBadge}${item.title || "Unknown"}</div>
                <div class="diff-level-cell">${diff} ${displayLevel}</div>
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
 * 特定の曲のランキングを取得して表示
 */
async function loadRanking(title, diff, songConst) {

    const modal = document.getElementById('ranking-modal');
    const rankingBody = document.getElementById('ranking-body');
    const titleContainer = document.getElementById('ranking-title-container');

    // --- 1. 表示エリアの切り替え（統計モードから通常モードへ復帰） ---
    const controls = document.getElementById('ranking-controls');
    const statsControlArea = document.getElementById('stats-control-area');

    if (controls) controls.style.display = 'block';           // グラフや範囲ボタンを表示
    if (statsControlArea) statsControlArea.style.display = 'none'; // 統計用切り替えボタンを隠す

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

    // 難易度と定数を span で囲んで1行に構成
    const displayDiff = diff ? diff.toUpperCase() : "";
    titleContainer.innerHTML = `
        ${title} 
        <span class="title-sub-info">${displayDiff} ${songConst || ""}</span>
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
                    // セル内の他のクリックイベント（もしあれば）と競合しないよう念のため
                    this.style.display = "none";
                    drawRankingChart();
                };

                // 自分の名前を強調
                const myName = localStorage.getItem('chunirec_player_name');
                if (row.playerName === myName) tr.classList.add('my-rank');

                // スコアの表示処理
                let scoreVal = row.score;
                const displayScore = (typeof scoreVal === 'number') ? scoreVal.toLocaleString() : scoreVal;

                // loadRanking などのループ処理内
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

            // 初回描画
            drawRankingChart(result.data);

        } else {
            rankingBody.innerHTML = "<tr><td colspan='4'>データがありません</td></tr>";
        }
    } catch (e) {
        rankingBody.innerHTML = "<tr><td colspan='4'>エラーが発生しました</td></tr>";
    }
}

// モーダルを閉じる処理（window.onload または initFilters 内に追加）
document.querySelector('.close-ranking')?.addEventListener('click', () => {
    document.getElementById('ranking-modal').style.display = "none";
});

window.onclick = (event) => {
    const modal = document.getElementById('ranking-modal');
    if (event.target == modal) modal.style.display = "none";
};


// 状態保持用の変数
let selectedPlayer = null;
let lastRankingData = []; // 再描画用にデータを保持

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

    // ★【修正】Rankかスコアのモードを判別し、送る数値を切り替える
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

    const requestParams = {
        mode: "get_stats",
        filterMode: filterMode, // GAS側でも判別できるようにモード情報も追加
        minConst: minC,
        maxConst: maxC,
        minRate: minRate,
        maxRate: maxRate,
        rankMin: rMin,
        rankMax: rMax,
        lampFilter: lmp,
        typeFilter: typeFilter
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

            currentStatsData = (mode === 'song') ? result.data.songRanking : result.data.playerRanking;
            currentStatsMode = mode;
            currentDisplayType = 'count';
            currentDenominator = (mode === 'song') ? result.data.totalUsers : result.data.theoryCount;

            const modal = document.getElementById('ranking-modal');

            // ★引数に filterMode を追加
            updateStatsTitle(typeFilter, minC, maxC, rMin, rMax, lmp, minRate, maxRate, filterMode);

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

    // ★【修正】再描画時にも正しい選択状態の値を取得してタイトルを更新
    const typeFilter = document.querySelector('.btn-filter.active')?.getAttribute('data-value') || 'all';
    const minC = document.getElementById('min-constant')?.value;
    const maxC = document.getElementById('max-constant')?.value;
    const minRate = document.getElementById('min-rating')?.value;
    const maxRate = document.getElementById('max-rating')?.value;
    const lmp = document.getElementById('lamp-filter')?.value;

    const filterMode = document.getElementById('filter-mode')?.value || 'rank';
    let rMin = "0";
    let rMax = "1010000";
    if (filterMode === 'rank') {
        rMin = document.getElementById('rank-min')?.value;
        rMax = document.getElementById('rank-max')?.value;
    } else {
        rMin = document.getElementById('min-score')?.value || "0";
        rMax = document.getElementById('max-score')?.value || "1010000";
    }

    updateStatsTitle(typeFilter, minC, maxC, rMin, rMax, lmp, minRate, maxRate, filterMode);
}

/**
 * 切り替えボタンと閉じるボタンを操作エリアに設置
 */
function renderSwitchButton() {
    const container = document.getElementById('stats-control-area');
    if (!container) return;

    // --- 1. ボタンを配置するためのラッパー（並びを整える列）を作る ---
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

    // --- 2. 切替ボタンの作成/更新 ---
    let switchBtn = document.getElementById('stats-switch-btn');
    if (!switchBtn) {
        switchBtn = document.createElement('button');
        switchBtn.id = 'stats-switch-btn';
        switchBtn.className = 'switch-mode-btn'; // CSSの既存スタイルを使用
        btnGroup.appendChild(switchBtn);
    }
    switchBtn.innerText = (currentDisplayType === 'count') ? "平均スコア順に切替" : "達成数順に切替";
    switchBtn.onclick = () => {
        currentDisplayType = (currentDisplayType === 'count') ? 'avg' : 'count';
        displayStatsRanking();
    };

    // --- 3. 閉じるボタンの作成/追加 (未作成の場合のみ) ---
    let closeBtn = document.getElementById('stats-top-close-btn');
    if (!closeBtn) {
        closeBtn = document.createElement('button');
        closeBtn.id = 'stats-top-close-btn';
        closeBtn.className = 'modal-close-btn'; // 既存の赤やグレーのスタイルを適用
        closeBtn.innerText = "閉じる";
        closeBtn.onclick = () => {
            document.getElementById('ranking-modal').style.display = 'none';
        };
        btnGroup.appendChild(closeBtn);
    }
}

// ★【修正】引数の最後に filterMode を追加
function updateStatsTitle(typeFilter, minC, maxC, rMin, rMax, lmp, minRate, maxRate, filterMode) {
    const titleContainer = document.getElementById('ranking-title-container');
    if (!titleContainer) return;

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

    if (currentDisplayType === 'avg') {
        subInfo = `定数: ${minC} ～ ${maxC}`;
    } else {
        // ★【修正】モードに応じて、タイトルのフィルター詳細テキストをきれいに切り替える
        let scoreLabel = "";
        if (filterMode === 'score') {
            const displayMin = rMin !== "0" && rMin !== "" ? Number(rMin).toLocaleString() : '0';
            const displayMax = rMax !== "1010000" && rMax !== "" ? Number(rMax).toLocaleString() : '1,010,000';
            scoreLabel = `スコア: ${displayMin}～${displayMax}`;
        } else {
            const rankMinSelect = document.getElementById('rank-min');
            const rankMaxSelect = document.getElementById('rank-max');
            const minText = rankMinSelect ? rankMinSelect.options[rankMinSelect.selectedIndex]?.text : rMin;
            const maxText = rankMaxSelect ? rankMaxSelect.options[rankMaxSelect.selectedIndex]?.text : rMax;
            scoreLabel = `Rank: ${minText}～${maxText}`;
        }

        subInfo = `定数: ${minC}～${maxC} / レート: ${minRate}～${maxRate} / ${scoreLabel} / ランプ: ${lampLabel}`;
    }

    titleContainer.innerHTML = `
        ${mainTitle}
        <div class="title-sub-info">${subInfo}</div>
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

    // ヘッダーを「プレイヤー詳細用」にリセット（配置を整える）
    if (thead) {
        thead.innerHTML = `
            <th style="text-align:center; padding-left: 15px;">プレイヤー</th>
            <th style="text-align:center;">スコア</th>
        `;
    }

    // 1. GASから届いた「この曲をプレイした人（全員）」をMap化
    const playDataMap = new Map();
    if (row.players) {
        row.players.forEach(p => {
            playDataMap.set(p.name, {
                score: p.score,
                isAchieved: p.isAchieved
            });
        });
    }

    // 2. 全プレイヤーのリスト（GASからの結果から抽出）
    const allPlayers = lastStatsResponse.playerRanking.map(p => p.playerName);

    // 3. 表示用のデータ配列を作成
    const displayList = allPlayers.map(name => {
        const data = playDataMap.get(name);
        return {
            name: name,
            score: data ? data.score : -1, // 未プレイは-1
            isAchieved: data ? data.isAchieved : false
        };
    });

    // 4. スコア順にソート（未プレイは最下部へ安全に固定するロジック）
    displayList.sort((a, b) => {
        if (a.score === -1 && b.score !== -1) return 1;  // aが未プレイなら下へ
        if (a.score !== -1 && b.score === -1) return -1; // bが未プレイなら上へ
        return b.score - a.score;                        // 両方プレイ済、または両方未プレイならスコア順
    });

    // 5. 行の生成
    displayList.forEach(p => {
        const tr = document.createElement('tr');

        // 条件達成者の行を赤くハイライト（厳密に true の場合のみ）
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
 * 個人別詳細を取得して表示（Rank・スコア切替完全対応版）
 */
async function fetchAndShowPlayerDetail(playerName) {
    console.log(playerName + "の詳細を取得中...");
    
    const subModal = document.getElementById('sub-modal');
    const title = document.getElementById('sub-modal-title');
    const tbody = document.getElementById('sub-modal-tbody');
    
    if (subModal && title) {
        title.innerText = `${playerName} の詳細を読み込み中...`;
        if (tbody) tbody.innerHTML = ""; // 前のデータをクリア
        subModal.style.display = "flex"; 
    }

    // --- 【超重要】選択されているモード（Rank か スコア か）に応じて、取得する値を厳密に切り替える ---
    const filterMode = document.getElementById('filter-mode')?.value; // "rank" または "score"
    
    let rMin = "";
    let rMax = "";

    if (filterMode === "score") {
        // 「スコア」手入力モードの場合
        rMin = document.getElementById('min-score')?.value || "";
        rMax = document.getElementById('max-score')?.value || "";
    } else {
        // 「Rank」セレクトボックスモードの場合（デフォルト）
        rMin = document.getElementById('rank-min')?.value || "";
        rMax = document.getElementById('rank-max')?.value || "";
    }

    // GASに送信するパラメータ群
    const params = {
        mode: "get_player_detail",
        filterMode: filterMode, // ★GASに現在のモードを教える（追加）
        playerName: playerName,
        minConst: document.getElementById('min-constant')?.value,
        maxConst: document.getElementById('max-constant')?.value,
        minRate: document.getElementById('min-rating')?.value,
        maxRate: document.getElementById('max-rating')?.value,
        
        // 選択された側の正しいスコア境界値のみをGASに送る
        rankMin: rMin,
        rankMax: rMax,
        
        lampFilter: document.getElementById('lamp-filter')?.value,
        typeFilter: document.querySelector('.btn-filter.active')?.getAttribute('data-value') || 'all'
    };

    try {
        const response = await fetch(GAS_URL, {
            method: "POST",
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(params)
        });
        const result = await response.json();

        if (result.status === "success") {
            // モーダル描画関数を呼び出し
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

    // 横幅の比率を「70% : 30%」に完全固定
    thead.innerHTML = `
        <th style="text-align: center; padding-left: 0px; width: 70%;">楽曲名</th>
        <th style="text-align: center; width: 30%;">スコア</th>
    `;

    // Webkit用のスクロールバー非表示スタイルは、ループの外で「1回だけ」適用する
    const styleId = "scrollbar-hide-style";
    if (!document.getElementById(styleId)) {
        const styleTag = document.createElement('style');
        styleTag.id = styleId;
        styleTag.textContent = `#sub-modal-tbody div::-webkit-scrollbar { display: none; }`;
        document.head.appendChild(styleTag);
    }

    const noScrollbarStyle = "scrollbar-width: none; -ms-overflow-style: none;";

    // データの描画
    playerData.details.forEach(item => {
        const tr = document.createElement('tr');

        // ★修正ポイント2：GAS側で判定された isAchieved が「確実に真(true)」である場合のみハイライト
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

    // モーダルを表示
    document.getElementById('sub-modal').style.display = 'flex';
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