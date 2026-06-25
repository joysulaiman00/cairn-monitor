// History page script — mirrors the modal logic but for a standalone page.
document.addEventListener("DOMContentLoaded", () => {
  const siteSelect = document.getElementById("history-site-select");
  const rangeSelect = document.getElementById("history-range-select");
  const bucketsSelect = document.getElementById("history-buckets");
  const refreshBtn = document.getElementById("history-refresh-btn");
  const emptyState = document.getElementById("history-empty-state");
  const availabilityEl = document.getElementById("history-availability");
  const avgEl = document.getElementById("history-avg-response");
  const countEl = document.getElementById("history-check-count");
  const earliestEl = document.getElementById("history-earliest");
  const latestEl = document.getElementById("history-latest");
  const rangesEl = document.getElementById("history-ranges");
  const canvas = document.getElementById("history-chart");
  let chart;

  async function loadSites() {
    const res = await fetch('/api/sites');
    if (!res.ok) return;
    const sites = await res.json();
    siteSelect.innerHTML = sites.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    if (sites[0]) {
      siteSelect.value = sites[0].id;
      await loadMeta(sites[0].id);
      await loadData();
    }
  }

  async function loadMeta(siteId) {
    try {
      const res = await fetch(`/api/sites/${encodeURIComponent(siteId)}/history/meta`);
      if (!res.ok) throw new Error('meta');
      const meta = await res.json();
      earliestEl.textContent = meta.earliest ? new Date(meta.earliest).toLocaleString() : '—';
      latestEl.textContent = meta.latest ? new Date(meta.latest).toLocaleString() : '—';
      rangesEl.textContent = Array.isArray(meta.ranges) ? meta.ranges.map(r=>r+'h').join(', ') : '—';
    } catch (e) {
      earliestEl.textContent = latestEl.textContent = rangesEl.textContent = '—';
    }
  }

  function buildSummary(points) {
    const s = window.historyCommon.buildSummary(points);
    availabilityEl.textContent = s.availability;
    avgEl.textContent = s.avgResponse;
    countEl.textContent = `${s.count}`;
  }

  function render(points) {
    // Data as time-series objects for Chart.js time scale
    const responsePoints = points.map(p => ({ x: p.checkedAt, y: p.responseTime != null ? p.responseTime : null }));
    const downPoints = points.filter(p => !p.ok).map(p => ({ x: p.checkedAt, y: 0 }));

    const yMax = window.historyCommon.suggestYAxisMax(points);

    if (!chart) {
      chart = new Chart(canvas, {
        type: 'line',
        data: {
          datasets: [
            {
              label: 'Response Time',
              data: responsePoints,
              borderColor: '#7a1f2e',
              backgroundColor: 'rgba(122,31,46,0.12)',
              spanGaps: true,
              tension: 0.2,
              pointRadius: 0,
              pointHoverRadius: 6,
            },
            {
              label: 'Down',
              data: downPoints,
              type: 'scatter',
              backgroundColor: 'rgba(239,68,68,0.85)',
              borderColor: 'rgba(239,68,68,0.95)',
              pointRadius: 6,
              showLine: false,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'nearest', intersect: false },
          plugins: {
            tooltip: {
              callbacks: {
                label(context) {
                  const p = context.raw;
                  if (!p) return 'No data';
                  if (p.y == null) return 'No response';
                  return `${p.y}ms`;
                }
              }
            }
          },
          scales: {
            x: {
              type: 'time',
              time: { tooltipFormat: 'MMM d, HH:mm', displayFormats: { hour: 'HH:mm', minute: 'HH:mm' } },
              title: { display: true, text: 'Time' },
              grid: { color: 'rgba(0,0,0,0.06)' },
            },
            y: {
              title: { display: true, text: 'Response Time (ms)' },
              suggestedMax: yMax,
              beginAtZero: true,
              grid: { color: 'rgba(0,0,0,0.06)' },
            }
          }
        }
      });
    } else {
      chart.data.datasets[0].data = responsePoints;
      chart.data.datasets[1].data = downPoints;
      chart.options.scales.y.suggestedMax = yMax;
      chart.update();
    }
  }

  async function loadData() {
    const siteId = siteSelect.value;
    const hours = Number(rangeSelect.value);
    const buckets = Number(bucketsSelect.value);
    emptyState.textContent = 'Loading...'; emptyState.style.display = 'flex';
      try {
        const since = new Date(Date.now() - hours*60*60*1000).toISOString();
        const q = new URLSearchParams({ since });
        // Interpret bucketsSelect value: 0 => raw, '240' means Auto (use helper)
        let useBuckets = buckets;
        if (buckets === 240) {
          useBuckets = window.historyCommon.getBucketCountForRange(hours);
        }
        if (useBuckets > 0) q.set('buckets', String(useBuckets));
        const res = await fetch(`/api/sites/${encodeURIComponent(siteId)}/history?${q.toString()}`);
      if (!res.ok) { emptyState.textContent = 'No history'; return; }
      const data = await res.json();
      const points = data.points || [];
      if (!points.length) { emptyState.textContent = 'No history for this range.'; return; }
      emptyState.style.display = 'none';
      buildSummary(points);
      render(points);
    } catch (e) {
      emptyState.textContent = 'Failed to load data.';
    }
  }

  refreshBtn.addEventListener('click', loadData);
  siteSelect.addEventListener('change', async () => { await loadMeta(siteSelect.value); await loadData(); });
  rangeSelect.addEventListener('change', loadData);
  bucketsSelect.addEventListener('change', loadData);

  loadSites();
});
