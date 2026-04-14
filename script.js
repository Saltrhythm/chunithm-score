let allRecords = [];

function renderTable(records) {
  const tbody = document.getElementById("score-table");
  tbody.innerHTML = "";
  records.forEach((item, index) => {
    if (!item || !item.title) return;
    const diffClass = `diff-${item.diff}`;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${item.title}</td>
      <td class="${diffClass}">${item.diff}</td>
      <td>${item.score.toLocaleString()}</td>
      <td>${item.rating}</td>
    `;
    tbody.appendChild(tr);
  });
}

function applyFilters() {
  const selectedDiff = document.getElementById("diff-filter").value;
  const searchText = document.getElementById("search-input").value.toLowerCase();
  const constMin = parseFloat(document.getElementById("const-min").value);
  const constMax = parseFloat(document.getElementById("const-max").value);

  const filtered = allRecords.filter(item => {
    const matchDiff = selectedDiff === "" || item.diff === selectedDiff;
    const matchTitle = item.title.toLowerCase().includes(searchText);
    const matchMin = isNaN(constMin) || item.const >= constMin;
    const matchMax = isNaN(constMax) || item.const <= constMax;
    return matchDiff && matchTitle && matchMin && matchMax;
  });

  renderTable(filtered);
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("diff-filter").addEventListener("change", applyFilters);
  document.getElementById("search-input").addEventListener("input", applyFilters);
  document.getElementById("const-min").addEventListener("input", applyFilters); 
  document.getElementById("const-max").addEventListener("input", applyFilters); 
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
