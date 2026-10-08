/* 短视频项目与来源项目的那条链接（§15.12）：项目卡 / 行 / 侧栏上的来源标记、
   编辑器视频 Tab 顶部的「原片」卡（短视频项目里）与「切出的短视频」一组（来源项目里）、
   片段现状写回项目记录。
   这一层是**普通的编辑动作**，不调模型、不起任务，所以 App 与 Web 共用；找片段的那条流程
   （store-shorts-cut / panel-aitools-shorts）只在 App——「切出的短视频」里去往它的两个入口
   （再切几支、调整后再生成）用 `BC_SURFACE.ai` 包着。判据与算术全在 model-shorts-cut.js。 */
(function () {
  const {useState, useEffect, useMemo, useRef} = React;
  const D = window.BC_DATA;
  const T = window.BC_TIME;
  const SC = window.BC_SHORTS_CUT;

  /** 时间轴上绑着原片的片段（元素与它的文档合起来才有现在的起止）。 */
  const piecesIn = (ctx) => SC.piecesOf(ctx.elements.map((e) => Object.assign({}, e, ctx.elDocs[e.id])));

  /* 徽标会落在项目卡里，而整张卡是一个 button：这里用 role="link" 的 span，不嵌套按钮。 */
  function Link({title, icon, onGo, children}) {
    const go = (e) => { e.stopPropagation(); e.preventDefault(); onGo(); };
    return (
      <span role="link" tabIndex={0} className="ss-origin t-truncate" title={title} onClick={go}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') go(e); }}>
        <Ic n={icon} className="ic--14" /><span className="t-truncate">{children}</span>
      </span>
    );
  }

  /** 项目卡 / 行上的来源徽标：点了打开来源项目并落在切出的那一刻。来源不在库里时只是一行字。 */
  function ShortsOriginBadge({p, short}) {
    const app = useApp();
    const o = SC.originLabel(app.projects, p);
    if (!o) return null;
    const text = short ? o.short : o.text;
    if (o.missing) return <span className="ss-origin is-missing t-truncate" title={text}>{text}</span>;
    return <Link icon="link" title={`${o.text} · 打开来源视频`} onGo={() => app.go({r: 'editor', id: o.parent.id, t: p.origin.in})}>{text}</Link>;
  }

  /** 来源项目卡 / 行上的计数：点了把项目页筛到它切出的那几支。 */
  function ShortsCountBadge({p}) {
    const app = useApp();
    const n = SC.childrenOf(app.projects, p.id).length;
    if (!n) return null;
    return <Link icon="clip" title="查看切出的短视频" onGo={() => app.go({r: 'projects', from: p.id})}>{SC.countLabel(n)}</Link>;
  }

  /** 侧栏项目行的副题：只读的一句「来自「…」」。 */
  function shortsSideNote(projects, p) {
    const o = SC.originLabel(projects, p);
    return o ? o.short : null;
  }

  /** 片段现状写回项目记录的 `used`（来源项目的「已切过」、项目页都读它）。编辑器挂一次。 */
  function useShortsUsed(ctx) {
    const app = useApp();
    const child = SC.isChild(ctx.proj);
    const sig = child ? JSON.stringify(SC.usedFrom(piecesIn(ctx))) : '';
    useEffect(() => {
      if (!child) return;
      const used = JSON.parse(sig);
      if (!used.length || SC.sameUsed(ctx.proj, used)) return;
      app.patchProject(ctx.proj.id, {used});
    }, [sig]);
  }

  /** 一次批量编辑：片段、别的元素、字幕一起动，撤销栈里只记一条。 */
  function applyInsert(ctx, {patches, range, at, tag, add}) {
    const sentences = D.sourceCues(ctx.proj, ctx.app.projects);
    const d = range.out - range.in;
    const merged = ctx.elements.map((e) => Object.assign({}, e, ctx.elDocs[e.id]));
    const skip = patches.map((x) => x.id);
    ctx.history.begin();
    SC.ripplePatches(merged, at, d, skip).forEach((x) => ctx.setElDoc(x.id, {start: x.start, end: x.end}));
    patches.forEach((x) => ctx.setElDoc(x.id, {start: x.start, end: x.end, srcStart: x.in}));
    if (add) ctx.addElement(add, {quiet: true});
    ctx.setCues((cur) => SC.insertCues(cur, sentences, range, at, tag));
    ctx.history.commit(add ? 'shorts-add' : 'shorts-extend');
  }

  function PieceRow({row, ctx, locked, onExtend}) {
    return (
      <div className="ss-piece">
        <BCAction type="button" className="ss-piece__main" title="播放头跳到这一段" onClick={() => ctx.seek(row.at)}>
          <span className="ss-piece__n t-mono">{row.n}</span>
          <span className="ss-piece__t">
            <span className="t-mono">{row.span}</span>
            <span className="t-truncate">{row.hook}</span>
          </span>
        </BCAction>
        <div className="ss-piece__acts">
          <Btn size="s" variant="quiet" disabled={locked || !row.before} title={row.before ? row.before.sentence.text : '前面已经到原片开头'}
            onClick={() => onExtend(row, 'before')}>前面多留一句</Btn>
          <Btn size="s" variant="quiet" disabled={locked || !row.after} title={row.after ? row.after.sentence.text : '后面已经到原片结尾'}
            onClick={() => onExtend(row, 'after')}>后面多留一句</Btn>
        </div>
      </div>
    );
  }

  /** 视频 Tab 顶部的「原片」卡：这一支从哪儿来、用了原片的哪几段、还能从原片拿什么。 */
  function ShortsSourceCard({ctx}) {
    const app = useApp();
    const proj = ctx.proj;
    const [adding, setAdding] = useState(false);
    const origin = SC.originLabel(app.projects, proj);
    const sentences = useMemo(() => D.sourceCues(proj, app.projects), [proj.id, origin && origin.parent && origin.parent.id]);
    const pieces = piecesIn(ctx);
    const rows = SC.pieceRows(sentences, pieces);
    if (!origin) return null;
    const total = origin.parent ? origin.parent.duration : 0;
    const used = pieces.reduce((n, p) => n + (p.out - p.in), 0);
    const locked = origin.missing;

    const extend = (row, side) => {
      const piece = pieces.find((p) => p.id === row.id);
      const r = piece && SC.extendRange(sentences, piece, side);
      if (!r) return;
      applyInsert({...ctx, app}, {patches: SC.extendPatches(pieces, piece.id, side, r), range: r, at: r.at, tag: 'x' + ctx.nextSeq()});
      ctx.seek(side === 'before' ? r.at : Math.max(0, r.at - 0.5));
      app.toast(`${side === 'before' ? '前面' : '后面'}多留了一句 · 这一支现在 ${SC.secs(ctx.duration + r.out - r.in)}`, 'positive',
        {label: '撤销', undo: true, run: () => ctx.history.undo()});
    };

    return (
      <section className="ss-card" aria-label="原片">
        <div className="ss-card__hd">
          <span className="ss-card__t">
            <b>原片</b>
            <span className={cx('t-truncate', locked && 'is-missing')}>{origin.short}</span>
          </span>
          {locked ? null
            : <Btn size="s" variant="quiet" onClick={() => app.go({r: 'editor', id: origin.parent.id, t: proj.origin.in})}>打开来源视频</Btn>}
        </div>
        <div className="ss-meta t-truncate">
          {proj.src.name}{total ? ` · 全长 ${T.duration(total)}` : ''} · 用到 {SC.secs(used)}
        </div>
        {total ? (
          <div className="ss-bar" aria-hidden="true">
            {SC.bar(pieces.map((p) => ({start: p.in, end: p.out})), total).map((b, i) => (
              <i key={i} style={{left: b.left + '%', width: b.width + '%'}} />
            ))}
          </div>
        ) : null}
        <div className="ss-head"><b>用到的片段</b><span>{pieces.length} 段</span></div>
        <div className="ss-list bc-scroll">
          {rows.map((row) => <PieceRow key={row.id} row={row} ctx={ctx} locked={locked} onExtend={extend} />)}
          {!rows.length ? <div className="ss-none">时间轴上没有原片的片段了。可以从原片再加一段。</div> : null}
        </div>
        {locked
          ? <div className="ss-none">来源视频不在视频库里，不能再从原片添加片段。已有的片段照常编辑和导出。</div>
          : <Btn size="s" variant="secondary" icon="plus" onClick={() => setAdding(true)}>从原片再加一段…</Btn>}
        {adding ? ReactDOM.createPortal(
          <window.ShortsAddDialog ctx={ctx} pieces={pieces} sentences={sentences} parent={origin.parent}
            onClose={() => setAdding(false)}
            onAdd={(sel, where) => {
              const at = SC.insertPoint(pieces, where, ctx.playT);
              const d = +(sel.out - sel.in).toFixed(2);
              const id = 'video-x' + ctx.nextSeq();
              const base = window.BC_VIDEO_EDIT.initial([{id: id.slice(6), start: at, end: +(at + d).toFixed(2), src: sel.in}], proj.src.name)[0];
              const like = ctx.elements.find((e) => e.kind === 'video' && e.fromSource);
              const add = Object.assign({}, base, like ? {place: like.place, style: like.style} : null, {id, name: proj.src.name});
              applyInsert({...ctx, app}, {patches: SC.shiftPatches(pieces, at, d), range: {in: sel.in, out: sel.out}, at, tag: id.slice(6), add});
              setAdding(false);
              ctx.seek(at);
              app.toast(`已从原片加了一段 · ${SC.spanText(sel)} · 放在 ${SC.mmss(at)}`, 'positive',
                {label: '撤销', undo: true, run: () => ctx.history.undo()});
            }} />, document.body) : null}
      </section>
    );
  }

  /* 「切出的短视频」里的一行：点行打开那一支；⋯ 里是在原片里看这一段、调整后再生成、在项目页里看。 */
  function MadeRow({row, child, ctx, menuOpen, onMenu, onHot}) {
    const app = useApp();
    const S = window.BC_SURFACE;
    const close = () => onMenu(null);
    return (
      <div className="sm-row" onMouseEnter={() => onHot(row.id)} onMouseLeave={() => onHot(null)}>
        <BCAction type="button" className="sm-row__main" title={`打开「${row.title}」`}
          onFocus={() => onHot(row.id)} onBlur={() => onHot(null)} onClick={() => app.go({r: 'editor', id: row.id})}>
          <span className="sm-thumb" aria-hidden="true"><Ic n="play" className="ic--12" /></span>
          <span className="sm-row__t">
            <b className="t-truncate">{row.title}</b>
            <span className="t-mono t-truncate">{row.span} · <span className={cx(row.over && 'is-over')}>{row.len}</span></span>
            <span className="t-truncate">{[row.cut, row.edited ? '剪过' : '', row.modified ? row.modified + '编辑' : ''].filter(Boolean).join(' · ')}</span>
          </span>
        </BCAction>
        <div className="sm-row__menu">
          <IconBtn icon="more" size="s" tip="这一支" on={menuOpen} onClick={() => onMenu(menuOpen ? null : row.id)} />
          <Popover open={menuOpen} onClose={close} align="right" dir="down" width={240}>
            <Menu>
              <MenuItem icon="clip" label="打开这一支" sub="接着剪、改字幕、导出" onClick={() => { close(); app.go({r: 'editor', id: row.id}); }} />
              <MenuItem icon="play" label="在原片里看这一段" sub={`播放头跳到 ${SC.mmss(row.at)}`} onClick={() => { close(); ctx.seek(row.at); }} />
              {S.ai ? (
                <>
                  <MenuRule />
                  <MenuItem icon="redo" label="调整后再生成…" sub="带着它的起止和设置回到挑片段，另建一支" onClick={() => { close(); window.shortsCutRedo(app, ctx, child); }} />
                </>
              ) : null}
              {S.pages ? (
                <>
                  <MenuRule />
                  <MenuItem icon="asset" label="在 Space 里看" sub="改名、删除都在那里" onClick={() => { close(); app.go({r: 'projects', from: ctx.proj.id}); }} />
                </>
              ) : null}
            </Menu>
          </Popover>
        </div>
      </div>
    );
  }

  /** 来源项目视频 Tab 里的「切出的短视频」：从这个项目切出的那几支收成一组，可开合。
      行数没有上限（一条长播客可以切出几十支），组里一次露出几行，其余在组里滚，按行虚拟化。 */
  function ShortsMadeGroup({ctx}) {
    const app = useApp();
    const S = window.BC_SURFACE;
    const proj = ctx.proj;
    const kids = SC.childrenOf(app.projects, proj.id);
    const [open, setOpen] = useState(true);
    const [menu, setMenu] = useState(null);
    const [hot, setHot] = useState(null);
    const [top, setTop] = useState(0);
    const list = useRef(null);
    useEffect(() => { setMenu(null); setTop(0); if (list.current) list.current.scrollTop = 0; }, [proj.id, kids.length]);
    if (!kids.length) return null;
    const head = SC.madeHead(kids);
    const rows = SC.madeRows(kids);
    const height = Math.min(rows.length, SC.MADE_SHOWN) * SC.MADE_ROW_H;
    const win = SC.rowWindow(rows.length, top, height, SC.MADE_ROW_H);
    const session = S.ai ? app.shortsCut.sessions[proj.id] : null;
    const running = session && ['finding', 'review', 'creating'].indexOf(session.phase) >= 0;
    const toggle = () => { setMenu(null); setOpen((v) => !v); };
    return (
      <section className="sm-group" aria-label="切出的短视频">
        {/* 组头是 div 不是 button：右侧的「再切几支」本身是按钮 */}
        <div className="sm-hd" role="button" tabIndex={0} aria-expanded={open} onClick={toggle}
          onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(); } }}>
          <Ic n={open ? 'chevdown' : 'chevright'} className="ic--12" />
          <span className="sm-hd__t">
            <b>切出的短视频</b>
            <span className="t-truncate">{head.text}</span>
          </span>
          <BCAction className="sm-hd__act" onClick={(e) => e.stopPropagation()}>
            {S.ai ? <Btn size="s" variant="secondary" icon="plus" onClick={() => window.shortsCutMore(app, ctx)}>再切几支</Btn> : null}
            {S.pages ? <IconBtn icon="asset" size="s" tip="在 Space 里看这几支" onClick={() => app.go({r: 'projects', from: proj.id})} /> : null}
          </BCAction>
        </div>
        {open ? (
          <div className="sm-body">
            {running ? (
              <div className="sm-run">
                <span className="t-truncate">{window.shortsCutListStatus(app, proj.id, '')}</span>
                <Btn size="s" variant="quiet" onClick={() => window.shortsCutMore(app, ctx)}>去看</Btn>
              </div>
            ) : null}
            <div className="sm-src" title="这几支各用到原片的哪一段">
              <span>原片</span>
              <div className="ss-bar" aria-hidden="true">
                {SC.madeBar(kids, proj.duration).map((b, i) => (
                  <i key={i} className={cx(hot === b.id && 'is-hot')} style={{left: b.left + '%', width: b.width + '%'}} />
                ))}
              </div>
              <span className="t-mono">{SC.mmss(proj.duration)}</span>
            </div>
            <div ref={list} className="sm-list bc-scroll" style={{height}} aria-label="切出的短视频列表"
              onScroll={(e) => { setMenu(null); setTop(e.currentTarget.scrollTop); }}>
              <div className="sm-virtual" style={{height: win.height}}>
                {rows.slice(win.start, win.end).map((row, i) => (
                  <div className="sm-slot" key={row.id} style={{top: (win.start + i) * SC.MADE_ROW_H}}>
                    <MadeRow row={row} child={kids[win.start + i]} ctx={ctx} menuOpen={menu === row.id} onMenu={setMenu} onHot={setHot} />
                  </div>
                ))}
              </div>
            </div>
            <div className="sm-foot">每支是一部单独的视频，引用同一份原片。点一支打开它，在那里接着剪。</div>
          </div>
        ) : null}
      </section>
    );
  }

  Object.assign(window, {ShortsOriginBadge, ShortsCountBadge, ShortsSourceCard, ShortsMadeGroup, shortsSideNote, useShortsUsed});
})();
