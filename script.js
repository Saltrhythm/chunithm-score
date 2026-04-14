let allRecords = [];

function renderTable(records) {
  const tbody = document.getElementById("score-table");
  tbody.innerHTML = "";
  
  records.forEach((item, index) => {
    if (!item || !item.title) return;

    let Markup = "";

    if (item.is_alljustice && item.score === 1010000) {
      Markup = '<span class="ajc-badge">AJC</span>'; 
    } else if (item.is_alljustice) {
      Markup = '<span class="aj-badge">AJ</span>';
    } else if (item.is_fullcombo) {
      Markup = '<span class="fc-badge">FC</span>';
}

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${item.title}</td>
      <td class="diff-${item.diff}">${item.diff}</td>
      <td>
        ${item.score.toLocaleString()}
        ${Markup} 
      </td>
      <td>${item.rating}</td>
    `;
    tbody.appendChild(tr);
  });
  applyColumnVisibility();
}

function applyFilters() {
  const selectedDiff = document.getElementById("diff-filter").value;
  const searchText = document.getElementById("search-input").value.toLowerCase();
  const constMin = parseFloat(document.getElementById("const-min").value);
  const constMax = parseFloat(document.getElementById("const-max").value);
  const scoreMin = parseInt(document.getElementById('score-min').value); 
  const scoreMax = parseInt(document.getElementById('score-max').value);
  const ratingMin = parseFloat(document.getElementById("rating-min").value);
  const ratingMax = parseFloat(document.getElementById("rating-max").value);
  const lampFilter = document.getElementById("lamp-filter").value;

  const filtered = allRecords.filter(item => {
    const matchDiff = selectedDiff === "" || item.diff === selectedDiff;
    const matchTitle = item.title.toLowerCase().includes(searchText);
    const matchConstMin = isNaN(constMin) || item.const >= constMin;
    const matchConstMax = isNaN(constMax) || item.const <= constMax;
    const matchScoreMin = isNaN(scoreMin) || item.score >= scoreMin;
    const matchScoreMax = isNaN(scoreMax) || item.score <= scoreMax;
    const matchRatingMin = isNaN(ratingMin) || item.rating >= ratingMin;
    const matchRatingMax = isNaN(ratingMax) || item.rating <= ratingMax;

let matchLamp = true;
  if (lampFilter === "AJC") {
    matchLamp = item.is_alljustice && item.score === 1010000;
  } else if (lampFilter === "AJ") {
    matchLamp = item.is_alljustice;
  } else if (lampFilter === "NO_AJ") {
    matchLamp = !item.is_alljustice;
  }

  return matchDiff && matchTitle && matchConstMin && matchConstMax && 
         matchScoreMin && matchScoreMax && matchRatingMin && matchRatingMax && 
         matchLamp;
});

  renderTable(filtered);
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("diff-filter").addEventListener("change", applyFilters);
  document.getElementById("search-input").addEventListener("input", applyFilters);
  document.getElementById("const-min").addEventListener("input", applyFilters); 
  document.getElementById("const-max").addEventListener("input", applyFilters); 
  document.getElementById("score-min").addEventListener("input", applyFilters); 
  document.getElementById("score-max").addEventListener("input", applyFilters);
  document.getElementById("rating-min").addEventListener("input", applyFilters); 
  document.getElementById("rating-max").addEventListener("input", applyFilters);
  document.getElementById("lamp-filter").addEventListener("change", applyFilters);
});

function loadScores() {
  const token = document.getElementById("token-input").value.trim();
  if (!token) return;

  const API_URL = `https://api.chunirec.net/2.0/records/showall.json?region=jp2&token=${token}`;

  fetch(API_URL)
    .then(res => res.json())
    .then(data => {
      if (!data.records) throw new Error("invalid token");
      const records = data.records;
      records.sort((a, b) => b.score - a.score);
      allRecords = records;

      document.getElementById("token-screen").style.display = "none";
      document.getElementById("main-screen").style.display = "block";

      renderTable(allRecords);
    })
    .catch(() => {
      document.getElementById("token-error").style.display = "block";
    });
}

// 1. 現在どの列が隠されているかを記録する変数
let hiddenColumns = new Set();

// 2. 指定した列を隠す関数
function hideColumn(index) {
  hiddenColumns.add(index);    // 隠しリストに番号を追加
  applyColumnVisibility();     // 見た目に反映
  updateRestoreButtons();      // 復活ボタンを表示
}

// 3. 指定した列を再表示する関数
function showColumn(index) {
  hiddenColumns.delete(index); // 隠しリストから削除
  applyColumnVisibility();     // 見た目に反映
  updateRestoreButtons();      // 復活ボタンを更新
}

// 4. 実際に表の display 状態を切り替える処理
function applyColumnVisibility() {
  const table = document.querySelector('table');
  if (!table) return;
  const rows = table.querySelectorAll('tr');
  
  // 0列目(#)から4列目(Rating)までループ
  for (let i = 0; i < 5; i++) {
    const isHidden = hiddenColumns.has(i);
    const displayValue = isHidden ? 'none' : '';
    
    rows.forEach(row => {
      if (row.cells[i]) {
        row.cells[i].style.display = displayValue;
      }
    });
  }
}

// 5. 消した列を復活させるためのボタンを画面に作る
function updateRestoreButtons() {
  const container = document.getElementById("restore-buttons");
  if (!container) return;
  container.innerHTML = "";
  
  if (hiddenColumns.size > 0) {
    const label = document.createElement("span");
    label.innerText = "表示に戻す：";
    label.style.fontSize = "14px";
    container.appendChild(label);

    hiddenColumns.forEach(index => {
      const names = ["#", "曲名", "難易度", "スコア", "Rating"];
      const btn = document.createElement("button");
      btn.innerText = names[index];
      btn.style.margin = "0 5px 5px 0";
      btn.style.cursor = "pointer";
      btn.onclick = () => showColumn(index);
      container.appendChild(btn);
    });
  }
}
