const GAS_URL = "https://script.google.com/macros/s/AKfycbwoY_GDDxWL_QH-9O9a_Oy6z8QK7Cq009a0ORgApc9f9BQGXEauUNcoiXqeQ3WRBvVx/exec"

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

/**
 * 起動時に実行
 */
window.onload = function () {
    initFilters();
};

/** 
 * キャッシュ
 */
window.addEventListener('DOMContentLoaded', () => {
    const savedToken = localStorage.getItem('chunirec_token');
    const cachedData = localStorage.getItem('chunirec_scores');
    const cacheTime = localStorage.getItem('chunirec_cache_time');
    const savedName = localStorage.getItem('chunirec_player_name');

    if (savedToken) {
        // IDが api-token ではなく token-input のはずなので修正
        const tokenInput = document.getElementById('token-input');
        if (tokenInput) tokenInput.value = savedToken;
    }

    // キャッシュがあり、かつ前回から24時間以内なら自動表示
    // (1000ms * 60s * 60m * 24h = 86,400,000ms)
    const isFresh = cacheTime && (Date.now() - parseInt(cacheTime) < 86400000);

    // データ・名前・時間のすべてが揃っている場合のみ自動ログイン
    if (cachedData && savedName && isFresh) {
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
        btn.innerText = "🔒"; // 表示中にする
    } else {
        input.type = "password";
        btn.innerText = "👁️"; // 非表示（伏せ字）にする
    }
}

async function loadScores() {
    const tokenInput = document.getElementById("token-input");
    const loadBtn = document.getElementById("load-btn");
    const loadingMsg = document.getElementById("loading-msg");
    const errorMsg = document.getElementById("token-error");
    const token = tokenInput.value.trim();

    if (!token) return;

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

        const result = await response.json();

        if (result.status === "need_name") {
            const name = prompt("新規ユーザーです。ユーザー名を入力してください（以後自分では変更不可）");
            if (!name) throw new Error("登録をキャンセルしました");

            const res2 = await fetch(GAS_URL, {
                method: "POST",
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ mode: "checker", token: token, playerName: name })
            });
            const result2 = await res2.json();
            handleSuccess(result2);
        } else if (result.status === "success") {
            handleSuccess(result);
        } else {
            throw new Error(result.message);
        }
    } catch (e) {
        console.error(e);
        errorMsg.innerText = "エラー: " + e.message;
        errorMsg.style.display = "block";
    } finally {
        loadBtn.disabled = false;
        loadBtn.innerText = "スコアを表示";
        loadingMsg.style.display = "none";
    }
}

/**
 * データを再同期する（ボタン用）
 */
function refreshScores() {
    // ボタンを無効化して連打防止
    const btn = document.querySelector('.refresh-btn');
    if (!btn || btn.disabled) return;

    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "同期中...";

    // 既存の loadScores を実行（通信が始まる）
    loadScores().finally(() => {
        // 終わったらボタンを戻す（loadScoresにPromiseを返させる場合）
        btn.disabled = false;
        btn.innerText = originalText;
    });
}

