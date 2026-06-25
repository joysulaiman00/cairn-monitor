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

const historyBtn = document.getElementById("history-btn");

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

function attachHistoryEvents() {
  if (!historyBtn) return;
  // `historyBtn` is a simple link to the full history page; no modal behavior.
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
