// History page script — mirrors the modal logic but for a standalone page.
document.addEventListener("DOMContentLoaded", () => {
  // Ensure the history common helper is loaded
  if (!window.historyCommon) {
    console.error('historyCommon helper not loaded!');
    document.getElementById("history-empty-state").textContent = 'Error: helper script failed to load.';
    return;
  }
  
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
    // Generate labels (time strings) and simple numeric indices for x-axis
    const labels = points.map(p => new Date(p.checkedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
    const responseData = points.map(p => p.responseTime ?? null);
    const downData = points.map((p, i) => p.ok ? null : { x: i, y: 0 });

    const yMax = window.historyCommon.suggestYAxisMax(points);

    try {
      if (!chart) {
        chart = new Chart(canvas, {
          type: 'line',
          data: {
            labels,
            datasets: [
              {
                label: 'Response Time',
                data: responseData,
                borderColor: '#7a1f2e',
                backgroundColor: 'rgba(122,31,46,0.12)',
                spanGaps: true,
                tension: 0.2,
                pointRadius: 0,
                pointHoverRadius: 6,
                fill: false,
              },
              {
                label: 'Down',
                data: downData.filter(Boolean),
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
                    if (context.dataset.label === 'Down') return 'Offline';
                    const v = context.parsed?.y;
                    return v != null ? `${v}ms` : 'No data';
                  }
                }
              }
            },
            scales: {
              x: {
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
        chart.data.labels = labels;
        chart.data.datasets[0].data = responseData;
        chart.data.datasets[1].data = downData.filter(Boolean);
        chart.options.scales.y.suggestedMax = yMax;
        chart.update();
      }
    } catch (err) {
      console.error('Chart render failed:', err);
      emptyState.textContent = 'Chart rendering failed. Check browser console.';
      emptyState.style.display = 'flex';
    }
  }

  async function loadData() {
    const siteId = siteSelect.value;
    const hours = Number(rangeSelect.value);
    const buckets = Number(bucketsSelect.value);
    emptyState.textContent = 'Loading...'; 
    emptyState.style.display = 'flex';
    try {
      const since = new Date(Date.now() - hours*60*60*1000).toISOString();
      const q = new URLSearchParams({ since });
      // Interpret bucketsSelect value: 0 => raw, '240' means Auto (use helper)
      let useBuckets = buckets;
      if (buckets === 240) {
        useBuckets = window.historyCommon.getBucketCountForRange(hours);
      }
      if (useBuckets > 0) q.set('buckets', String(useBuckets));
      const url = `/api/sites/${encodeURIComponent(siteId)}/history?${q.toString()}`;
      console.log('Fetching history:', url);
      const res = await fetch(url);
      if (!res.ok) { 
        console.error('History fetch failed:', res.status, res.statusText);
        emptyState.textContent = `Failed: ${res.status} ${res.statusText}`; 
        return; 
      }
      const data = await res.json();
      console.log('Received', data.points?.length || 0, 'history points');
      const points = data.points || [];
      if (!points.length) { 
        emptyState.textContent = 'No history for this range.'; 
        return; 
      }
      emptyState.style.display = 'none';
      buildSummary(points);
      render(points);
    } catch (err) {
      console.error('loadData error:', err);
      emptyState.textContent = `Error: ${err.message}`; 
    }
  }

  refreshBtn.addEventListener('click', loadData);
  siteSelect.addEventListener('change', async () => { await loadMeta(siteSelect.value); await loadData(); });
  rangeSelect.addEventListener('change', loadData);
  bucketsSelect.addEventListener('change', loadData);

  loadSites();
});
