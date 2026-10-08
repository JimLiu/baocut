/* Elements 面板的浏览结构（第 122 轮整表重排）。

   三个视图：目录页、贴纸子页、可视化子页。这一层只放**算得出来的东西**——分节次序、chip 表、包→chip 的映射、网格次序、点一格建出来
   的那条元素——视图 `panel-elements.jsx` / `panel-elements-sections.jsx` 只负责画。

   ## 定死的四件事

   1. **顶层 chip 恰好四格**（`TABS`）：All / Stickers / Shapes / Visualizers。
      BaoCut 特有的一段（模板）**不加第五格 chip**——这一行只放四个大类；
      它在目录页有自己的「查看全部」钻进去，没有东西够不着。
      2026-09-14 这一段去掉了挂在模板后面的四格取景框 / 覆盖层（`frameItems`），
      只剩模板目录；组（`BC_TPL.GROUPS`）像贴纸包 / 可视化那样用二级 chip 切（`tplChips`）。
   2. **目录页分节自上而下**：贴纸 → 动态贴纸 → 形状 → 可视化 → CTA 弹窗。每段标题
      右边一个「查看全部 ›」，每段只摆**一屏四格**（`TILES = 4`，四列一行）。CTA 弹窗是
      一个普通贴纸包被单独提出来摆一段，不是第五个 chip（2026-09-14 带着 Tabler 图标
      组合出来的 32 款素材回归）。
   3. **贴纸的二级 chip**：All / Featured / Emojis，其余第三方包全进「⋯」。
      Social 空包与内置自绘贴纸都不再进入目录。`Icons` 不单占 chip。
   4. **可视化的二级 chip 恰好三格**（`VIZ_CATS`）：All / Progress / Sound Waves。计时那两格
      在进度网格里排在 `snake` 与 `snake_spin` 之间，所以它跟着进度这一档走，
      不再自己占一格 chip（第 88 轮那一格据此退场）。

   ## 内置贴纸

   贴纸的「内置」（核心 `sticker/*.json` 十款矢量贴纸）是 App v2 真有的东西，本仓库
   多这一格。它**不单占一格 chip**——排在「⋯」下拉的最前面。 */
