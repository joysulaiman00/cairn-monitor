// Shared helpers for history page
(function (global) {
  const historyCommon = {};

  // Choose sensible default bucket counts based on time window size
  historyCommon.getBucketCountForRange = function (hours) {
    if (!Number.isFinite(hours) || hours <= 1) return 240; // 1h -> ~4m per bucket
    if (hours <= 6) return 360; // 6h -> ~1m per bucket
    if (hours <= 24) return 480; // 24h -> ~3m per bucket
    return 720; // larger ranges
  };

  // Build summary metrics from point array
  historyCommon.buildSummary = function (points) {
    if (!Array.isArray(points) || points.length === 0) return { availability: '—', avgResponse: '—', count: 0 };
    const total = points.length;
    const up = points.filter(p => p.ok).length;
    const times = points.filter(p => p.responseTime != null).map(p => p.responseTime);
    const avg = times.length ? Math.round(times.reduce((a,b)=>a+b,0)/times.length) : '—';
    return { availability: `${Math.round((up/total)*100)}%`, avgResponse: avg === '—' ? '—' : `${avg}ms`, count: total };
  };

  // Suggested y-axis max based on data (adds padding)
  historyCommon.suggestYAxisMax = function (points) {
    const vals = points.filter(p => p.responseTime != null).map(p => p.responseTime);
    if (!vals.length) return 1000;
    const max = Math.max(...vals);
    // Round to a clean value
    const padded = Math.ceil(max * 1.2);
    // Round to nearest 50/100 for nicer ticks
    if (padded <= 200) return Math.ceil(padded / 25) * 25;
    if (padded <= 1000) return Math.ceil(padded / 50) * 50;
    return Math.ceil(padded / 100) * 100;
  };

  global.historyCommon = historyCommon;
})(window);
