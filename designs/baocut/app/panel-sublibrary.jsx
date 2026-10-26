/* 字幕样式库（caption-editor-redesign §9.1）——取代此前「分区平铺所有卡」的画廊。

   推进来的一页，页头下是轨条与「套到」（这两件不属于样式，保持现状，产品设计 §5.9），
   再往下是这一页自己的几样：搜索、来源（全部 / 内置 / 我的 / 每个样式包）、选了来源之后
   它自己的分区、效果标签（可多选，彼此取交集）、「只看合适的」。筛选与陈列是纯函数
   （`BC_LIB`，app/model-sublibrary.js，有测试），这里只画。

   卡沿用画廊的三件：悬停在画面上预览、点下去套用（可撤销）、铅笔进属性页。新加的：
   一颗星（收藏）、卡底一行适配提示（§8，只标不藏）、缩略图写这条轨当下这句的前几个词，
   卡进了可视区才动。「加宽」把右侧面板拉到最宽一档，再点回到原来的宽度。 */
(function () {
  const D = window.BC_DATA;
  const S = window.BC_SUB;
  const WA = window.BC_WA;
  const LIB = window.BC_LIB;

  /** 卡进了可视区才动（§12 验收：一千张卡时只有可见卡在渲染节拍）。 */
  function useSeen(ref) {
    const [seen, setSeen] = React.useState(false);
    React.useEffect(() => {
      const el = ref.current;
      if (!el || typeof IntersectionObserver === 'undefined') { setSeen(true); return undefined; }
      const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting), {rootMargin: '96px'});
      io.observe(el);
      return () => io.disconnect();
    }, []);
    return seen;
  }

  /** 这一句的前四个词：缩略图一格放得下，又认得出是自己的字幕。 */
  function short(text) {
    if (!text) return null;
    const w = WA.split(text).slice(0, 4);
    return w.map((x, i) => (i ? WA.joint(w[i - 1], x) : '') + x).join('');
  }

  function LibCard({p, on, rows, texts, fav, fit, peek, onPick, onEdit, onFav}) {
    const ref = React.useRef(null);
    const seen = useSeen(ref);
    const off = !!fit.blocked;
    const notes = off ? [fit.blocked] : fit.notes;
    const badge = p.badge || window.BC_CS.badge(window.subWordOf(p, 'source', window.lookPaint(p.look)).aw);
    return (
      <div ref={ref} className={cx('scard', 'sublib__card', on && 'is-on', off && 'is-off')}>
        <BCAction className="scard__b" disabled={off} onClick={off ? undefined : onPick} {...(off ? null : peek)}>
          <window.SubThumb p={p} rows={rows} texts={texts} idle={!seen} />
          <span className="scard__badge">{badge}</span>
          {on ? <i className="scard__tick"><Ic n="check" className="ic--14" /></i> : null}
        </BCAction>
        <div className="scard__f">
          <span className="scard__n" title={p.name}>{p.name}</span>
          {p.pack ? <span className="sublib__pk" title={p.pack.name}>{p.pack.name}</span> : null}
          <IconBtn icon="star" size="xs" tip={fav ? '取消收藏' : '收藏'} on={fav} onClick={onFav} />
          {off ? null : <IconBtn icon="edit" size="xs" tip="编辑这份样式" onClick={onEdit} />}
        </div>
        {notes.length ? <div className="sublib__fit" title={notes.map((x) => x.text).join('；')}>{notes[0].text}</div> : null}
      </div>
    );
  }

  /** 筛选那一块：搜索 → 来源 → 来源自己的分区 → 效果标签 → 只看合适的。 */
  function LibFilters({f, setF, srcs, cats, tags, total}) {
    const R = window.RSP;
    return (
      <div className="sublib__bar">
        <R.SearchField aria-label="搜索样式" placeholder="搜索名字或效果" value={f.q} size="S"
          onChange={(q) => setF(Object.assign({}, f, {q}))} UNSAFE_className="sublib__search" />
        <div className="sublib__row">
          <Segmented size="s" value={f.source} onChange={(k) => setF(LIB.withSource(f, k))}
            items={srcs.map((s) => ({k: s.k, label: s.name}))} />
        </div>
        {cats.length ? (
          <div className="sublib__chips" role="group" aria-label="分区">
            {[{k: 'all', name: '全部分区'}].concat(cats.map((c) => ({k: c.k || c.id, name: c.name}))).map((c) => (
              <R.ToggleButton key={c.k} isQuiet size="S" isSelected={f.cat === c.k}
                onChange={() => setF(Object.assign({}, f, {cat: c.k}))}>{c.name}</R.ToggleButton>
            ))}
          </div>
        ) : null}
        <div className="sublib__chips sublib__chips--tags bc-scroll" role="group" aria-label="效果">
          {tags.map((t) => (
            <R.ToggleButton key={t.k} size="S" isSelected={f.tags.indexOf(t.k) >= 0}
              onChange={() => setF(LIB.toggleTag(f, t.k))}>{t.name}</R.ToggleButton>
          ))}
        </div>
        <div className="sublib__row">
          <Switch ariaLabel="只看合适的" on={!!f.fitOnly} onChange={(v) => setF(Object.assign({}, f, {fitOnly: v}))} />
          <span className="sublib__fitk">只看合适的</span>
          {LIB.hasFilter(f) ? (
            <span className="sublib__count">
              {total} 份样式 · <BCAction className="sublib__clear" onClick={() => setF(LIB.cleared(f))}>清除筛选</BCAction>
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  /** 「加宽」默认拉的是时间线视图的右侧面板：拉到最宽一档（三到四列），再点回到原来的宽度。
   *  面板宽度本来就能拖，这只是一个快捷档。别的宿主（轻量视图的侧栏）自己给 `widen`。 */
  function paneWiden(app) {
    const LY = window.BC_LAYOUT;
    const paneW = app.prefs.paneW == null ? LY.PANE_DEFAULT : app.prefs.paneW;
    return {
      wide: paneW >= LY.PANE_MAX,
      setWide: (v) => {
        if (v) { app.setPref('subPaneNarrow', paneW); app.setPref('paneW', LY.PANE_MAX); }
        else app.setPref('paneW', Math.min(app.prefs.subPaneNarrow || LY.PANE_DEFAULT, LY.PANE_MAX - 40));
      },
    };
  }

  function SubLibrary({ctx, ops, editId, onBack, onEdit, backLabel, widen}) {
    const app = useApp();
    const st = ctx.subStyle;
    /* 「套到」（第 152 轮）：默认全部；指到一条轨时只给它上妆，缩略图也只重画那一行。 */
    const [scope, setScope] = React.useState('all');
    const [f, setF] = React.useState({source: 'all', cat: 'all', q: '', tags: [], fitOnly: false});
    const vis = S.tracks(st).filter((t) => !t.hidden);
    const scopeId = scope !== 'all' && vis.some((t) => t.id === scope) ? scope : null;
    const scopeT = scopeId ? S.byId(st, scopeId) : null;
    const fav = app.prefs.subFav || [];
    const recent = app.prefs.subRecent || [];

    /* toast 只说这一次给哪几条上了妆；撤销是真回滚（涂装、勾在哪张卡上、cue 级覆盖一起退回）。 */
    const apply = (p) => {
      const before = st;
      const r = ctx.applyPreset(p, scopeId);
      app.setPref('subRecent', LIB.pushRecent(recent, p.id));
      const names = r.painted.map((t) => t.name).join(' + ');
      const others = vis.filter((t) => t.id !== scopeId).map((t) => t.name).join('、');
      const msg = scopeT
        ? '已给 ' + scopeT.name + ' 换上「' + p.name + '」' + (others ? ' · ' + others + '没动' : '')
        : '已套用「' + p.name + '」· 已给 ' + names + ' 换上这份样式';
      app.toast(msg, 'positive',
        {label: '撤销', undo: true, run: () => { ctx.restoreSubStyle(before); app.toast('已撤销套用'); }});
    };

    /* 卡：品牌库存卡（旧形态一律按 `screen` 陈列）＋ 内置目录；样式包的模板卡由 `BC_PACK` 给。 */
    const brand = D.brand.subStyles.map((b) => Object.assign({anim: 'none'}, b,
      {form: 'screen', look2: b.look2 || b.look, brand: true, cat: 'brand'}));
    const catalog = React.useMemo(() => window.BC_CS.galleryCards(D.subtitle.catalog), []);
    const packs = window.BC_PACK ? window.BC_PACK.installed() : [];
    const packCards = React.useMemo(() => (window.BC_PACK ? window.BC_PACK.cards() : []), []);
    const cards = brand.concat(catalog, packCards);

    /* 适配对着「这一次套到哪几条」：全部 → 画面上有一条带逐词时间就算有。 */
    const targets = scopeT ? [scopeT] : vis;
    const target = {wordTiming: targets.some((t) => S.hasWordTiming(t) && t.wordTiming !== false),
      script: window.BC_PACK && targets[0] ? window.BC_PACK.scriptOf(targets[0].lang) : null};
    const names = {cat: Object.fromEntries(D.subtitle.cats.map((c) => [c.k, c.name])), tag: window.BC_SURF.tagName};
    const secs = LIB.sections(cards, f, {cats: D.subtitle.cats, packs, fav, recent, target, names});
    const srcs = LIB.sources(packs);
    const cats = LIB.categoriesOf(f.source, D.subtitle.cats, packs);
    const tags = window.BC_SURF.TAGS.filter((t) => cards.some((c) => (c.tags || []).indexOf(t.k) >= 0));

    /* 缩略图写这条轨当下这句（没有当前句时用样张）。 */
    const cue = ctx.curCue;
    const texts = cue ? {orig: short(ctx.cueText ? ctx.cueText(cue.id) : cue.text), trans: short(cue.trans)} : null;
    const rowsOf = (p) => S.screenRows(st, p, D.subtitle.specimen.main, scopeId);
    const onCard = (p) => scopeT
      ? S.family(S.presetOf(st, scopeT)) === S.family(p.id)
      : !!S.currentCard(st, [p], true);
    const card = (sec) => (p) => (
      <LibCard key={sec + ':' + p.id} p={p} on={onCard(p)} rows={rowsOf(p)} texts={texts}
        fav={fav.indexOf(p.id) >= 0} fit={LIB.fitOf(p, target)}
        peek={window.peekProps(ctx, 'sub', (d) => ctx.stagePreset(d, p, scopeId).doc)}
        onFav={() => app.setPref('subFav', LIB.toggleFav(fav, p.id))}
        onPick={() => apply(p)} onEdit={() => { apply(p); onEdit(); }} />
    );

    const W = widen || paneWiden(app);

    const empty = (s) => s.k === 'brand'
      ? '品牌库还是空的。在属性页调好一份样式，页脚的「存到品牌库」会把它存在这里，下一部视频也用得上。'
      : s.k === 'fav' ? '还没有收藏。点卡上的星，常用的样式会收在这里。'
      : s.k === 'recent' ? '套用过的样式会按时间排在这里。' : '没有符合的样式。';

    const body = !ctx.subsOn
      ? (
        <div className="subhid">
          <Ic n="captions" className="ic--16" />
          <span className="grow">字幕已隐藏 · 画面上不显示</span>
          <Btn variant="secondary" size="s" onClick={() => ctx.setSubsOn(true)}>显示</Btn>
        </div>
      )
      : (
        <div className="pscroll bc-scroll sublib" onMouseLeave={() => ctx.setPeek(null)}>
          <LibFilters f={f} setF={setF} srcs={srcs} cats={cats} tags={tags} total={LIB.count(secs)} />
          {secs.length ? secs.map((s, i) => (
            <React.Fragment key={s.k}>
              <SecHead first={i === 0} aside={s.note || null}>{s.name}</SecHead>
              {s.items.length
                ? <div className="sgrid sublib__grid">{s.items.map(card(s.k))}</div>
                : <div className="signpost">{empty(s)}</div>}
            </React.Fragment>
          )) : <div className="sublib__none">没有符合的样式。换个词，或<BCAction className="sublib__clear" onClick={() => setF(LIB.cleared(f))}>清除筛选</BCAction>。</div>}
          <div className="hint">
            每张卡画的都是你画面上现在这几条字幕。套一张只换外观，不会多一条、也不会少一条。
            {vis.length > 1 ? '「套到」指到一条时只换那一条，别的一根线都不动。' : null}
          </div>
        </div>
      );

    const R = window.RSP;
    return (
      <>
        <window.PanelHead title="字幕样式" onBack={onBack} backTip={`返回${backLabel}`}>
          <R.ToggleButton size="S" isQuiet isSelected={W.wide} onChange={W.setWide}>加宽</R.ToggleButton>
        </window.PanelHead>
        <div className="substrip--page">
          <window.SubTrackStrip ctx={ctx} ops={ops} editId={editId} />
          {vis.length > 1 && ctx.subsOn ? (
            <div className="subscope-row">
              <span className="substrip__k">套到</span>
              <Segmented size="s" value={scopeId || 'all'} onChange={setScope}
                items={[{k: 'all', label: '全部'}].concat(vis.map((t) => ({k: t.id, label: S.label(t)})))} />
            </div>
          ) : null}
        </div>
        {body}
      </>
    );
  }

  Object.assign(window, {SubLibrary});
})();
