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

    // 💡 アクティブな難易度（diff）を取得
    const activeDiffs = Array.from(document.querySelectorAll('.btn-diff-filter.active')).map(btn => btn.getAttribute('data-diff'));

    // 💡【追加】WE単体、またはWEを含むマルチ選択かをチェック
    const hasWE = activeDiffs.includes("WE");
    const isOnlyWE = activeDiffs.length === 1 && hasWE;

    // フィルタリング実行
    const filteredData = myCurrentRecords.filter(item => {
        // 1. 曲名で絞り込み
        const title = String(item.title || "").toLowerCase();
        const matchesTitle = title.includes(searchText);

        // 💡 難易度（diff）で絞り込み
        const itemDiff = String(item.diff || "").toUpperCase();
        const matchesDiff = activeDiffs.includes(itemDiff);

        // 2. Ratingで絞り込み（★WE選択時は単曲レートフィルターを無視・免除）
        const currentRate = parseFloat(item.rating) || 0;
        const isRateExempt = (itemDiff === "WE" && hasWE); 
        const matchesRating = isRateExempt || (currentRate >= minRate && currentRate <= maxRate);

        // 3. 定数で絞り込み（★WE用のエスケープ安全弁付きに強化）
        const constant = parseFloat(item.const) || 0;
        // 現在の曲がWE、かつ難易度WEが選択されている場合は、定数フィルター(13.5〜16.0)をパスさせる
        const isWeExempt = (itemDiff === "WE" && hasWE);
        const matchesConstant = isWeExempt || (constant >= minConst && constant <= maxConst);

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

        // 7. 表示対象（全曲/旧曲/新曲）判定（★WE選択時は強制的に「全曲(all)」として扱いパスさせる）
        let matchesType = true;
        const effectiveTypeFilter = hasWE ? 'all' : currentTypeFilter;
        if (effectiveTypeFilter === 'old') matchesType = !item.isNew;
        if (effectiveTypeFilter === 'new') matchesType = item.isNew;

        // トレンドフィルター判定
        let matchesTrend = true;
        if (isTrendEnabled) {
            const songTrend = item.mainTrend || "None";
            matchesTrend = activeTrends.includes(songTrend);
        } else {
            matchesTrend = true;
        }

        return matchesTitle && matchesRating && matchesDiff && matchesConstant && matchesRankOrScore && matchesLamp && matchesType && matchesTrend;
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

        // 難易度バッジ表示（デフォルト[EXP, MAS, ULT]以外になっている時だけバッジ表示）
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

        // 💡【追加条件】WE選択時は「単レバッジ」を表示しない
        if (!hasWE && (minRateVal !== "" || maxRateVal !== "")) {
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

        // 定数フィルターが有効なバッジ表示条件（WE選択時は定数が意味を持たないため非表示）
        if ((minConstSelect.value !== '13.5' || maxConstSelect.value !== '16.0') && !hasWE) {
            addBadge(`定数: ${minConstSelect.value}〜${maxConstSelect.value}`);
        }

        // 💡【条件変更】WE選択時は強制的に「対象: 全曲」のバッジを出すか、不要なら出さないように制御
        if (hasWE) {
            // WE選択時は「対象: 全曲」に固定されることをユーザーに明示
            addBadge(`対象: 全曲 (WE固定)`);
        } else if (typeof currentTypeFilter !== 'undefined' && currentTypeFilter !== 'all') {
            const targetBtn = document.getElementById(`filter-${currentTypeFilter}`);
            const targetText = targetBtn ? targetBtn.textContent.trim() : currentTypeFilter;
            addBadge(`対象: ${targetText}`);
        }

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

    // 表示対象ボタン（ここは元のコードのまま）
    document.querySelectorAll('.btn-filter').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const activeDiffs = Array.from(document.querySelectorAll('.btn-diff-filter.active')).map(btn => btn.getAttribute('data-diff'));
            if (activeDiffs.includes("WE")) {
                alert("WORLD'S END選択時は、表示対象を「全曲」から変更できません。");
                return;
            }

            document.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            if (e.target.id === 'filter-all') currentTypeFilter = 'all';
            else if (e.target.id === 'filter-old') currentTypeFilter = 'old';
            else if (e.target.id === 'filter-new') currentTypeFilter = 'new';
            updateFilters();
        });
    });


    // =================================================================
    // 🎨 【ここから差し替え】難易度ボタンのカラー定義と強制スタイル適用
    // =================================================================
    const diffStyles = {
        'EXP': { bg: '#ff4c4c', text: '#ffffff' },
        'MAS': { bg: '#aa33ff', text: '#ffffff' },
        'ULT': { bg: '#222222', text: '#ffcc00' },
        'WE':  { bg: 'linear-gradient(90deg, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #4b0082, #9400d3)', text: '#ffffff' }
    };
    const inactiveStyle = { bg: '#e2e8f0', text: '#64748b' }; // OFF時のグレー

    // 💡 端末やOS、ブラウザのお節介デザインを完全破壊してスタイルを強制同期する関数
    function syncDiffButtonStyles() {
        document.querySelectorAll('.btn-diff-filter').forEach(btn => {
            const diff = btn.getAttribute('data-diff');
            
            // 🔥【最重要】Safariや各アプリ内ブラウザ固有のデフォルト装飾をすべて剥奪
            btn.style.webkitAppearance = 'none';
            btn.style.mozAppearance = 'none';
            btn.style.appearance = 'none';
            btn.style.border = 'none';
            btn.style.outline = 'none';
            btn.style.boxShadow = 'none';
            btn.style.borderRadius = '6px'; // 必要に応じて角丸を設定（お好みのサイズに）
            btn.style.padding = '6px 12px';  // 必要に応じてパディングを設定
            
            // 🔥 iOSのダークモードによる「自動色反転」や「コントラスト調整」を無効化
            btn.style.colorScheme = 'light'; 

            if (btn.classList.contains('active')) {
                const conf = diffStyles[diff] || { bg: '#718093', text: '#ffffff' };
                btn.style.background = conf.bg;
                btn.style.color = conf.text;
                btn.style.fontWeight = 'bold';
                if (diff === 'WE') {
                    btn.style.textShadow = '1px 1px 2px rgba(0,0,0,0.8)';
                } else {
                    btn.style.textShadow = 'none';
                }
            } else {
                btn.style.background = inactiveStyle.bg;
                btn.style.color = inactiveStyle.text;
                btn.style.fontWeight = 'normal';
                btn.style.textShadow = 'none';
            }
        });
    }

    // 💡 メイン画面 難易度ボタンの相互排他クリックイベント（スタイル適用連動）
    document.querySelectorAll('.btn-diff-filter').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const clickedBtn = e.target;
            const clickedDiff = clickedBtn.getAttribute('data-diff');

            // まずクリックされたボタン自身をトグル（ON/OFF反転）
            clickedBtn.classList.toggle('active');

            // 排他判定を実行
            if (clickedBtn.classList.contains('active')) {
                if (clickedDiff === "WE") {
                    // WEがONになったら、新曲・旧曲ボタンのactiveを「全曲」に強制リセット
                    document.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'));
                    const allBtn = document.getElementById('filter-all');
                    if (allBtn) allBtn.classList.add('active');
                    currentTypeFilter = 'all';

                    // 通常難易度（EXP, MAS, ULT）をすべてOFFにする
                    document.querySelectorAll('.btn-diff-filter:not([data-diff="WE"])').forEach(b => {
                        b.classList.remove('active');
                    });
                } else {
                    // 通常難易度のいずれかがアクティブになったら、WEをOFFにする
                    document.querySelectorAll('.btn-diff-filter[data-diff="WE"]').forEach(b => {
                        b.classList.remove('active');
                    });
                }
            }

            // 🎨 スタイルをその場で強制適用
            syncDiffButtonStyles();

            // 最後に表示を更新
            updateFilters();
        });
    });

    // トレンド初期設定（ここは元のコードのまま）
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
                if (isEnabled) {
                    btn.classList.add('active');
                    btn.classList.remove('trend-disabled');
                } else {
                    btn.classList.remove('active');
                    btn.classList.add('trend-disabled');
                }
            });
            updateFilters();
        });
    }

    document.querySelectorAll('.btn-trend-filter').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (trendSwitch && !trendSwitch.checked) return;
            e.target.classList.toggle('active');
            updateFilters();
        });
    });

    // 💡 リセットボタン（難易度リセット時のスタイル適用連動）
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

            // リセット時に難易度ボタンをデフォルト（EXP, MAS, ULTがON、WEがOFF）に戻す
            document.querySelectorAll('.btn-diff-filter').forEach(b => {
                const diff = b.getAttribute('data-diff');
                if (diff === 'WE') {
                    b.classList.remove('active');
                } else {
                    b.classList.add('active');
                }
            });

            // 🎨 リセットした見た目を即座に強制上書き適用
            syncDiffButtonStyles();

            currentSortKey = 'rating';
            document.getElementById('sort-Rating')?.classList.add('active');
            document.getElementById('sort-score')?.classList.remove('active');

            updateFilters();
        });
    }

    // ソート切り替えボタン（ここは元のコードのまま）
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

    // 💡【初回実行】初期化の最後に、現在のON/OFF（デフォルト状態）のカラーを強制注入
    syncDiffButtonStyles();
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
 * 画面にスコアを表示する（💡既存CSS完全継承・Main Trend色変更版・WE最適化）
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
        body.innerHTML = "<tr><td colspan='5'>表示できるデータがありません</td></tr>";
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
        // GAS側から送られてくる diff (MAS, ULT, WE等) を取得
        const diffRaw = String(item.diff || "");
        const diffLower = diffRaw.toLowerCase();
        const isWE = (diffRaw.toUpperCase() === "WE");

        // 数値としての定数とスコア、Ratingを取得
        const currentConst = parseFloat(item.const) || 0;
        const tScore = parseFloat(item.score) || 0;
        const RatingNum = parseFloat(item.rating) || 0;

        // 💡【WE対応：定数非表示 / 通常は定数表示】の切り替え
        let diffLevelText = "";
        if (isWE) {
            // WEの場合は定数を完全に非表示にし、属性（例: 狂、跳など）を【】付きでスマートに表示
            const attr = item.weAttr || item.attribute || "";
            diffLevelText = `WORLD'S END ${attr ? `【${attr}】` : ""}`;
        } else {
            // 通常譜面は従来通り「MAS 14.5」などの形式
            const displayLevel = currentConst > 0 ? currentConst.toFixed(1) : "-";
            diffLevelText = `${diffRaw} ${displayLevel}`;
        }

        // 💡【WE対応：単曲Ratingを「-」に固定】
        const RatingText = (!isWE && RatingNum > 0)
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

        // トレンドHTML
        let trendHtml = "";
        if (item.mainTrend && item.mainTrend !== "None") {
            const trendColor = colorMap[item.mainTrend] || "#555";
            trendHtml = ` / <span style="color: ${trendColor};">${item.mainTrend}</span>`;
        }

        // --- 3. テーブル行の作成 ---
        const tr = document.createElement('tr');
        tr.className = diffLower; // クラス名はCSSに合わせて小文字（we, mas, ult等）
        tr.style.cursor = "pointer";

        // クリックイベント：ランキング機能を呼び出す
        tr.onclick = () => {
            if (typeof loadRanking === "function") {
                loadRanking(item.title, diffRaw, item.const);
            }
        };

        // ハイライト判定 (WEは単レ算出がないため、通常曲のみハイライト判定を行う)
        if (!isWE && RatingNum > 0) {
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
                <div class="diff-level-cell">${diffLevelText}${trendHtml}</div>
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

    // 引数で送られてきた生のdiff文字列を1ミリも書き換えずに保存する
    const originalDiff = diff;

    let cleanDiff = diff ? String(diff).trim().toUpperCase() : "";
    if (cleanDiff.includes("WORLD") || cleanDiff === "WE") {
        cleanDiff = "WE";
    }
    const isWE = (cleanDiff === "WE");

    // --- 1. 表示エリアの切り替え ---
    const controls = document.getElementById('ranking-controls');
    const statsControlArea = document.getElementById('stats-control-area');
    const radarContainer = document.getElementById('radar-chart-container');
    const videoSection = document.getElementById("ranking-video-section");

    if (controls) controls.style.display = 'block';
    if (statsControlArea) statsControlArea.style.display = 'none';

    if (videoSection) videoSection.style.display = 'block';
    if (radarContainer) radarContainer.style.display = isWE ? 'none' : 'block';

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

    // ① モーダルが開いた瞬間に、一度描画を試みる（この時点では空の可能性あり）
    if (typeof updateRankingVideoSection === "function") {
        updateRankingVideoSection(title, originalDiff);
    }

    const displayDiff = isWE ? "WORLD'S END" : cleanDiff;
    // 引数で送られてくる変数をそのまま安全にエスケープして関数に渡す準備
    const escapedTitle = title.replace(/'/g, "\\'");
    const escapedDiff = originalDiff ? originalDiff.replace(/'/g, "\\'") : "";

    titleContainer.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 15px; flex-wrap: wrap;">
        <span style="font-size: 20px; font-weight: bold;">${title}</span>
        <div style="display: flex; gap: 8px; align-items: center;">
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

    // 💡「全員を再表示」ボタンのクリックイベントをここで登録
    const showAllBtn = document.getElementById('btn-ranking-showall');
    if (showAllBtn) {
        showAllBtn.onclick = function () {
            // テーブルの全行（tr）を表示に戻す
            document.querySelectorAll('#ranking-body tr').forEach(tr => {
                tr.style.display = '';
            });
            // ボタン自体をまた隠す
            this.style.display = 'none';
            // チャートを全員分で再描画
            if (typeof drawRankingChart === "function") drawRankingChart();
        };
    }

    // 💡 キャッシュキーの作成（曲名＋難易度）
    const cacheKey = `${title}_${cleanDiff}`.toLowerCase();
    const now = Date.now();
    const CACHE_TIMEOUT = 5 * 60 * 1000; // ⏳ キャッシュの有効期限：5分

    // 💡 【高速化①】もし5分以内のキャッシュがあれば、GAS通信をスキップして一瞬で描画
    if (window.rankingCache[cacheKey] && (now - window.rankingCache[cacheKey].timestamp < CACHE_TIMEOUT)) {
        console.log("⚡ キャッシュからランキングを高速描画します:", title);
        const cachedResult = window.rankingCache[cacheKey].result;

        // 描画処理を共通関数に丸投げして即終了
        renderRankingData(cachedResult, title, cleanDiff, songConst, originalDiff, isWE, displayDiff);
        modal.style.display = "flex";

        // 裏で動画データのチェックと補完だけ走らせる
        triggerBackgroundVideoFetch(title, originalDiff, isWE);
        return;
    }

    // キャッシュがない場合は「読み込み中」にしてモーダルを開く
    rankingBody.innerHTML = "<tr><td colspan='4'>読み込み中...</td></tr>";
    modal.style.display = "flex";

    // -------------------------------------------------------------
    // 💡【高速化②】足並みを揃えるのをやめ、最優先のランキング通信のみ単独で待つ
    // -------------------------------------------------------------
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

    // 動画の裏読み（必要な場合のみ）は Promise.all に入れず、完全に独立させてバックグラウンドへ流す
    triggerBackgroundVideoFetch(title, originalDiff, isWE);

    try {
        console.log("送るデータ:", { title, diff: cleanDiff, const: songConst });

        const result = await rankingPromise;

        if (result.status === "success" && result.data) {
            // 💡 取得データをキャッシュに保存（5分間有効）
            window.rankingCache[cacheKey] = {
                timestamp: now,
                result: result
            };

            // 画面への描画を実行
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

    rankingBody.innerHTML = "";
    result.data.forEach((row, index) => {
        const tr = document.createElement('tr');
        tr.style.cursor = "pointer";
        tr.dataset.playerName = row.playerName;

        // 💡 行クリックで非表示＆チャート再描画のロジックは綺麗に残します
        tr.onclick = function (e) {
            // 🛑 誤動作防止：行の中のリンクやボタン（もしあれば）が押された時は非表示にしない
            if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON' || e.target.closest('button')) return;

            // クリックされた行を非表示にする
            this.style.display = 'none';

            // 📊 行が消えた最新の状態を反映して、チャートを再描画する
            if (typeof drawRankingChart === "function") {
                drawRankingChart();
            }
        };

        const myName = localStorage.getItem('chunirec_player_name');
        if (row.playerName === myName) tr.classList.add('my-rank');

        let scoreVal = row.score;
        const displayScore = (typeof scoreVal === 'number') ? scoreVal.toLocaleString() : scoreVal;

        const lampText = row.lamp || "";
        let badgeClass = "";
        if (lampText.includes("AJC")) badgeClass = "ajc-badge";
        else if (lampText.includes("AJ")) badgeClass = "aj-badge";
        else if (lampText.includes("FC")) badgeClass = "fc-badge";

        // 💡 ランキングテーブル側は余計なボタンを入れず、元のシンプルな状態に戻します
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

        if (isWE) {
            const attr = props.weAttr || props.attribute || props.attr || "";
            subInfoContainer.innerHTML = `<span class="diff-const-txt">WORLD'S END ${attr ? `【${attr}】` : ""}</span>`;
        } else {
            const latestConst = props.constant ? result.songProps.constant : songConst;
            const finalConst = latestConst ? parseFloat(latestConst).toFixed(1) : "-";

            let subHtml = `<span class="diff-const-txt">${displayDiff} ${finalConst}</span><span id="trend-container"></span>`;
            subInfoContainer.innerHTML = subHtml;

            const trendContainer = document.getElementById('trend-container');
            if (trendContainer) {
                let trendHtml = "";
                if (props.mainTrend && props.mainTrend !== "None") {
                    const mainColor = colorMap[props.mainTrend] || "#666";
                    trendHtml += `<span style="color: ${mainColor}; font-weight: 900; margin-left: 12px;">${props.mainTrend}</span>`;

                    if (props.subTrend && props.subTrend !== "None" && props.subTrend !== props.mainTrend) {
                        const subColor = colorMap[props.subTrend] || "#666";
                        trendHtml += ` <span style="color: #888; font-weight: normal;">/</span> <span style="color: ${subColor}; font-weight: 900;">${props.subTrend}</span>`;
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
                        callback: function (label, index) {
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

    subTitle.innerText = row.title || "プレイヤー状況一覧";
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