/* BaoCut 原型 — 路由栈
   window.BC_NAV。纯函数 + 一个 localStorage 键，无 React、无 DOM。

   路由记录形状按 docs/design/product/product-design.md §7 的路由状态键表：
     {r: 'home'|'agent'|'projects'|'tasks'|'task'|'tools'|'services'|'remote'|'settings'|'editor', id?, sec?, tab?, from?, via?, dir?, movie?}
     `projects` 的 from 是来源项目的 id：只看它切出的短视频（§15.12）
     `editor` 的 via 是从哪个 App Tab 打开的视频（'home' | 'space'，2026-10-01）：两处打开是同一套布局，
     只差 rail 上亮哪一格、「后退」回哪儿，所以它进 isSame——从 Home 与从 Space 打开同一部视频是两条历史
     `agent` 的 movie 是右侧正在查看的视频；id 始终是会话 id。
     `agent` 没有 id、带 dir = 在这个项目（目录）里起一条还没说话的新会话（App，2026-10-01）
     `tools` 的 id 是工具（'tts' / 'compress' / 'merge'），没有 id 是目录；`services` 的 id 是 'mcp' / 'remote' / 'web'；
     `remote` 与 {r:'tools', id:'remote'} 是旧链接，落到 {r:'services', id:'remote'}（BC_SERVICES.resolve）
     （`skill` 指向 `settings/skills`（2026-09-17 前叫 `integrations`），`sessions` 退役）
   URL 编解码与有界历史记录供 browser-nav.js 使用；浏览器 history 决定前进后退。
   localStorage 保留上次页面，同一浏览器会话刷新时保留前进后退位置。 */
(function () {
  const KEY = 'bc-nav-v1';
  const HOME = {r: 'home'};

  const isSame = (a, b) => !!a && !!b && a.r === b.r && (a.id || null) === (b.id || null)
    && (a.sec || null) === (b.sec || null) && (a.tab || null) === (b.tab || null)
    && (a.from || null) === (b.from || null) && (a.via || null) === (b.via || null)
    && (a.file || null) === (b.file || null) && (a.web || null) === (b.web || null) && (a.url || null) === (b.url || null)
    && (a.movie || null) === (b.movie || null) && (a.dir || null) === (b.dir || null) && (a.t ?? null) === (b.t ?? null);

  const fresh = () => ({stack: [HOME], pos: 0});

  function load(storage) {
    try {
      const raw = (storage || window.localStorage).getItem(KEY);
      const v = JSON.parse(raw);
      if (v && Array.isArray(v.stack) && v.stack.length &&
          Number.isInteger(v.pos) && v.pos >= 0 && v.pos < v.stack.length &&
          v.stack.every((r) => r && typeof r.r === 'string')) return v;
    } catch (e) { /* 存储不可用或内容坏了，回到初始态 */ }
    return fresh();
  }

  function save(nav, storage) {
    try { (storage || window.localStorage).setItem(KEY, JSON.stringify(nav)); } catch (e) {}
  }

  /** 压栈：丢掉 pos 之后的前进历史；与当前同一条则原地不动（避免连点堆栈） */
  function push(nav, route) {
    if (isSame(nav.stack[nav.pos], route)) return nav;
    const stack = nav.stack.slice(0, nav.pos + 1).concat([route]);
    // 栈太深会让「后退」变成考古；50 条足够一次会话
    const trimmed = stack.length > 50 ? stack.slice(stack.length - 50) : stack;
    return {stack: trimmed, pos: trimmed.length - 1};
  }

  /** 原地替换（改 Settings 的节、改编辑器的 Tab 这类不该进历史的动作） */
  function replace(nav, route) {
    if (isSame(nav.stack[nav.pos], route)) return nav;
    const stack = nav.stack.slice();
    stack[nav.pos] = route;
    return {stack, pos: nav.pos};
  }

  const canBack = (nav) => nav.pos > 0;
  const canFwd  = (nav) => nav.pos < nav.stack.length - 1;
  const back = (nav) => (canBack(nav) ? {stack: nav.stack, pos: nav.pos - 1} : nav);
  const fwd  = (nav) => (canFwd(nav)  ? {stack: nav.stack, pos: nav.pos + 1} : nav);
  const current = (nav) => nav.stack[nav.pos];

  // Hash URLs work on a plain static server, including direct links and refresh.
  const names = {projects: 'space', editor: 'movie', task: 'task'};
  const routes = new Set(['home', 'agent', 'projects', 'tasks', 'task', 'tools', 'services', 'models', 'settings', 'editor', 'none']);
  // product-design §7.6：模型配置归入设置；旧模型链接保留能力与子页。
  function canonicalRoute(route) {
    return route.r === 'models'
      ? {...route, r: 'settings', sec: route.sec || 'local'} : route;
  }
  function hrefFor(route) {
    let r = canonicalRoute(route || HOME);
    if (r.r === 'remote') r = {r:'services', id:'remote'};
    if (r.r === 'skill') r = {r:'settings', sec:'skills'};
    if (r.r === 'sessions') r = {r:'projects'};
    const name = names[r.r] || (routes.has(r.r) ? r.r : 'home');
    const q = new URLSearchParams();
    let url = '#/' + name;
    if (r.id && r.r !== 'projects') url += '/' + encodeURIComponent(r.id);
    if (r.r === 'projects' && r.id) q.set('dir', r.id);
    for (const key of ['sec', 'tab', 'from', 'via', 'dir', 'movie', 'file', 'web', 'url']) {
      if (r[key]) q.set(key === 'sec' && r.r === 'projects' ? 'cat' : key, r[key]);
    }
    if (Number.isFinite(r.t) && r.t >= 0) q.set('t', String(r.t));
    return url + (q.size ? '?' + q.toString() : '');
  }
  function routeFromHref(href) {
    try {
      const text = String(href || '').replace(/^#?\/?/, '');
      const at = text.indexOf('?');
      const path = at < 0 ? text : text.slice(0, at);
      const q = new URLSearchParams(at < 0 ? '' : text.slice(at + 1));
      const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
      if (parts.length > 2) return {...HOME};
      const head = parts[0] || 'home';
      if (head === 'remote' || head === 'tools' && parts[1] === 'remote') return {r:'services', id:'remote'};
      if (head === 'skill') return {r:'settings', sec:'skills'};
      if (head === 'sessions') return {r:'projects'};
      const name = head === 'space' ? 'projects' : head === 'movie' ? 'editor' : head;
      if (!routes.has(name)) return {...HOME};
      const r = {r:name};
      if (parts[1]) r.id = parts[1];
      for (const key of ['sec', 'tab', 'from', 'via', 'dir', 'movie', 'file', 'web', 'url']) if (q.get(key)) r[key] = q.get(key);
      if (name === 'projects') {
        if (q.get('cat')) r.sec = q.get('cat');
        if (q.get('dir')) { r.id = q.get('dir'); delete r.dir; }
      }
      if (q.has('t') && q.get('t') !== '' && Number.isFinite(Number(q.get('t'))) && Number(q.get('t')) >= 0) r.t = Number(q.get('t'));
      if ((name === 'editor' || name === 'task') && !r.id) return {...HOME};
      return canonicalRoute(r);
    } catch { return {...HOME}; }
  }

  window.BC_NAV = {KEY, HOME, fresh, load, save, push, replace, back, fwd, canBack, canFwd, current, isSame, hrefFor, routeFromHref};
})();
