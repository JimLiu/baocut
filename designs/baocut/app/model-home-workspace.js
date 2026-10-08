/* Home workspace tabs, product-design §2.5 / §3.3 user revision. Pure state;
   a preview never changes the conversation's agent write target. */
(function () {
  const empty = () => ({tabs: [], active: null});
  // The narrow / full workspace's pinned first tab. It lives outside `tabs`.
  const CONVERSATION = '__conversation__';
  // Which workspace a route belongs to: a session id, or a draft before the first
  // message (`draft:` on Home, `draft:<dir>` for a new session inside a project).
  function keyFor(r) {
    return r && (r.r === 'home' || r.r === 'agent') ? r.id || 'draft:' + (r.dir || '') : null;
  }
  function fromRoute(r) {
    if (keyFor(r) === null) return null;
    if (r.movie) return {key: 'movie:' + r.movie, kind: 'movie', id: r.movie, ...(r.tab ? {tab: r.tab} : {}), ...(r.t != null ? {t: r.t} : {})};
    if (r.file) return {key: 'file:' + r.file, kind: 'file', id: r.file};
    if (r.web) return {key: 'web:' + r.web, kind: 'web', id: r.web, url: safeUrl(r.url) || ''};
    return null;
  }
  function safeUrl(input) {
    const text = String(input || '').trim();
    if (!text) return null;
    try {
      const local = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(text);
      const hostPort = /^[^\s/:?#]+\.[^\s/:?#]+:\d+(?:[/?#]|$)/.test(text);
      const u = new URL(local ? 'http://' + text : hostPort ? 'https://' + text : /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : 'https://' + text);
      return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null;
    } catch { return null; }
  }
  function open(state, item) {
    const s = state || empty();
    const old = s.tabs.find(t => t.key === item.key);
    return {tabs: old ? s.tabs.map(t => t.key === item.key ? {...t, ...item} : t) : [...s.tabs, item], active: item.key};
  }
  // Swap a tab for another in the same slot (a new tab's start page turning into the
  // page it created), the way a browser replaces a tab in place.
  function replace(state, key, item) {
    const s = state || empty();
    const i = s.tabs.findIndex(t => t.key === key);
    if (i < 0) return open(s, item);
    const tabs = s.tabs.filter(t => t.key !== item.key || t.key === key);
    const at = tabs.findIndex(t => t.key === key);
    tabs.splice(at, 1, item);
    return {tabs, active: item.key};
  }
  function close(state, key) {
    const i = state.tabs.findIndex(t => t.key === key);
    if (i < 0) return state;
    const tabs = state.tabs.filter(t => t.key !== key);
    return {tabs, active: state.active === key ? (tabs[Math.min(i, tabs.length - 1)]?.key || null) : state.active};
  }
  function move(state, key, targetKey, after = false) {
    if (key === targetKey || !state.tabs.some(t => t.key === key) || !state.tabs.some(t => t.key === targetKey)) return state;
    const item = state.tabs.find(t => t.key === key);
    const tabs = state.tabs.filter(t => t.key !== key);
    const index = tabs.findIndex(t => t.key === targetKey) + (after ? 1 : 0);
    tabs.splice(index, 0, item);
    return tabs.every((t, i) => t === state.tabs[i]) ? state : {...state, tabs};
  }
  function route(sid, item) {
    const draft = String(sid || '').startsWith('draft:');
    const dir = draft ? sid.slice(6) : null;
    const base = draft ? (dir ? {r: 'agent', dir} : {r: 'home'}) : {r: 'agent', id: sid};
    if (!item) return base;
    if (item.kind === 'movie') return {...base, movie: item.id, ...(item.tab ? {tab: item.tab} : {}), ...(item.t != null ? {t: item.t} : {})};
    if (item.kind === 'file') return {...base, file: item.id};
    return {...base, web: item.id, ...(item.url ? {url: item.url} : {})};
  }
  function reconcile(book, r) {
    const key = keyFor(r);
    if (key === null) return book;
    const s = book[key] || empty(), item = fromRoute(r);
    const next = item ? open(s, item) : {...s, active: null};
    return JSON.stringify(next) === JSON.stringify(s) ? book : {...book, [key]: next};
  }
  // The first message turns a draft into a session: its per-workspace records move over.
  function carry(book, from, to) {
    if (!String(from || '').startsWith('draft:') || !to || !book[from]) return book;
    const next = {...book, [to]: book[from]};
    delete next[from];
    return next;
  }
  // product-design §2.5 / §3.3 user revision: entering full view keeps what is on
  // screen. A visible pane stays selected; otherwise the conversation tab is.
  function fullViewEntry(paneVisible, active) { return paneVisible && active ? active : CONVERSATION; }
  // The title bar's tabs button for each workspace state. With no tab: a tab frame
  // (assets/shell/tabs.svg) with a plus overlay. With the split hidden: the frame with the
  // count (9+ above nine), and only then a list of the open tabs. With the split visible or
  // in full view: the hide-tabs icon, no count and no list.
  function tabsButton({count, visible, full}) {
    if (!count) return {overlay: 'tabs-plus', label: '打开新标签页', action: 'open'};
    if (full) return {icon: 'hide-tabs', label: '进入分屏视图', action: 'split'};
    if (visible) return {icon: 'hide-tabs', label: '隐藏标签页', action: 'hide'};
    return {count, badge: count > 9 ? '9+' : String(count), label: '显示标签页', action: 'show'};
  }
  function title(item, items) {
    if (item.kind === 'web') { try { return new URL(item.url).hostname; } catch { return '新标签页'; } }
    return items.find(it => it.id === item.id)?.name || (item.kind === 'movie' ? '视频不可用' : '文件不可用');
  }
  // Hit-test untransformed tab slots so animated neighbors cannot move the target.
  function dragTarget(rects, key, x) {
    const others = rects.filter(r => r.key !== key);
    if (!others.length) return null;
    const next = others.find(r => x < r.left + r.width / 2);
    return next ? {key: next.key, after: false} : {key: others.at(-1).key, after: true};
  }
  function dragOffsets(rects, key, target, gap = 4) {
    if (!target || !rects.length) return {};
    const reordered = move({tabs: rects}, key, target.key, target.after).tabs;
    let left = rects[0].left;
    return Object.fromEntries(reordered.map(r => { const offset = left - r.left; left += r.width + gap; return [r.key, offset]; }));
  }
  // product-design §2.5 / §3.3 user revision: below this container width the
  // conversation becomes the fixed first tab instead of a side column (conversation
  // min 320 + an editor of about 640). Measure the workspace container, not the window.
  const NARROW_WIDTH = 960;
  function isNarrow(width) { return Number.isFinite(width) && width > 0 && width < NARROW_WIDTH; }
  // Match the reference workspace: render at least 320px, but keep tracking the
  // raw pointer beyond that boundary; half the minimum (160px) hides the pane.
  const PANE_MIN_WIDTH = 320, PANE_HIDE_WIDTH = PANE_MIN_WIDTH / 2;
  function resizeSplit(conversationWidth, workspaceWidth) {
    const width = Math.max(320, Math.min(Math.round(conversationWidth), workspaceWidth - PANE_MIN_WIDTH));
    return {width, hidden: workspaceWidth - conversationWidth < PANE_HIDE_WIDTH};
  }
  // Which tab a wide → narrow switch selects: the conversation when it holds focus
  // or when no pane is showing; otherwise the visible pane stays.
  function narrowShowsConversation(focusInConversation, paneVisible) { return !!focusInConversation || !paneVisible; }
  window.BC_HOME_WORKSPACE = {CONVERSATION, keyFor, carry, fullViewEntry, tabsButton, empty, fromRoute, safeUrl, open, replace, close, move, route, reconcile, title, dragTarget, dragOffsets,
    NARROW_WIDTH, isNarrow, narrowShowsConversation, PANE_MIN_WIDTH, PANE_HIDE_WIDTH, resizeSplit};
})();
