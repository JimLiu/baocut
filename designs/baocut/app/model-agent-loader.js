/* BaoCut 原型 — 会话线程「智能体在干活」的像素加载图形（PixelLoader）用哪几个图
   window.BC_AGENT_LOADER。无 React、无 DOM，node --test 直接 require。只在 App 入口加载。

   这里只给图形的名字；视图按名字从 `RSP.AI.loader[name]` 取像素格，按键缓存一次，保证数组引用不变
   （PixelLoader 拿到新的数组引用就从第一个图重新播）。一个名字循环播；多个名字轮流播，每个图约 2.4 秒。

   - `ICONS`：随 @react-spectrum/ai 0.4.0 的全部图案类图形。字母类图形与含字母的预设拼的是第三方字标，不用。
   - `THINKING`：通用序列，用到全部图形，aiLogo 打头；回合页脚「正在工作」前播它；工作组标题找不到正在跑的那一步时取它的第一个图（静止）。会话输入框不放动画。
   - `forKind(kind)`：步骤类别（model-agent-tools.js 的 BaoCut 工具 + model-agent-turn.js 的通用类别）→ 2–4 个图的短序列；
     认不出的类别走 `FALLBACK`。同一个类别每次返回同一个（冻结的）数组。 */
(function () {
  const ICONS = Object.freeze([
    'aiLogo', 'brush', 'eye', 'hourglass', 'mag', 'crop', 'flower', 'image', 'lasso', 'page', 'wand',
    'bargraph', 'trefoil', 'dial', 'folder', 'arrow', 'cloud', 'comment', 'filter', 'microphone', 'pencil',
    'potion', 'slider', 'timeline', 'eyedrop', 'document', 'graph', 'cart', 'shop', 'journey', 'floppy',
  ]);

  /* 相邻两个图尽量不同类：声音、画面、文字、文件、数据交替出现 */
  const THINKING = Object.freeze([
    'aiLogo', 'wand', 'microphone', 'timeline', 'image', 'comment', 'crop', 'document', 'mag', 'brush',
    'cloud', 'slider', 'flower', 'page', 'dial', 'eye', 'lasso', 'potion', 'folder', 'eyedrop',
    'graph', 'pencil', 'trefoil', 'filter', 'journey', 'arrow', 'bargraph', 'shop', 'hourglass', 'cart', 'floppy',
  ]);

  /** 认不出的类别（以及通用的「其他工具」）。 */
  const FALLBACK = Object.freeze(['aiLogo', 'flower', 'trefoil']);

  const KINDS = {
    /* 声音与文字 */
    transcribe: ['microphone', 'comment', 'page'],
    speech: ['microphone', 'comment'],
    'speech-search': ['mag', 'microphone', 'comment'],
    translate: ['comment', 'page', 'document'],
    captions: ['comment', 'page', 'timeline'],
    /* 画面 */
    image: ['image', 'brush', 'wand', 'eyedrop'],
    capture: ['image', 'crop', 'eye'],
    /* 时间线上的活 */
    cut: ['timeline', 'crop', 'lasso'],
    timeline: ['timeline', 'slider', 'eye'],
    'edit-video': ['timeline', 'slider', 'wand', 'pencil'],
    undo: ['journey', 'arrow', 'timeline'],
    'video-read': ['eye', 'image', 'timeline'],
    /* 文稿与文件 */
    document: ['document', 'pencil', 'page'],
    'document-read': ['document', 'page', 'eye'],
    read: ['document', 'page', 'eye'],
    edit: ['pencil', 'brush', 'document'],
    search: ['mag', 'filter', 'eye'],
    'space-search': ['mag', 'filter', 'folder'],
    space: ['folder', 'shop', 'cart'],
    /* 进出 */
    import: ['cloud', 'arrow', 'folder'],
    download: ['cloud', 'arrow', 'floppy'],
    export: ['floppy', 'arrow', 'journey'],
    artifact: ['floppy', 'folder', 'cart'],
    /* 任务、模型与命令 */
    job: ['hourglass', 'bargraph', 'graph'],
    'model-read': ['dial', 'graph', 'potion'],
    command: ['dial', 'potion', 'trefoil'],
    other: FALLBACK,
  };
  Object.keys(KINDS).forEach((k) => { KINDS[k] = Object.freeze(KINDS[k]); });
  Object.freeze(KINDS);

  /** 步骤类别 → 图形名序列；认不出的走 FALLBACK。 */
  function forKind(kind) {
    return Object.prototype.hasOwnProperty.call(KINDS, kind) ? KINDS[kind] : FALLBACK;
  }

  /** 名字 → 像素格：按 `table`（视图传 `RSP.AI.loader`）取，缺的跳过；一个都没有返回 null（PixelLoader 用默认图形）。 */
  function resolve(names, table) {
    const cells = (names || []).map((n) => table && table[n]).filter((c) => Array.isArray(c) && c.length);
    return cells.length ? cells : null;
  }

  window.BC_AGENT_LOADER = {ICONS, THINKING, FALLBACK, KINDS, forKind, resolve};
})();
