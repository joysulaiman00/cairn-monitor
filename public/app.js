// Elements for the dynamic dashboard.
const cardsGrid   = document.getElementById("cards-grid");
const resultsBody = document.getElementById("results-body");

// Summary statistics in the top bar.
const statTotal   = document.getElementById("stat-total");
const statUp      = document.getElementById("stat-up");
const statDown    = document.getElementById("stat-down");
const statAvg     = document.getElementById("stat-avg");
const statUpdated = document.getElementById("stat-updated");
const footerClock = document.getElementById("footer-clock");

// History modal UI.
const historyBtn        = document.getElementById("history-btn");
const historyModal      = document.getElementById("history-modal");
const historyClose      = document.getElementById("history-modal-close");
const historySiteSelect = document.getElementById("history-site-select");
const historyRangeSelect= document.getElementById("history-range-select");
const historyRefreshBtn = document.getElementById("history-refresh-btn");
const historyEmptyState = document.getElementById("history-empty-state");
const historyAvailability = document.getElementById("history-availability");
const historyAvgResponse  = document.getElementById("history-avg-response");
const historyCheckCount   = document.getElementById("history-check-count");
const historyEarliest     = document.getElementById("history-earliest");
const historyLatest       = document.getElementById("history-latest");
const historyRanges       = document.getElementById("history-ranges");
const historyChartCanvas  = document.getElementById("history-chart");
let historyChart;

const historyState = {
  sitesLoaded: false,
  activeSiteId: null,
  activeRange: 24,
};

// ─── Clock ────────────────────────────────────────────────────────────────────

function updateClock() {
  footerClock.textContent = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}
setInterval(updateClock, 1000);
updateClock();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(result) {
  return {
    statusClass: result.ok ? "up" : "down",
    statusText:  result.ok ? "ONLINE" : "OFFLINE",
    response:    result.responseTime != null ? `${result.responseTime}ms` : "—",
    checked:     result.checkedAt
      ? new Date(result.checkedAt).toLocaleTimeString("en-US", {
          hour: "2-digit", minute: "2-digit", second: "2-digit",
        })
      : "—",
    code: result.status ?? (result.error === "timeout" ? "Timeout" : "Error"),
  };
}

// ─── Summary bar ─────────────────────────────────────────────────────────────

