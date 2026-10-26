/* 字幕样式库的筛选与陈列（caption-editor-redesign §8 / §9.1）。纯函数，视图在 panel-sublibrary.jsx。

   卡有三种来源：内置目录（`BC_CS.galleryCards`）、品牌库存卡（`brand: true`）、样式包里的模板卡
   （`pack: {id, name}`）。筛选的几个维度——来源、来源自己的分区、效果标签、搜索、只看合适的——
   彼此取交集；效果标签之间也取交集（选了「描边」「渐变」就是两样都要有）。

   适配判定对着「这一次套到哪几条」给出，只在卡上标，不藏卡；「只看合适的」才把它们收起：
     · 卡要逐词时间（当前词、念到时触发的动效、分页），套到的轨里一条都没有 → 逐词效果不动；
     · 模板字体不含这条轨语言的文字系统 → 按回退字体显示。组合样式的字体走应用的回退链，不标；
     · 这台设备渲染不了（样式包里的未知能力、超预算）→ 卡不可套用。 */
(function () {
  const BASE = [{k: 'all', name: '全部'}, {k: 'builtin', name: '内置'}, {k: 'mine', name: '我的'}];
  const MINE = [{k: 'fav', name: '收藏'}, {k: 'recent', name: '最近用过'}, {k: 'brand', name: '品牌库'}];
  const RECENT_MAX = 12;

  const COPY = {
    timing: '这条字幕没有逐词时间，逐词效果不动',
    font: '字体不含这门语言的字，按回退字体显示',
    device: '这台设备不支持',
  };

  /** 卡的来源键：`mine` / `pack:<id>` / `builtin`。 */
  function sourceOf(card) {
    if (card.brand) return 'mine';
    if (card.pack) return 'pack:' + card.pack.id;
    return 'builtin';
  }

  /** 来源分段：全部 / 内置 / 我的 / 每个装上的样式包。 */
  function sources(packs) {
    return BASE.concat((packs || []).map((p) => ({k: 'pack:' + p.id, name: p.name, pack: p})));
  }

  /** 选了一个来源之后那一排分区；「全部」没有分区那一排。 */
  function categoriesOf(source, cats, packs) {
    if (source === 'builtin') return cats || [];
    if (source === 'mine') return MINE;
    const pk = (packs || []).find((p) => 'pack:' + p.id === source);
    return pk ? pk.categories || [] : [];
  }

  /** 这张卡要不要逐词时间。模板卡读摘要给的 `needsWordTiming`。 */
  function needsTiming(card) {
    if (card.needsWordTiming != null) return !!card.needsWordTiming;
    if (card.anim && card.anim !== 'none') return true;     // 品牌库旧卡：十九格逐词动画
    const a = card.activeWord;
    if (a && a.mode && a.mode !== 'none') return true;
    if (a && ((a.spoken && a.spoken !== 'keep') || (a.unspoken && a.unspoken !== 'keep'))) return true;
    if (card.pagination && card.pagination.wordsPerPage) return true;
    const m = card.motion;
    return !!m && ['in', 'out', 'loop'].some((s) => m[s] && m[s].trigger === 'spoken');
  }

  /** 适配判定。`target`：`{wordTiming: boolean, script?: string}`，没给就不判。 */
  function fitOf(card, target) {
    const notes = [];
    if (card.unsupported) {
      const why = card.unsupported.reason ? ' · ' + card.unsupported.reason : '';
      return {notes, blocked: {k: 'device', text: COPY.device + why}};
    }
    if (!target) return {notes, blocked: null};
    if (target.wordTiming === false && needsTiming(card)) notes.push({k: 'timing', text: COPY.timing});
    if (card.scripts && target.script && card.scripts.indexOf(target.script) < 0) notes.push({k: 'font', text: COPY.font});
    return {notes, blocked: null};
  }
  const fits = (card, target) => { const f = fitOf(card, target); return !f.blocked && !f.notes.length; };

  const low = (s) => String(s == null ? '' : s).toLowerCase();

  /** 搜索：名字、分区名、效果标签名、包名，空格分开的每个词都要命中。 */
  function matches(card, q, names) {
    const words = low(q).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const N = names || {};
    const tagName = N.tag || ((k) => k);
    const hay = [card.name, card.id, N.cat && N.cat[card.cat], card.pack && card.pack.name]
      .concat((card.tags || []).map(tagName)).map(low).join(' ');
    return words.every((w) => hay.indexOf(w) >= 0);
  }

  /** 搜索、标签、分区里有一样在起作用。「只看合适的」是开关，不算筛选，「清除筛选」也不动它。 */
  const hasFilter = (f) => !!(f && ((f.q && f.q.trim()) || (f.tags && f.tags.length) || (f.cat && f.cat !== 'all')));

  /** 来源之外的几个维度取交集。来源与分区由 `sections` 处理。 */
  function filter(cards, f, ctx) {
    const c = ctx || {};
    const tags = (f && f.tags) || [];
    return cards.filter((card) => {
      if (!matches(card, f && f.q, c.names)) return false;
      if (tags.length && !tags.every((t) => (card.tags || []).indexOf(t) >= 0)) return false;
      if (f && f.fitOnly && !fits(card, c.target)) return false;
      return true;
    });
  }

  const byIds = (cards, ids) => (ids || []).map((id) => cards.find((c) => c.id === id)).filter(Boolean);

  /** 陈列：一组 `{k, name, note, items}`。品牌库那一节在没筛选时即使空也留着（视图给一句引导）。
   *  `ctx`：`{cats, packs, fav, recent, target, names}`。 */
  function sections(cards, f, ctx) {
    const c = ctx || {};
    const src = (f && f.source) || 'all';
    const cat = (f && f.cat) || 'all';
    const hit = filter(cards, f, c);
    const of = (s) => hit.filter((x) => sourceOf(x) === s);
    const keepBrand = !hasFilter(f);
    const brand = {k: 'brand', name: '我的品牌库', note: '跨视频共享', items: of('mine'), keep: keepBrand};
    const builtin = (c.cats || []).map((k) => ({k: k.k, name: k.name, note: k.note || null,
      items: of('builtin').filter((x) => x.cat === k.k)}));
    const pack = (p) => {
      const mine = of('pack:' + p.id);
      const pcats = p.categories || [];
      if (!pcats.length) return [{k: 'pack:' + p.id, name: p.name, items: mine}];
      return pcats.map((pc) => ({k: 'pack:' + p.id + ':' + pc.id, name: pc.name, note: p.name,
        items: mine.filter((x) => (x.categories || [])[0] === pc.id)}));
    };
    let out;
    if (src === 'all') {
      out = [brand].concat(builtin, (c.packs || []).map((p) => ({k: 'pack:' + p.id, name: p.name, note: '样式包', items: of('pack:' + p.id)})));
    } else if (src === 'builtin') {
      out = builtin.filter((s) => cat === 'all' || s.k === cat);
    } else if (src === 'mine') {
      const fav = byIds(hit, c.fav);
      const recent = byIds(hit, c.recent);
      out = [{k: 'fav', name: '收藏', items: fav}, {k: 'recent', name: '最近用过', items: recent}, brand]
        .filter((s) => cat === 'all' || s.k === cat);
    } else {
      const p = (c.packs || []).find((x) => 'pack:' + x.id === src);
      out = p ? pack(p).filter((s) => cat === 'all' || s.k === 'pack:' + p.id + ':' + cat) : [];
    }
    return out.filter((s) => s.items.length || s.keep);
  }

  /** 有筛选时列表顶上那一句里的数。 */
  const count = (secs) => {
    const seen = {};
    secs.forEach((s) => s.items.forEach((x) => { seen[x.id] = 1; }));
    return Object.keys(seen).length;
  };

  /** 收藏：有就去掉，没有就加在最前。 */
  function toggleFav(list, id) {
    const l = (list || []).filter((x) => x !== id);
    return l.length === (list || []).length ? [id].concat(l) : l;
  }

  /** 最近用过：挪到最前，去重，留 12 个。 */
  function pushRecent(list, id) {
    return [id].concat((list || []).filter((x) => x !== id)).slice(0, RECENT_MAX);
  }

  /** 换来源时分区回到「全部」；标签、搜索、只看合适的不动。 */
  const withSource = (f, source) => Object.assign({}, f, {source, cat: 'all'});
  /** 「清除筛选」：搜索、标签、分区清空，来源与「只看合适的」不动。 */
  const cleared = (f) => ({source: (f && f.source) || 'all', cat: 'all', q: '', tags: [], fitOnly: !!(f && f.fitOnly)});
  const toggleTag = (f, k) => Object.assign({}, f, {tags: ((f.tags || []).indexOf(k) >= 0
    ? f.tags.filter((t) => t !== k) : (f.tags || []).concat(k))});

  Object.assign(window, {BC_LIB: {
    BASE, MINE, RECENT_MAX, COPY,
    sourceOf, sources, categoriesOf, needsTiming, fitOf, fits, matches, hasFilter, filter, sections, count,
    toggleFav, pushRecent, withSource, cleared, toggleTag,
  }});
})();
