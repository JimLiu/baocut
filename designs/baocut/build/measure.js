(() => {
  if (!new URLSearchParams(location.search).has('perf')) return;
  let total = 0, count = 0;
  const longTasks = typeof PerformanceObserver === 'function' ? new PerformanceObserver(list => {
    for (const e of list.getEntries()) { total += e.duration; count++; }
  }) : null;
  try { longTasks?.observe({type: 'longtask', buffered: true}); } catch {}
  const observer = new MutationObserver(() => {
    if (!document.getElementById('root')?.firstElementChild) return;
    observer.disconnect();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.documentElement.dataset.bootMetrics = JSON.stringify({
        readyMs: Math.round(performance.now()), longTaskMs: Math.round(total), longTasks: count,
        scripts: document.scripts.length
      });
      longTasks?.disconnect();
    }));
  });
  observer.observe(document.documentElement, {childList: true, subtree: true});
})();