function updateSummary(results) {
  const all   = Object.values(results);
  const up    = all.filter(r => r.ok);
  const down  = all.filter(r => !r.ok);
  const times = all.filter(r => r.responseTime != null).map(r => r.responseTime);
  const avg   = times.length ? Math.round(times.reduce((a,b) => a+b, 0) / times.length) : null;

  statTotal.textContent   = all.length;
  statUp.textContent      = up.length;
  statDown.textContent    = down.length;
  statAvg.textContent     = avg != null ? `${avg}ms` : "—";
  statUpdated.textContent = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function openHistoryModal() {
  historyModal.dataset.open = "true";
  historyModal.setAttribute("aria-hidden", "false");
  if (!historyState.sitesLoaded) loadHistorySites();
  if (!historyState.activeSiteId) {
    historyState.activeRange = Number(historyRangeSelect.value);
  }
}

function closeHistoryModal() {
  historyModal.dataset.open = "false";
  historyModal.setAttribute("aria-hidden", "true");
}

async function loadHistorySites() {
  try {
    const res = await fetch("/api/sites");
    if (!res.ok) throw new Error("Failed to load sites");
    const sites = await res.json();
    historySiteSelect.innerHTML = sites.map(site => `
      <option value="${site.id}">${site.name}</option>
    `).join("");
    historyState.sitesLoaded = true;
    historyState.activeSiteId = sites[0]?.id || null;
    if (historyState.activeSiteId) {
      historySiteSelect.value = historyState.activeSiteId;
      await loadHistoryMeta(historyState.activeSiteId);
      await loadHistoryData();
    }
  } catch (err) {
    historyEmptyState.textContent = "Could not load site list. Try again later.";
  }
}

async function loadHistoryMeta(siteId) {
  if (!siteId) return;
  try {
    const res = await fetch(`/api/sites/${encodeURIComponent(siteId)}/history/meta`);
    if (!res.ok) throw new Error("Failed to load history metadata");
    const meta = await res.json();
    historyEarliest.textContent = meta.earliest ? new Date(meta.earliest).toLocaleString() : "—";
    historyLatest.textContent = meta.latest ? new Date(meta.latest).toLocaleString() : "—";
    historyRanges.textContent = Array.isArray(meta.ranges) ? meta.ranges.map(r => `${r}h`).join(", ") : "—";
    historyRangeSelect.innerHTML = (meta.ranges || [1, 6, 24]).map(value => `
      <option value="${value}" ${value === 24 ? "selected" : ""}>Last ${value} hour${value === 1 ? "" : "s"}</option>
    `).join("");
    historyState.activeRange = Number(historyRangeSelect.value);
  } catch (err) {
    historyEarliest.textContent = "—";
    historyLatest.textContent = "—";
    historyRanges.textContent = "—";
  }
}

function buildHistorySummary(points) {
  if (!points.length) {
    historyAvailability.textContent = "—";
    historyAvgResponse.textContent = "—";
    historyCheckCount.textContent = "0";
    return;
  }

  const total = points.length;
  const upCount = points.filter(point => point.ok).length;
  const avgTime = points.filter(point => point.responseTime != null).reduce((sum, point) => sum + point.responseTime, 0) / points.filter(point => point.responseTime != null).length;

  historyAvailability.textContent = `${Math.round((upCount / total) * 100)}%`;
  historyAvgResponse.textContent = Number.isFinite(avgTime) ? `${Math.round(avgTime)}ms` : "—";
  historyCheckCount.textContent = `${total}`;
}

function renderHistoryChart(points) {
  const labels = points.map(point => new Date(point.checkedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }));
  const responseData = points.map(point => point.responseTime ?? null);
  const statusData = points.map((point, index) => point.ok ? null : { x: labels[index], y: 0 });

  if (!historyChart) {
    historyChart = new Chart(historyChartCanvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Response Time",
            data: responseData,
            borderColor: "#7a1f2e",
            backgroundColor: "rgba(122,31,46,0.15)",
            spanGaps: true,
            tension: 0.2,
            pointRadius: 3,
            pointBackgroundColor: "#7a1f2e",
          },
          {
            label: "Down",
            data: statusData.filter(Boolean),
            type: "scatter",
            backgroundColor: "rgba(239,68,68,0.85)",
            borderColor: "rgba(239,68,68,0.95)",
            pointRadius: 6,
            showLine: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: "nearest",
          intersect: false,
        },
        plugins: {
          tooltip: {
            callbacks: {
              label(context) {
                const idx = context.dataIndex;
                const point = points[idx];
                if (!point) return "No data";
                return ` ${point.ok ? "Online" : "Offline"} — ${point.responseTime != null ? `${point.responseTime}ms` : point.error || point.status}`;
              },
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: "Time" },
            ticks: { color: "#1a1a1a" },
            grid: { color: "rgba(0,0,0,0.08)" },
          },
          y: {
            title: { display: true, text: "Response Time (ms)" },
            ticks: { color: "#1a1a1a" },
            grid: { color: "rgba(0,0,0,0.08)" },
          },
        },
      },
    });
  } else {
    historyChart.data.labels = labels;
    historyChart.data.datasets[0].data = responseData;
    historyChart.data.datasets[1].data = statusData.filter(Boolean);
    historyChart.update();
  }
}

async function loadHistoryData() {
  const siteId = historySiteSelect.value;
  const hours = Number(historyRangeSelect.value);
  if (!siteId) return;

  historyEmptyState.textContent = "Loading history…";
  historyEmptyState.style.display = "flex";

  try {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const res = await fetch(`/api/sites/${encodeURIComponent(siteId)}/history?since=${encodeURIComponent(since)}`);
    if (!res.ok) {
      if (res.status === 404) {
        historyEmptyState.textContent = "History data is not available yet.";
      } else {
        historyEmptyState.textContent = "Failed to load history. Try again.";
      }
      return;
    }
    const data = await res.json();
    const points = data.points || [];
    if (!points.length) {
      historyEmptyState.textContent = "No history available for this site and time range.";
      return;
    }
    historyEmptyState.style.display = "none";
    buildHistorySummary(points);
    renderHistoryChart(points);
  } catch (err) {
    historyEmptyState.textContent = "Unable to load history. Check your connection.";
  }
}

