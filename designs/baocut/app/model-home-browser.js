/* Address and navigation state for product-design §3.3's isolated web pane.
   Interaction reference: open-codex browser/browser-url.ts. */
(function () {
  const W = window.BC_HOME_WORKSPACE;
  function resolveAddress(input) {
    const text = String(input || '').trim();
    if (!text) return null;
    const host = /^(localhost|\[[\da-f:]+\]|[^\s/:?#]+\.[^\s/:?#]+)(?::\d+)?(?:[/?#]|$)/i.test(text);
    if (host || /^[a-z][a-z\d+.-]*:/i.test(text)) return W.safeUrl(text);
    return 'https://www.google.com/search?q=' + encodeURIComponent(text);
  }
  function displayUrl(url) {
    try { const u = new URL(url); return u.host + (u.pathname === '/' ? '' : u.pathname) + u.search + u.hash; }
    catch { return ''; }
  }
  const history = (url = '') => ({urls: [url], pos: 0});
  function visit(h, url) {
    if (h.urls[h.pos] === url) return h;
    const urls = [...h.urls.slice(0, h.pos + 1), url];
    return {urls, pos: urls.length - 1};
  }
  function step(h, delta) {
    const pos = Math.max(0, Math.min(h.urls.length - 1, h.pos + delta));
    return pos === h.pos ? h : {...h, pos};
  }
  const zoomSteps = [50, 67, 75, 90, 100, 110, 125, 150, 175, 200];
  function zoom(current, delta) { return zoomSteps[Math.max(0, Math.min(zoomSteps.length - 1, zoomSteps.indexOf(current) + delta))]; }
  const devices = {phone: {width: 390, height: 844}, tablet: {width: 820, height: 1180}, laptop: {width: 1440, height: 900}};
  const rotate = size => ({width: size.height, height: size.width});
  const clampSize = n => Math.min(4096, Math.max(240, Math.round(Number(n) || 240)));
  function matches(text, query) {
    if (!query) return [];
    const input = text.toLocaleLowerCase(), q = query.toLocaleLowerCase(), found = [];
    let at = input.indexOf(q);
    while (at >= 0) { found.push(at); at = input.indexOf(q, at + q.length); }
    return found;
  }
  const nextMatch = (index, delta, count) => count ? (index + delta + count) % count : 0;
  const demoPage = url => {
    try {
      const u = new URL(url);
      if (u.hostname !== 'guide.example') return null;
      return u.pathname === '/subtitles'
        ? {title: '字幕与交付', body: '字幕要清楚，也要读得完。\n\n将字幕导出为 SRT，保留独立的文稿。检查字幕的起止时间，避免挡住画面里的重要内容。\n\n交付时同时保留可编辑视频与成片。', next: '/video', nextLabel: '返回视频制作'}
        : {title: '视频制作指南', body: '从素材到成片，把一个故事讲清楚。\n\n先整理素材，再写分镜。每个镜头只表达一个重点，让画面与字幕互相补充。\n\n剪辑完成后，完整播放一遍视频。检查画幅、字幕、声音与最后一帧，再导出成片。', next: '/subtitles', nextLabel: '查看字幕与交付'};
    } catch { return null; }
  };
  // New tab start page「新建网页」: a demo HTML document in the session's project.
  // Names stay unique within the project: 新网页.html, 新网页 2.html, …
  const PAGE_TEXT = '<!doctype html>\n<html lang="zh-Hans">\n<head><meta charset="utf-8"><title>新网页</title>\n'
    + '<style>body { font-family: sans-serif; margin: 32px; line-height: 1.6; }</style></head>\n'
    + '<body>\n<h1>新网页</h1>\n<p>在这里编写网页内容，也可以让 Agent 帮你修改。</p>\n</body>\n</html>\n';
  function newPage(items, {id, dir = null, session = null, now = 0}) {
    const taken = new Set((items || []).filter(it => (it.dir || null) === dir).map(it => it.file || it.name));
    let n = 1, name = '新网页.html';
    while (taken.has(name)) name = `新网页 ${++n}.html`;
    return {id, kind: 'doc', name, file: name, dir, session, mtime: now, contentKind: 'text',
      bytes: new TextEncoder().encode(PAGE_TEXT).length, ver: 1, text: PAGE_TEXT};
  }
  window.BC_HOME_BROWSER = {resolveAddress, displayUrl, history, visit, step, zoom, devices, rotate, clampSize, matches, nextMatch, demoPage, newPage};
})();
