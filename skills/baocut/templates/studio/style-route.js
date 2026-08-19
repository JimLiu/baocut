// BaoCut Subtitle Studio — 项目页面的深链路由（tab + 样式层）。
//
// 服务端对 `/projects/<id>/(transcript|subtitle|translation|translate|style)`
// 一律 SPA fallback 回 index.html（apps/cli/src/serve/router.rs），路径的语义完全
// 由前端解释：
//   · transcript / subtitle / translation(=translate) → 选中对应 tab；
//   · style → M89 之后 Style 不再是第四个 tab，而是覆盖右侧 pane 的 slide-over，
//     所以这条深链解释为「tab=transcript + 打开样式层」。样式层的 ctx 不进 URL：
//     它由入口（舞台工具条 / 样式选择器 / 当前 tab）决定，深链一律给字幕样式。
//
// 只有字符串处理，没有 DOM/React 依赖：可以在 node 里直接 require 做断言。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BCS_STYLE_ROUTE = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // 对外规范名是 translation，内部 tab 名是 translate。
  const TAB_FROM_URL = {
    transcript: 'transcript', subtitle: 'subtitle',
    translation: 'translate', translate: 'translate',
  };
  const URL_FROM_TAB = {
    transcript: 'transcript', subtitle: 'subtitle', translate: 'translation',
  };
  // 末段后允许一个尾斜杠：pushState 写出来的路径没有它，但用户手敲的深链会有。
  const PATH_RE = /\/(subtitle|transcript|translation|translate|style)\/?$/;
  const DEFAULT_TAB = 'transcript';

  // 末段 → { tab, styleOpen }。认不出末段时按 transcript 处理（项目根路径就是它）。
  function routeFromPath(pathname) {
    const match = PATH_RE.exec(String(pathname || ''));
    if (!match) return { tab: DEFAULT_TAB, styleOpen: false };
    if (match[1] === 'style') return { tab: DEFAULT_TAB, styleOpen: true };
    return { tab: TAB_FROM_URL[match[1]] || DEFAULT_TAB, styleOpen: false };
  }

  // { tab, styleOpen } → 应该出现在地址栏里的路径。样式层打开时末段恒为 style
  // （层盖住了 tab 栏，URL 指向被盖住的 tab 只会在刷新后自相矛盾）。
  // 末段不带尾斜杠：相对 fetch 的基准目录必须保持在项目目录上。
  function pathFor(pathname, tab, styleOpen) {
    const base = String(pathname || '').replace(PATH_RE, '').replace(/\/*$/, '/');
    const leaf = styleOpen ? 'style' : (URL_FROM_TAB[tab] || URL_FROM_TAB[DEFAULT_TAB]);
    return base + leaf;
  }

  return { TAB_FROM_URL, URL_FROM_TAB, PATH_RE, DEFAULT_TAB, routeFromPath, pathFor };
});