function handleSuccess(result) {
    console.log("成功ルート突入", result);

    // 1. データの保存
    myCurrentRecords = result.records;

    // 2. トークンの安全な取得と保存
    const tokenInput = document.getElementById('api-token');
    if (tokenInput) {
        // 入力欄が存在する場合のみ、その値を保存する
        localStorage.setItem('chunirec_token', tokenInput.value);
    }

    // スコアと名前をキャッシュに保存
    localStorage.setItem('chunirec_scores', JSON.stringify(result.records));
    localStorage.setItem('chunirec_player_name', result.playerName);
    localStorage.setItem('chunirec_cache_time', Date.now().toString());

    // 3. UIの切り替え
    document.getElementById("token-screen").style.display = "none";
    document.getElementById("main-screen").style.display = "block";

    // 4. レート計算と表示
    calculatechuniRate(result.playerName);
    displayScores(myCurrentRecords);

    // 再同期ボタンを元に戻す（もしあれば）
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

    // ★新しく取得する要素
    const rankMinSelect = document.getElementById('rank-min');
    const rankMaxSelect = document.getElementById('rank-max');

    if (!searchInput || !minConstSelect || !maxConstSelect || !rankMinSelect || !rankMaxSelect || !lampSelect) return;

    const searchText = searchInput.value.toLowerCase().trim();
    const minConst = parseFloat(minConstSelect.value);
    const maxConst = parseFloat(maxConstSelect.value);

    const rankMin = parseFloat(rankMinSelect.value);
    const rankMax = parseFloat(rankMaxSelect.value);

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

        // 4. ランク範囲判定
        const tScore = parseFloat(item.score) || 0;

        // 選択された下限以上、かつ上限「区分」の境界値未満
        // 例: SSS(1007500) ～ SSS+(1009000) なら 1007500 <= score < 1009900(99AJの境界)
        // ここでは単純に選択された数値で比較するのが直感的です
        const matchesRank = (tScore >= rankMin && tScore <= getUpperLimit(rankMax));

        // 5. ランプで絞り込み
        const itemLamp = item.lamp || "None";
        let matchesLamp = true;

        if (lampValue !== 'all') {
            if (lampValue === 'ajc') {
                // AJCのみを表示
                matchesLamp = itemLamp.includes('AJC') || itemLamp.includes('JUSTICE CRITICAL');
            } else if (lampValue === 'aj') {
                // AJ以上を表示（AJCを含める）
                // includes('AJ') を使うことで、"ALL JUSTICE" と "ALL JUSTICE CRITICAL" の両方にヒットします
                matchesLamp = itemLamp.includes('AJ') || itemLamp.includes('JUSTICE');
            } else if (lampValue === 'None') {
                // 未AJ（AJ未満）を表示
                // 「AJ」という文字が含まれていないものを抽出
                const hasAJ = itemLamp.includes('AJ') || itemLamp.includes('JUSTICE');
                matchesLamp = !hasAJ;
            }
        }

        // 7. 表示対象（全曲/旧曲/新曲）判定
        let matchesType = true;
        if (currentTypeFilter === 'old') matchesType = !item.isNew;
        if (currentTypeFilter === 'new') matchesType = item.isNew;

        return matchesTitle && matchesRating && matchesConstant && matchesRank && matchesLamp && matchesType;
    });

    // 6. ソートの実行
    sortData(filteredData);

    // 描画
    displayScores(filteredData);
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
    const rankMinSelect = document.getElementById('rank-min');
    const rankMaxSelect = document.getElementById('rank-max');

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

    // 各入力へのイベントリスナー登録
    [minConstSelect, maxConstSelect, lampSelect, rankMinSelect, rankMaxSelect].forEach(el => {
        if (el) el.addEventListener('change', updateFilters);
    });
    [searchInput, minRateInput, maxRateInput].forEach(el => {
        if (el) el.addEventListener('input', updateFilters);
    });


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

            // ★修正：ランク範囲のリセット
            // 下限を「0」、上限を「1010000（理論値）」に設定
            if (rankMinSelect) rankMinSelect.value = "0";
            if (rankMaxSelect) rankMaxSelect.value = "1010000";

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

    // トータルレート算出：切り捨て済みの枠平均から算出し、最後に第3位切り捨て
    const totalRate = floorTo2nd((newData.avg * 20 + bestData.avg * 30) / 50);

    // --- HTML出力 ---
    const displayName = playerName || "Player";

    rateDisplay.innerHTML = `
        <div class="rating-container">
            <span class="user-name"><strong>${displayName}</strong></span>
            <span class="divider">|</span>
            <span class="rate-total">Rating: <span class="highlight-number main-rate">${totalRate.toFixed(2)}</span></span>
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
    // ★修正：下限と上限のセレクトボックスを取得
    const rankMinSelect = document.getElementById('rank-min');
    const rankMaxSelect = document.getElementById('rank-max');

    const searchText = searchInput ? searchInput.value.toLowerCase().trim() : "";
    const minConst = minConstSelect ? parseFloat(minConstSelect.value) : 0;
    const maxConst = maxConstSelect ? parseFloat(maxConstSelect.value) : 20;
    const minRate = (minRateInput && minRateInput.value !== "") ? parseFloat(minRateInput.value) : 0;
    const maxRate = (maxRateInput && maxRateInput.value !== "") ? parseFloat(maxRateInput.value) : 99.99;
    const lampValue = lampSelect ? lampSelect.value : 'all';
    // ★追加：基準スコアと方向の取得
    const rankMin = rankMinSelect ? parseFloat(rankMinSelect.value) : 0;
    const rankMax = rankMaxSelect ? parseFloat(rankMaxSelect.value) : 1010000;


    // ここで candidates を定義
    const candidates = myCurrentRecords.filter(item => {
        const title = String(item.title || "").toLowerCase();
        if (!title.includes(searchText)) return false;

        const currentRate = parseFloat(item.rating) || 0;
        if (currentRate < minRate || currentRate > maxRate) return false;

        const constant = parseFloat(item.const) || 0;
        if (constant < minConst || constant > maxConst) return false;

        // ★修正：ランク範囲判定（スコア比較）
        const tScore = parseFloat(item.score) || 0;
        // 下限以上 かつ 上限区分の最大値以下（getUpperLimitを使用）
        if (tScore < rankMin || tScore > getUpperLimit(rankMax)) return false;

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

    // 3. ルーレット演出
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

    // --- script.js の pickRandomSong 関数内、finishSelection 関数を差し替え ---

    // 4. 最終決定時の処理
    function finishSelection() {
        // 本当の決定曲を選ぶ
        const picked = candidates[Math.floor(Math.random() * candidates.length)];

        // --- ★ ここから追加：ド派手エフェクト ---

        // ① 画面を一瞬真っ白にフラッシュさせるフラッシュ層を作成
        const flash = document.createElement('div');
        flash.style = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: white; z-index: 10001; opacity: 1;
            transition: opacity 0.5s ease-out; /* 0.5秒かけて消えていく */
        `;
        document.body.appendChild(flash);

        // ② 決定した曲名の表示を豪華にする
        titleEl.style.color = "#f1c40f"; // 金色
        titleEl.style.textShadow = "0 0 15px #fff, 0 0 30px #f1c40f, 0 0 45px #f1c40f"; // 黄金の輝き（グロー効果）
        titleEl.style.transform = "scale(1.2)"; // 少し大きく
        titleEl.style.transition = "all 0.5s ease-out"; // 演出を滑らかに
        titleEl.innerText = picked.title;

        diffEl.innerText = picked.diff;
        // 難易度色はルーレット最後のを引き継ぐか、pickedので再設定（ここではpickedで再設定）
        const diffColors = { 'basic': '#22ac22', 'advanced': '#f39c12', 'expert': '#e74c3c', 'master': '#9b59b6', 'ultima': '#222' };
        diffEl.style.backgroundColor = diffColors[picked.diff.toLowerCase()] || '#555';
        diffEl.style.boxShadow = `0 0 20px ${diffEl.style.backgroundColor}`; // 難易度バッジも光らせる

        // ③ フラッシュ層をアニメーション後に削除
        requestAnimationFrame(() => {
            flash.style.opacity = "0"; // フェードアウト開始
            setTimeout(() => {
                if (document.body.contains(flash)) document.body.removeChild(flash);
            }, 500); // transitionの時間と合わせる
        });

        // --- ★ ここまで追加 ---

        // 1.5秒待ってから（演出を見せてから）画面を消して、実際の行へ移動
        setTimeout(() => {
            if (document.body.contains(overlay)) {
                document.body.removeChild(overlay);
            }

            // --- 以降、スクロールとランキング表示のロジックはそのまま ---
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
                    targetRow.style.background = "rgba(241, 196, 15, 0.5)"; // スクロール先も金色に光らせる
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

    // --- 統計モードからのリセット処理 ---
    const modalTableHead = document.querySelector('#ranking-modal table thead tr');
    if (modalTableHead) {
        modalTableHead.innerHTML = `
            <th>順位</th>
            <th>プレイヤー</th>
            <th>スコア</th>
            <th>ランプ</th>
        `;
    }

    const rangeSelector = document.querySelector('.range-selector');
    if (rangeSelector) {
        rangeSelector.style.display = 'flex'; // または 'block'
    }

    const canvas = document.getElementById('ranking-canvas');
    if (canvas) canvas.style.display = 'block'; // キャンバスを表示に戻す

    // --- ここでリセット処理を行う ---
    selectedPlayer = null;    // 選択状態を解除
    lastRankingData = [];     // キャッシュデータを空にする

    // キャンバスを一度真っ白にする
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
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
 * @param {String} mode 'player' または 'song'
 */
async function fetchStats(mode) {
    console.log("--- fetchStats Start --- Mode:", mode);

    // ボタン制御
    const btnP = document.getElementById('stats-player-btn');
    const btnS = document.getElementById('stats-song-btn');
    const currentBtn = (mode === 'player') ? btnP : btnS;

    if (currentBtn) {
        currentBtn.disabled = true;
        currentBtn.innerText = "集計中...";
    }

    // フィルタ値の取得
    const typeFilter = document.querySelector('.btn-filter.active')?.getAttribute('data-value') || 'all';
    const minC = document.getElementById('min-constant')?.value || "0";
    const maxC = document.getElementById('max-constant')?.value || "16.0";
    const rMin = document.getElementById('rank-min')?.value || "0";
    const rMax = document.getElementById('rank-max')?.value || "1010000";
    const lmp = document.getElementById('lamp-filter')?.value || 'all';

    const requestParams = {
        mode: "get_stats",
        minConst: minC,
        maxConst: maxC,
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

            const modal = document.getElementById('ranking-modal');

            // 統計モード用の表示切り替え
            const canvas = document.getElementById('ranking-canvas');
            const rangeSelector = document.querySelector('.range-selector');
            const resetBtn = document.querySelector('.reset-btn');

            if (canvas) canvas.style.display = 'none';
            if (rangeSelector) rangeSelector.style.display = 'none';
            if (resetBtn) {
                // 統計モードでも使いたいなら block、消したいなら none
                resetBtn.style.display = 'block';
            }

            // モードに応じたデータの抽出
            let finalData = (mode === 'song') ? result.data.songRanking : result.data.playerRanking;

            // ★ 楽曲別の時だけ、上位50件に絞る
            if (mode === 'song' && finalData.length > 100) {
                finalData = finalData.slice(0, 100);
            }

            const finalDenom = (mode === 'song') ? result.data.totalUsers : result.data.theoryCount;

            // 重要：テーブルヘッダーの書き換え
            const thead = modal.querySelector('table thead tr');
            if (thead) {
                thead.innerHTML = (mode === 'song')
                    ? `<th>順位</th><th>楽曲名</th><th style="text-align:right;">人数</th><th style="text-align:center;">達成率</th>`
                    : `<th>順位</th><th>プレイヤー</th><th style="text-align:right;">楽曲数</th><th style="text-align:center;">達成率</th>`;
            }

            // タイトルの設定
            const titleContainer = document.getElementById('ranking-title-container');
            const typeLabel = typeFilter === 'new' ? '新曲' : typeFilter === 'old' ? '旧曲' : '全曲';
            const modeName = (mode === 'song') ? "楽曲別 達成人数" : "個人別 達成楽曲数";
            const unit = (mode === 'song') ? "人" : "曲";

            // 絞り込み条件を文字列にまとめる
            // 定数範囲 + スコア(ランク)範囲を表示
            const constRange = `${minC}～${maxC}`;
            const scoreRange = rMin === "0" && rMax === "1010000" ? "全ランク" : `${rMin}～${rMax}`;
            const lampLabel = lmp === 'all' ? '' : ` [${lmp.toUpperCase()}]`;


            const limitText = (mode === 'song') ? " (上位100件)" : "";
            if (titleContainer) {
                titleContainer.innerHTML = `
                    <span class="main-title-text">${typeLabel} ${modeName}${limitText}</span>
                    <span class="theory-info">(対象: ${finalDenom}${unit})</span>
                    <span class="title-sub-info">定数:${constRange} / スコア:${scoreRange}/ ランプ:${lampLabel}</span>
                `;
            }

            // ★ここで描画関数を呼ぶ（引数は3つ！）
            console.log("displayStatsRankingを呼び出します...");
            displayStatsRanking(finalData, finalDenom, mode);

            // モーダル表示
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
 * 統計用：描画関数
 */
function displayStatsRanking(statsData, denominator, mode) {
    console.log("--- displayStatsRanking Internal Start ---");
    const tbody = document.getElementById('ranking-body');
    if (!tbody) return;

    tbody.innerHTML = "";

    if (!statsData || statsData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">該当データなし</td></tr>';
        return;
    }

    statsData.forEach((row, index) => {
        // ここで mode に応じて安全に名前を取得
        const displayName = (mode === 'song') ? (row.title || "不明") : (row.playerName || "不明");
        const unit = (mode === 'song') ? "人" : "曲";

        let rateStr = "-";
        if (denominator > 0) {
            rateStr = ((row.count / denominator) * 100).toFixed(1) + "%";
        }

        const tr = document.createElement('tr');
        tr.style.cursor = "pointer";

        // ★クリックイベントの変更
        if (mode === 'song') {
            tr.title = "タップして達成者を表示";

            // 楽曲別モード：プレイヤーリストを表示
            tr.onclick = function () {
            const subModal = document.getElementById('sub-modal');
            const subTbody = document.getElementById('sub-modal-tbody');
            const subTitle = document.getElementById('sub-modal-title');

            subTitle.innerText = row.title; // 曲名を表示
            subTbody.innerHTML = ""; // リセット

            // ★スコアの高い順（降順）に並び替え
            const sortedPlayers = row.players.sort((a, b) => b.score - a.score);

            sortedPlayers.forEach(p => {
                const ptr = document.createElement('tr');
                ptr.innerHTML = `
                    <td>${p.name}</td>
                    <td style="text-align:center; font-weight:bold;">${p.score.toLocaleString()}</td>
                `;
                subTbody.appendChild(ptr);
            });

            subModal.style.display = "flex";
        };
            

        } else {
            tr.title = "タップして非表示";
            // 個人別モード：今まで通り非表示にする（あるいは何もしない）
            tr.onclick = function () {
                this.style.display = "none";
            };
            
        }

        tr.innerHTML = `
            <td class="rank-cell" style="text-align:center;">${index + 1}</td>
            <td style="text-align:left;">${displayName}</td>
            <td style="text-align:right; font-weight:bold;">${row.count} ${unit}</td>
            <td style="text-align:center; color: #f02e2e;">${rateStr}</td>
        `;
        tbody.appendChild(tr);
    });

    console.log("Table Drawing Completed");
    // もしここまで来たら、絶対に表は見えているはずです
}

// 子モーダルを閉じる関数
function closeSubModal() {
    document.getElementById('sub-modal').style.display = "none";
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