(function () {
  /* ---------- 顶层 chip 与分节 ---------- */

  /** 目录页顶上恰好四格 */
  const TABS = [
    {k: 'all', label: '全部'},
    {k: 'st', label: '贴纸'},
    {k: 'sh', label: '形状'},
    {k: 'viz', label: '可视化'},
  ];

  /** 可视化子页恰好三格 */
  const VIZ_CATS = [
    {k: 'all', label: '全部'},
    {k: 'pr', label: '进度'},
    {k: 'sw', label: '声波'},
  ];

  /** 目录页每段摆几格（四列网格的第一行） */
  const TILES = 4;

  /* `tab` 是「查看全部」钻进去的那一页；`pack` 是钻进去之后钉在哪一格二级分类上。
     `bao` 标 BaoCut 特有——顶层 chip 里没有它们，只在目录页出现。 */
  const SECTIONS = [
    {k: 'st', tab: 'st', title: '贴纸', note: '16 个静态包', subs: 'pack'},
    /* 第 231 轮：Confetti 那 10 张 SVG 退出目录，换成算法粒子元素「彩纸」（十款配方，
       `model-confetti.js`），仍摆在这一段里——用户找它的地方没变。 */
    {k: 'gif', tab: 'gif', title: '动态贴纸', note: '5 个 Noto Lottie 分类 ＋ 彩纸 10 款 ＋ Codex Pet · 收 Lottie / GIF / Pet zip · 支持分色编辑', badge: true},
    {k: 'sh', tab: 'sh', title: '形状', note: '23 格 · 五色循环'},
    {k: 'viz', tab: 'viz', title: '可视化', note: '进度 14 ＋ 计时 2 ＋ 声波 10', subs: 'viz'},
    /* CTA 弹窗（2026-09-14 回归）：一个普通贴纸包被单独提出来摆一段，「查看全部」钻进
       贴纸子页并钉在 `cta` 包上。素材是 Tabler 实心图标 ＋ 圆角底 ＋ 随包 OFL 字体转曲的
       文字，中英各 16 款（`scripts/dev/elements/generate.py` 的 `CTA_BUTTONS`）。 */
    {k: 'cta', tab: 'st', title: 'CTA 弹窗', note: '32 款 · 订阅 / 点赞 / 分享 / 购买', pack: 'cta'},
    /* 白板手绘段暂不上架（2026-09-14：功能还没准备好）。`WhiteboardGrid` 与
       `model-whiteboard.js` 保留，回来时把 `{k: 'wb', tab: 'wb', title: '白板手绘',
       note: 'BaoCut 特有 · 三份内置示范', bao: true}` 加回这里。 */
    {k: 'fr', tab: 'fr', title: '模板', note: 'BaoCut 特有 · 内置 17 款 ＋ 品牌库', subs: 'tpl', bao: true},
  ];

  /** 目录页摆全部分节；钻进某一页只摆那一段（顶层 chip 与「查看全部」共用这一条） */
  function sections(tab) {
    if (!tab || tab === 'all') return SECTIONS.slice();
    return SECTIONS.filter((s) => s.k === tab);
  }
  function sectionOf(k) {
    return SECTIONS.filter((s) => s.k === k)[0] || null;
  }

  /* ---------- 贴纸的二级 chip ---------- */

  /* 有实际第三方素材的头档包；其余包一律进「⋯」。 */
  const STICKER_CHIPS = [
    {k: 'featured', label: '精选'},
    {k: 'emoji', label: '表情'},
  ];
  /** 品牌库那一格（第 238 轮）：`ctx.brandStickers` 里用户自己传的贴纸。它和「内置」
      一样是 BaoCut 特有的，不算在全部 / 精选 / 表情那三格里。第 239 轮起排在**「全部」之后
      第一格**（此前在最后）：两个贴纸分节里「我的贴纸」那一段也挪到了网格最上面，
      chip 的次序就是段的次序，两处对不上就等于给了两条互相矛盾的位次承诺。
      空的时候也摆着，点进去是一句指路（去品牌库上传），不是一片空白。 */
  const BRAND_CAT = {k: 'brand', label: '我的贴纸', bao: true};

  /** 摆出来的那几格（第三方包不存在就不摆空 chip；「我的贴纸」不是包，恒在第二格） */
  function stickerChips(packs) {
    const has = (k) => (packs || []).some((p) => p.k === k);
    return [{k: 'all', label: '全部'}, BRAND_CAT]
      .concat(STICKER_CHIPS.filter((c) => has(c.k)));
  }
  /** 「⋯」下拉里的第三方包，按目录原序 */
  function stickerRest(packs) {
    const on = STICKER_CHIPS.map((c) => c.k);
    return (packs || []).filter((p) => on.indexOf(p.k) < 0);
  }

  /* ---------- 模板的二级 chip ---------- */

  /** 模板子页顶上那一行（2026-09-14）：「全部」＋ 当前有模板的组，组由
      `BC_TPL.groupTemplates` 算（品牌库空就没有那一格），与贴纸包 / 可视化那两行
      同一条做法——不再是一列到底、靠组头分节的长表。 */
  function tplChips(groups) {
    return [{k: 'all', label: '全部'}].concat((groups || []).map((g) => ({k: g.key, label: g.label})));
  }

  /* ---------- 动态贴纸的分类次序 ---------- */

  /* 动图分类按分类键的**字母序**摆；本仓库整类不收 logos 与 social_media
     （满屏平台标识），表里留着这两格不影响其余分类的次序。 */
  const ANIM_ORDER = ['arrows', 'collage', 'confetti', 'emoji', 'growth', 'highlight',
    'holiday', 'logos', 'new', 'shapes', 'social_media', 'tap_here', 'typography',
    'words', 'work'];
  const ANIM_KEY = {
    'dyn-collage': 'collage',
    'dyn-emoji': 'emoji', 'dyn-grow': 'growth',
    'dyn-holiday': 'holiday', 'dyn-work': 'work',
  };
  /** 彩纸在动态贴纸分类 chip 里的那一格（第 231 轮）：它不是 `BC_SK.ANIM` 里的包，
      次序仍按 `confetti` 在 `ANIM_ORDER` 里的位次插在 collage 与 emoji 之间。 */
  const CONFETTI_CAT = {k: 'confetti', label: '彩纸', bao: true};
  /** Codex Pet（第 242 轮）：桌宠雪碧图那一类。它也不是 `BC_SK.ANIM` 里的包，且
      没有对应的分类键，所以不进 `ANIM_ORDER` 的位次表，固定排在「我的贴纸」之后、随包目录
      之前——它一半是用户自己的东西（传 zip 进来的），一半是 BaoCut 自带的（官方 9 只
      与社区索引），放在两者之间。 */
  const PET_CAT = {k: 'pet', label: 'Pet', bao: true};
  /** 彩纸落在第几格（不含「我的贴纸」那一格）。视图按它把彩纸那一段插进包序里，
      所以它必须与 `animCats` 用的是同一个判据——否则 chip 说彩纸在第三格、网格把
      它画在第四段。 */
  function confettiAt(anims) {
    const list = animOrder(anims);
    const at = list.findIndex((c) => ANIM_ORDER.indexOf(ANIM_KEY[c.k]) > ANIM_ORDER.indexOf('confetti'));
    return at < 0 ? list.length : at;
  }
  function animCats(anims) {
    const list = animOrder(anims).map((c) => ({k: c.k, label: c.label}));
    list.splice(confettiAt(anims), 0, CONFETTI_CAT);
    // 「我的贴纸」在最前（第 239 轮）：它是用户自己的东西，先于随包目录；Pet 紧随其后。
    list.unshift(BRAND_CAT, PET_CAT);
    return list;
  }
  /** 检索时彩纸那一段露不露：空串恒露；否则按中英文名与「粒子」匹配。 */
  function confettiMatch(q) {
    const k = String(q || '').trim().toLowerCase();
    return !k || '彩纸 confetti 粒子 particles'.indexOf(k) >= 0;
  }
  function animOrder(anims) {
    const rank = (c) => {
      const i = ANIM_ORDER.indexOf(ANIM_KEY[c.k]);
      return i < 0 ? ANIM_ORDER.length : i;
    };
    return (anims || []).slice().sort((a, b) => rank(a) - rank(b));
  }

  /* ---------- 可视化的网格次序 ---------- */

  /* 进度网格共 16 格，计时那两格夹在 `snake`（第 11 格）与 `snake_spin`
     之间——它们不是第三种着色器，只是位次挨着进度。`PROG_TILES` 是整张网格
     去掉这两格之后的 14 格。 */
  const COUNT_AT = 11;
  function progOrder(progTiles, counters) {
    const p = (progTiles || []).slice();
    return p.slice(0, COUNT_AT).concat(counters || [], p.slice(COUNT_AT));
  }

  /* 目录页可视化那四格是**手挑**的（`VIZ_PICK` 写死的四个 id），不是网格前四格：
     两款进度 ＋ 一款声波 ＋ 一款计时，一眼就说明这一段里有三种东西。 */
  const VIZ_PICK = [['prog', 'rainbow_border'], ['prog', 'rounded'],
    ['wave', 'ribbons'], ['count', 'countdown']];
  function vizPicks(prog, waves, counters) {
    const table = {prog: prog || [], wave: waves || [], count: counters || []};
    return VIZ_PICK
      .map((pk) => table[pk[0]].filter((x) => x.k === pk[1])[0])
      .filter((x) => !!x);
  }

  /* ---------- 点一格 = 新建一条元素 ---------- */

  /** 一格磁贴 → 那一类元素的样式补丁（没有对应样式的类型返回 null）。
      贴纸的素材与内置矢量互斥，落哪一个就把另一个清掉。换色表第 122 轮起不在共用
      样式袋里（`elDocs[id].fillList`），新建的这一条本来就没有，不用再清一遍。 */
  function tileStyle(kind, it) {
    if (!it) return null;
    if (kind === 'sticker') {
      if (it.builtin) return {asset: null, builtin: it.builtin.id};
      /* `assetKind`（第 238 轮）：品牌库上传的贴纸源是 `blob:…`，扩展名没了，
         光看 URL 判不出这是 Lottie 还是图片。收件时已经按字节判过一次，把结论
         一并落进样式袋，画布与属性页就不用再猜。内置素材有扩展名，留空即可。 */
      if (it.src) {
        const st = {asset: it.src, assetKind: it.kind || null, builtin: null};
        /* Codex Pet（第 242 轮）：版本（决定图集行数）、状态、名字与署名跟着元素走——
           社区 pet 的雪碧图是远端 URL，不回目录就查不到它是谁的、什么许可。 */
        if (it.kind === 'pet') st.pet = window.BC_PET.meta(it.pet || it);
        return st;
      }
      return null;
    }
    /* 声波的 dB 窗**跟着款走**（核心 `defaultMinDb` / `defaultMaxDb`）：10 款里
       示波器 / 环形波这 2 款是 −120 / −10 那扇窄而热的窗。第 211 轮把这
       两个键并进共用样式袋（条子上的「音量档位」飞出要读同一份）之后，建条时不写
       它们就会被袋里的缺省 −80 / 40 盖掉——点「示波器」建出来的窗是「柱状」的。 */
    if (kind === 'wave') {
      return Object.assign({style: it.k, main: it.main, second: it.second},
        it.minDb == null ? {} : {mindb: it.minDb, maxdb: it.maxDb});
    }
    if (kind === 'progress') return {style: it.k, main: it.main, second: it.second};
    // 计时：点哪一格落哪一种模式（倒计 / 正计），钟面沿用当前那一档
    if (kind === 'counter') return {mode: it.k};
    if (kind === 'shape' && it.shape) {
      return {shapeI: it.shape.i, fill: it.shape.fill, outline: it.shape.outline};
    }
    if (kind === 'tpl') return {templateId: it.id};
    /* 彩纸（第 231 轮）：点哪一款就落那一款的配方缺省，种子在这一刻随机写入
       （用户裁决：新建时写入随机种子；之后换款保留它）。 */
    if (kind === 'confetti') {
      const C = window.BC_CONFETTI;
      return {cf: C.defaults(it && it.k, C.randomSeed())};
    }
    /* 白板手绘：点哪份示范就落那份的笔画与节拍，手 / 纸 / 画时都是缺省。 */
    if (kind === 'whiteboard') return {wb: window.BC_WHITEBOARD.defaults(it && it.k)};
    return null;
  }

  const SEQ_KEY = {sticker: 'stk', shape: 'shp', progress: 'prg',
    wave: 'wav', counter: 'cnt', vframe: 'vfr', overlay: 'ovl', tpl: 'tpl', confetti: 'cft', whiteboard: 'wb'};

  /** 行名：`基名 · 这一格的名字`。基名取演示装置那一条的行名前半截（`贴纸 · ON AIR`
      → `贴纸`），这样时间轴上新建的与演示的读起来是同一族。 */
  const KIND_HEAD = {confetti: '彩纸', whiteboard: '白板'};   // 演示装置里没有这一族时的行名基名
  function elName(kind, tile, base) {
    const t = tile || {};
    const sub = t.builtin ? t.builtin.name : t.shape ? t.shape.name : (t.name || t.alt || null);
    const head = base && base.name ? String(base.name).split(' · ')[0] : (KIND_HEAD[kind] || kind);
    return sub ? head + ' · ' + sub : head;
  }

  /* 落位错开：同一格连点四下不能叠成一坨。铺满画面的那几类（`place.w >= 100`，
     覆盖层 / 取景框）不错开——它们本来就该盖满。

     错开的档位从 **1** 起，不是从 0 起（第 122 轮验收改）：`base.place` 是演示装置
     里同类那一条**正占着**的位置，第 0 档等于把新建的这一条严丝合缝地扣在它上面。
     那一下看起来不像「新建了一条」，而像「原来那条被选中了、还被改了色」——第 122
     轮报的那桩「点形状却选中了贴纸」的观感就是这么来的。 */
  const STAGGER = 4;
  const EDGE = 6;
  function placeOf(base, seq) {
    const p = Object.assign({x: 50, y: 50, w: 20}, base && base.place);
    if (p.w >= 100) return p;
    const n = ((seq || 1) - 1) % 4 + 1;
    const clamp = (v) => Math.max(EDGE, Math.min(100 - EDGE, v));
    return Object.assign({}, p, {x: clamp(p.x + n * STAGGER), y: clamp(p.y + n * STAGGER)});
  }

  /** 目录里点一格 → 一条可以交给 `ctx.addElement` 的新元素。

      起点恒是**播放头**，时长走 `BC_EL.NEW_SPAN`；计时是唯一的例外，它的时长就是
      它数多久，走 `BC_EL.COUNT_SPAN`（撞到片尾裁到片尾）。

      `opts.base` 传演示装置里同类那一条（`D.elements`），只取它的图标、色相与落位——
      时间轴上的行色与元素在画面上的惯用位是规格（§12.7），不该在这里重编一份。 */
  function newElement(kind, tile, opts) {
    const o = opts || {};
    const E = window.BC_EL;
    const seq = o.seq || 1;
    const base = o.base || {};
    const dur = kind === 'counter' ? E.COUNT_SPAN : E.NEW_SPAN;
    const span = E.spanAt(o.playT, o.total, dur);
    const patch = tileStyle(kind, tile);
    return {
      id: 'e-' + (SEQ_KEY[kind] || kind) + '-' + seq,
      kind: kind,
      name: elName(kind, tile, base),
      icon: base.icon || (kind === 'confetti' ? 'star' : kind === 'whiteboard' ? 'whiteboard' : 'elements'),
      hue: base.hue || (kind === 'confetti' ? 'magenta' : kind === 'whiteboard' ? 'brown' : 'purple'),
      added: true,
      start: span.start,
      end: span.end,
      /* 彩纸铺满画布（第 223 轮起的口径，第 231 轮由 kind 判定而不再看贴纸包名）：
         它是一层粒子场，不是一枚贴纸。 */
      place: kind === 'confetti' || kind === 'whiteboard' ? {x: 50, y: 50, w: 100, h: 100} : placeOf(base, seq),
      anim: {in: {k: 'none'}, out: {k: 'none'}, loop: {k: 'none'}},
      style: patch ? E.toStage(kind, patch) : null,
    };
  }

  Object.assign(window, {BC_ELPANEL: {
    TABS, VIZ_CATS, TILES, SECTIONS, sections, sectionOf, tplChips,
    STICKER_CHIPS, BRAND_CAT, stickerChips, stickerRest,
    ANIM_ORDER, ANIM_KEY, animOrder, CONFETTI_CAT, PET_CAT, animCats, confettiAt, confettiMatch,
    COUNT_AT, progOrder, VIZ_PICK, vizPicks,
    tileStyle, elName, placeOf, newElement,
  }});
})();