function attachHistoryEvents() {
  historyBtn.addEventListener("click", openHistoryModal);
  historyClose.addEventListener("click", closeHistoryModal);
  historyRefreshBtn.addEventListener("click", loadHistoryData);
  historySiteSelect.addEventListener("change", async () => {
    await loadHistoryMeta(historySiteSelect.value);
    await loadHistoryData();
  });
  historyRangeSelect.addEventListener("change", loadHistoryData);
  historyModal.addEventListener("click", (event) => {
    if (event.target.dataset.close === "true") closeHistoryModal();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && historyModal.dataset.open === "true") {
      closeHistoryModal();
    }
  });
}

attachHistoryEvents();

// ─── Cards ────────────────────────────────────────────────────────────────────

function buildCard(result) {
  const f = fmt(result);
  const card = document.createElement("div");
  card.className = `site-card ${f.statusClass}`;
  card.id = `card-${result.siteId}`;
  card.innerHTML = `
    <div class="card-top">
      <div>
        <a class="card-name" href="${result.url}" target="_blank">${result.name}</a>
        <div class="card-category">${result.category}</div>
      </div>
      <span class="status-badge ${f.statusClass}">${f.statusText}</span>
    </div>
    <div class="card-stats">
      <div class="stat">
        <span class="stat-value">${f.response}</span>
        <span class="stat-label">Response</span>
      </div>
      <div class="stat">
        <span class="stat-value">${f.code}</span>
        <span class="stat-label">HTTP Code</span>
      </div>
    </div>
    <div class="card-url">${result.url}</div>
    <div class="card-time">Last checked: ${f.checked}</div>
  `;
  return card;
}

function updateCard(result) {
  const existing = document.getElementById(`card-${result.siteId}`);
  const newCard  = buildCard(result);
  if (existing) {
    existing.replaceWith(newCard);
  } else {
    cardsGrid.appendChild(newCard);
  }
  newCard.classList.add("flash");
}

// ─── Table ────────────────────────────────────────────────────────────────────

function buildRow(result) {
  const f   = fmt(result);
  const row = document.createElement("tr");
  row.id = `row-${result.siteId}`;
  row.innerHTML = `
    <td>
      <div class="td-site-name">${result.name}</div>
      <div class="td-url">${result.url}</div>
    </td>
    <td><span class="td-category">${result.category}</span></td>
    <td><span class="pill ${f.statusClass}">${f.statusText}</span></td>
    <td>${f.code}</td>
    <td class="td-response">${f.response}</td>
    <td>${f.checked}</td>
  `;
  return row;
}

function updateRow(result) {
  const existing = document.getElementById(`row-${result.siteId}`);
  const newRow   = buildRow(result);
  if (existing) {
    existing.replaceWith(newRow);
  } else {
    resultsBody.appendChild(newRow);
  }
}

// ─── WebSocket ────────────────────────────────────────────────────────────────

// Stores the current site results in memory for rendering and summary updates.
let results = {};

// Connect to the server's WebSocket endpoint and update the UI with live events.
function connect() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${location.host}`);

  ws.addEventListener("open", () => {
    console.log("WebSocket connected");
  });

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === "init") {
      // Initial payload includes the current state for all monitored sites.
      results = msg.sites;
      cardsGrid.innerHTML   = "";
      resultsBody.innerHTML = "";
      for (const result of Object.values(results)) {
        cardsGrid.appendChild(buildCard(result));
        resultsBody.appendChild(buildRow(result));
      }
      updateSummary(results);
    }

    if (msg.type === "update") {
      // Incremental update for a single site.
      results[msg.result.siteId] = msg.result;
      updateCard(msg.result);
      updateRow(msg.result);
      updateSummary(results);
    }

    if (msg.type === "delete") {
      delete results[msg.siteId];
      const oldCard = document.getElementById(`card-${msg.siteId}`);
      if (oldCard) oldCard.remove();
      const oldRow = document.getElementById(`row-${msg.siteId}`);
      if (oldRow) oldRow.remove();
      updateSummary(results);
    }
  });

  ws.addEventListener("close", () => {
    console.log("WebSocket disconnected — reconnecting in 3s…");
    setTimeout(connect, 3000);
  });

  ws.addEventListener("error", () => ws.close());
}

cardsGrid.innerHTML = `<div class="connecting">Connecting to monitor…</div>`;
connect();
