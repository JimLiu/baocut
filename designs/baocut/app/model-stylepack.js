/* 样式包（caption-editor-redesign §7）在原型里的一层：清单 → 样式库的模板卡、套用时冻结的
   来源（`origin`）、适配判定要的文字系统。纯函数，`node --test` 直接 require。

   清单按 `baocut.caption-style-pack/1` 的形状写；原型里每份样式的 `body` 不是包内路径，
   而是直接内联一份**场景草图**（`scene`，形状见 model-sceneadjust.js），字体与图片资源
   只列名字。真实应用里清单由安装流程读入、核心逐条校验场景；不能渲染的照样列出，卡上
   标「这台设备不支持」并给出原因。

   原型装的是 model-stylepack-demo.js 里两份通用的演示包（`window.BC_PACK_DEMO`）。BaoCut
   仓库不随附第三方样式包，真实的包来自文件导入、下载源或宿主应用。 */
(function () {
  const ADJ = window.BC_ADJ;
  const SCHEMA = 'baocut.caption-style-pack/1';

  /* 这台设备能渲染的能力（原型的近似画法认得的那几样）。清单里要的能力不在这里 → 不可套用。 */
  const CAPS = ['caption-gradient-glyph/1', 'caption-gradient-space/1', 'caption-image-paint/1',
    'caption-glyph-distance-coverage/1', 'caption-glow-cascade/1'];
  const CAP_NAME = {'caption-particle-burst/1': '粒子迸发', 'caption-mesh-warp/1': '网格扭曲'};

  /** LocalizedText：字符串，或「语言标签 → 文字」。原型界面是简体中文，取不到落回英文、再落回第一项。 */
  function text(t, lang) {
    if (t == null) return '';
    if (typeof t === 'string') return t;
    const want = [lang, 'zh-Hans', 'zh', 'en'].filter(Boolean);
    for (let i = 0; i < want.length; i++) if (t[want[i]]) return t[want[i]];
    const k = Object.keys(t)[0];
    return k ? t[k] : '';
  }

  /* ---------- 文字系统（ISO 15924） ---------- */
  const LANG_SCRIPT = {zh: 'Hans', 'zh-hans': 'Hans', 'zh-cn': 'Hans', 'zh-hant': 'Hant', 'zh-tw': 'Hant', 'zh-hk': 'Hant',
    ja: 'Jpan', ko: 'Kore', ar: 'Arab', fa: 'Arab', ur: 'Arab', ru: 'Cyrl', uk: 'Cyrl', bg: 'Cyrl', sr: 'Cyrl',
    el: 'Grek', he: 'Hebr', hi: 'Deva', th: 'Thai'};
  const LATIN = ['en', 'fr', 'de', 'es', 'pt', 'it', 'nl', 'sv', 'da', 'no', 'nb', 'fi', 'pl', 'cs', 'sk', 'ro', 'hu',
    'tr', 'id', 'ms', 'vi', 'tl', 'ca', 'hr', 'sl', 'et', 'lv', 'lt'];
  /** 这门语言用的文字系统；认不出的返回 null（不判「字体不含这门语言的字」，不冤枉卡）。 */
  function scriptOf(lang) {
    if (!lang) return null;
    const l = String(lang).toLowerCase();
    if (LANG_SCRIPT[l]) return LANG_SCRIPT[l];
    const base = l.split(/[-_]/)[0];
    if (base === 'zh') return 'Hans';
    if (LANG_SCRIPT[base]) return LANG_SCRIPT[base];
    return LATIN.indexOf(base) >= 0 ? 'Latn' : null;
  }
  /* 字体库（font-library-data.js）里的覆盖写法 → ISO 15924 */
  const LIB_SCRIPT = {latin: 'Latn', vietnamese: 'Latn', chinese: 'Hans', 'chinese-traditional': 'Hant', japanese: 'Jpan',
    korean: 'Kore', cyrillic: 'Cyrl', greek: 'Grek', hebrew: 'Hebr', arabic: 'Arab', devanagari: 'Deva', thai: 'Thai'};
  /** 一款字体覆盖的文字系统。字体库里查不到的按拉丁字体算。 */
  function fontScripts(family) {
    const list = window.BC_FONTLIB_DATA ? window.BC_FONTLIB_DATA.families : null;
    const hit = Array.isArray(list) ? list.find((f) => f && f.family === family) : null;
    const raw = hit && hit.scripts ? hit.scripts : ['latin'];
    const out = [];
    raw.forEach((s) => { const k = LIB_SCRIPT[s]; if (k && out.indexOf(k) < 0) out.push(k); });
    return out.length ? out : ['Latn'];
  }

  /* ---------- 清单 ---------- */
  const demo = () => (window.BC_PACK_DEMO || []).filter((p) => p && p.schema === SCHEMA);
  /** 装上的样式包。原型里是演示包；`list` 给了就用它（测试用）。 */
  function installed(list) {
    return (list || demo()).map((p) => ({id: p.id, version: p.version, name: text(p.name), publisher: p.publisher || null,
      categories: (p.categories || []).map((c) => ({id: c.id, name: text(c.name)})), manifest: p}));
  }
  const packById = (id, list) => installed(list).find((p) => p.id === id) || null;

  /** 这份样式这台设备渲染不了：缺哪几样能力。 */
  function missing(style) {
    return (style.requires || []).filter((c) => CAPS.indexOf(c) < 0);
  }
  function unsupportedOf(style) {
    const m = missing(style);
    if (!m.length) return null;
    return {missing: m, reason: '缺少' + m.map((c) => CAP_NAME[c] || '未知能力').join('、')};
  }

  /** 冻结时写进样式文档的来源（§5 `origin`）：调整前场景的摘要，还原、勾选态与「有新版本」都靠它。 */
  function origin(pack, style) {
    return {pack: {id: pack.id, version: pack.version}, template: {id: style.id, revision: style.revision || 1},
      sceneSha256: ADJ.digest(style.scene)};
  }

  const summary = (scene, adjust) => ADJ.describe(scene, adjust, {fontScripts});

  /** 样式库的模板卡。缩略图、角标、效果标签、适配判定都从摘要与 `toPaint` 来，不另写一份。 */
  function cards(list) {
    const out = [];
    installed(list).forEach((pk) => {
      (pk.manifest.styles || []).forEach((s) => {
        const sum = summary(s.scene, null);
        const look = ADJ.toPaint(s.scene, null, {role: 'source'});
        const look2 = ADJ.toPaint(s.scene, null, {role: 'translation'});
        const kw = s.scene.states && s.scene.states.keyword;
        const kf = kw && kw.font ? (s.scene.fonts || []).find((f) => f.key === kw.font) : null;
        out.push({
          id: 'pk:' + pk.id + ':' + s.id, name: text(s.name), form: 'screen', cat: 'pack', anim: 'none',
          pack: {id: pk.id, name: pk.name, version: pk.version},
          categories: (s.categories || []).slice(),
          tags: s.tags && s.tags.length ? s.tags.slice() : sum.behaviors,
          needsWordTiming: sum.needsWordTiming,
          scripts: sum.fonts.length ? sum.fonts[0].scripts : null,
          unsupported: unsupportedOf(s),
          look, look2,
          activeWord: look.activeWord, motion: look.motion, pagination: look.pagination, wordBox: look.wordBackground,
          emphasis: look.highlight ? {color: kw.color, fontFamily: kf ? kf.family : null, bold: kw.bold !== false, scale: kw.scale || 1} : null,
          template: {pack: pk.id, style: s.id},
        });
      });
    });
    return out;
  }

  /** 卡 id → `{pack, style}`；不是模板卡或包已卸载返回 null。 */
  function byCard(id, list) {
    const m = /^pk:([^:]+):(.+)$/.exec(String(id || ''));
    if (!m) return null;
    const pk = packById(m[1], list);
    const style = pk && (pk.manifest.styles || []).find((s) => s.id === m[2]);
    return style ? {pack: pk, style} : null;
  }
  const isTemplateCard = (p) => !!(p && p.template);

  /** 一条轨上冻结的来源对应的包还在不在、有没有新版本（§9.1「有更新时出一个点」）。 */
  function originState(org, list) {
    if (!org || !org.pack) return {pack: null, removed: false, newer: false};
    const pk = packById(org.pack.id, list);
    if (!pk) return {pack: null, removed: true, newer: false};
    const s = (pk.manifest.styles || []).find((x) => x.id === org.template.id);
    return {pack: pk, removed: false, newer: !!s && (s.revision || 1) > org.template.revision};
  }

  /* ---------- 套用到一条轨（原型里一条轨就是一层字幕） ---------- */
  const PLACE = ['y', 'x', 'width'];
  /** 套用 = 冻结（§7）：场景整份写进轨里，连同来源（`origin`）与由它算出来的画法键；调整层从空开始。
   *  再点同一份模板时保留已有的调整——铅笔是「套用再进属性页」，不能把刚调好的东西冲掉。
   *  关键词与 seed 是字幕实例的数据（`presentation`，§11），换样式不动；轨上还没有时，把组合样式
   *  里手动点过的强调词带成 `keyword` 词标签。落位以套用时轨的锚点为准，记在 `home`，调整页的
   *  「还原」回到它。`ctx = {role, preset}`。 */
  function applyToTrack(t, ref, ctx) {
    const c = ctx || {};
    const same = !!(t.scene && t.origin && t.origin.pack && t.origin.pack.id === ref.pack.id && t.origin.template.id === ref.style.id);
    const adjust = same ? t.adjust || null : null;
    const marks = t.highlight && t.highlight.marks;
    const pres = t.presentation || (marks && Object.keys(marks).length ? {wordTags: {keyword: marks}} : null);
    const home = t.scene && t.home ? t.home : {y: t.y, x: t.x, width: t.width};
    const paint = ADJ.toPaint(ref.style.scene, adjust, {role: c.role || 'source', presentation: pres});
    const out = Object.assign({}, t, paint, {preset: c.preset || t.preset, scene: ref.style.scene,
      origin: same ? t.origin : origin(ref.pack, ref.style), adjust, presentation: pres, home});
    if (!same) {
      /* 换了一份模板：上一份的调整不带过来，字号与落位回到套用模板之前 */
      if (t.adjust && t.adjust.fontScale) out.size = Math.round(t.size / t.adjust.fontScale);
      PLACE.forEach((k) => { if (home[k] === undefined) delete out[k]; else out[k] = home[k]; });
    }
    return out;
  }
  /** 从模板换回组合样式时要清的几样（`stagePreset` 合进它算好的那一份）：场景、来源、调整层、`home`；
   *  字号倍率退回去；模板点亮的关键词外观关掉（词标签留在 `presentation`，换回带关键词的样式时还在）。 */
  function leaveTemplate(t, next) {
    const out = {scene: null, origin: null, adjust: null, home: null};
    if (t.adjust && t.adjust.fontScale) out.size = Math.round(t.size / t.adjust.fontScale);
    const h = next && next.highlight;
    if (h && h.on) out.highlight = Object.assign({}, h, {on: false});
    return out;
  }

  window.BC_PACK = {SCHEMA, CAPS, text, scriptOf, fontScripts, installed, packById, missing, unsupportedOf,
    origin, summary, cards, byCard, isTemplateCard, originState, applyToTrack, leaveTemplate};
})();
