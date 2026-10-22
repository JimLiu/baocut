/* 审片视图侧栏的三页（docs/design/lite-editor §3「侧栏」的扩展，待确认的方案）：
   - 台词：原来的侧栏（editor-lite.jsx 的 LiteSide，当前段的头、脚本、逐句、素材），作为 `lines` 传进来；
   - 脚本：做这部视频时写下的那份脚本（视频里有 `kind: 'script'` 的文档才出这一页），整份 Markdown 只读，
     正在播的那一段对得上的小节标出来并滚进视野；「脚本版本」列出这份文档的每一版，可以看改了什么、回到某一版；
   - 字幕样式：与时间线视图字幕面板同一套样式页（panel-substyle.jsx 的画廊 → 属性 → 动画），在侧栏里推进来，返回回到原来那页。
   规则与演示数据的形状在 model-lite-script.js。回到版本加出来的几版按视频存在模块里（切视图、收侧栏都还在），不写 data.js。 */
(function () {
  const {useState, useEffect, useReducer, useRef} = React;
  const S = window.BC_LITE_SCRIPT;
  const SURF = window.BC_SURFACE;

  /* ---------- 每部视频一份「回到版本加出来的几版」（组件卸载也留着） ---------- */
  const cache = {};
  const subs = new Set();
  function useScriptExtra(projId) {
    const [, bump] = useReducer(x => x + 1, 0);
    useEffect(() => { subs.add(bump); return () => { subs.delete(bump); }; }, []);
    const put = next => { cache[projId] = next; subs.forEach(f => f()); };
    return [cache[projId] || [], put];
  }

  const clock = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const CHANGE_TAG = {added: '新加', changed: '改过', removed: '删掉'};

  /* 一块脚本：App 入口按回复正文渲染（AgentMarkdown），Web 入口没有 Markdown 渲染，退成去掉记号的段落（与 editor-lite.jsx 的 ScriptBody 同一套退法） */
  function Block({text}) {
    if (window.AgentMarkdown) return <window.AgentMarkdown text={text} streaming={false} />;
    const t = String(text || '').replace(/^#+\s*/, '').replace(/\*\*/g, '').replace(/^- /gm, '· ').replace(/^> ?/gm, '').trim();
    return /^#/.test(text) ? <h3>{t}</h3> : <p className="lt-sp__plain">{t}</p>;
  }

  /** 脚本页：头上一行说这是哪一版、谁什么时候写的，「脚本版本」打开版本页（不叫「版本记录」：顶栏那个是整部视频的）；正文整份只读。 */
  function ScriptPane({proj, seg, onVersions}) {
    const [extra] = useScriptExtra(proj.id);
    const rows = S.rows(proj.script, extra);
    const top = rows[0];
    const md = S.current(proj.script, extra);
    const blocks = S.blocks(md);
    const at = S.sectionFor(blocks, seg);
    const bodyRef = useRef(null);
    /* 换段时把这一段的小节滚到顶上（用户手动滚开以后，下一次换段才再滚） */
    useEffect(() => { bodyRef.current?.querySelector('.is-here')?.scrollIntoView({block: 'start'}); }, [at]);
    let inHere = false;
    return <div className="lt-sp">
      <div className="lt-sp__meta">
        <span className="t-detail t-truncate">{proj.script.file ? `${proj.script.file} · ` : ''}版本 {top.n} · {top.sub}</span>
        <window.RSP.ActionButton size="S" isQuiet onPress={onVersions}><window.RSP.Icons.History /><window.RSP.Text>脚本版本 · {rows.length}</window.RSP.Text></window.RSP.ActionButton>
      </div>
      <div className="lt-sp__body lt-script bc-scroll" ref={bodyRef}>
        {blocks.map((b, i) => {
          if (b.heading) inHere = i === at;
          return <div key={i} className={cx('lt-sp__blk', b.heading && 'is-h', i === at && 'is-here', inHere && 'is-in')}>
            {i === at ? <span className="lt-sp__here t-detail">正在播放</span> : null}
            <Block text={b.text} />
          </div>;
        })}
        <p className="lt-script__hint t-detail">{SURF.agent ? '改脚本在会话里说，智能体每改一次记成一个新版本；这里只读' : '脚本在这里只读；每改一次记成一个新版本'}</p>
      </div>
    </div>;
  }

  /** 版本页：上面是版本列表（新的在前），选一版，下面是那一版的正文，可以标出和前一版比改了哪几块；「回到这个版本」把脚本换回去、记成新的一版。 */
  function ScriptVersions({proj, onBack}) {
    const app = useApp();
    const R = window.RSP;
    const [extra, put] = useScriptExtra(proj.id);
    const rows = S.rows(proj.script, extra);
    const [sel, setSel] = useState(rows[0].n);
    const [marks, setMarks] = useState(true);
    const d = S.detail(proj.script, extra, sel) || S.detail(proj.script, extra, rows[0].n);
    const items = marks && !d.first ? d.changes : d.changes.filter(x => x.status !== 'removed');
    const restore = () => app.confirm({
      title: `回到版本 ${d.n}？`,
      body: `脚本换成版本 ${d.n}（${d.when}）的内容，单独记成一个新版本；现有的版本都还在，随时可以再回去。只换脚本：画面、旁白与字幕不跟着变，要重做哪一段在会话里说。`,
      confirmLabel: '回到这个版本',
      run: () => {
        const r = S.restore(proj.script, extra, d.n, clock());
        if (r.error) { app.toast(r.error, 'negative'); return; }
        if (r.noop) { app.toast(`脚本现在就是版本 ${d.n} 的正文，没有改动`); return; }
        put(r.extra);
        setSel(r.version);
        app.toast(`已回到版本 ${d.n}，记成版本 ${r.version}`, 'positive');
      },
    });
    return <div className="pview">
      <window.PanelHead title="脚本的版本" onBack={onBack} backTip="返回脚本" aside={`${rows.length} 个`} />
      <div className="lt-sv__list">
        <R.GridList aria-label="脚本的版本" items={rows.map(r => ({id: r.n, ...r}))} selectionMode="single" disallowEmptySelection
          selectedKeys={[d.n]} dependencies={[extra]}
          onSelectionChange={keys => { const k = [...keys][0]; if (k != null) setSel(Number(k)); }}>
          {r => <R.GridListItem id={r.id} textValue={`版本 ${r.n} ${r.title}`} className={cx('vh-row', `is-${r.kind}`)}>
            <span className="vh-row__icon">{r.kind === 'restore' ? <R.Icons.Revert /> : r.kind === 'create' ? <R.Icons.FileText /> : <R.Icons.Edit />}</span>
            <span className="vh-row__body">
              <span className="vh-row__t">{r.title}</span>
              <span className="vh-row__d">{`版本 ${r.n} · ${r.sub}`}</span>
            </span>
            {r.latest ? <R.Badge variant="informative" size="S">现在</R.Badge> : null}
          </R.GridListItem>}
        </R.GridList>
      </div>
      <div className="lt-sv__bar">
        <R.ToggleButton size="S" isSelected={marks && !d.first} isDisabled={d.first} onChange={setMarks}>
          <R.Icons.Compare /><R.Text>{d.first ? '第一版' : `显示改动 · ${S.changeCount(d.changes)} 处`}</R.Text>
        </R.ToggleButton>
        <span className="grow" />
        <R.Button variant="secondary" size="S" isDisabled={!d.canRestore} onPress={restore}><R.Icons.Revert /><R.Text>回到这个版本</R.Text></R.Button>
      </div>
      {d.why ? <p className="lt-sv__why t-detail">{d.why}</p> : null}
      <article className="lt-sv__page lt-script bc-scroll" aria-label={`脚本 · 版本 ${d.n}`}>
        {items.map((x, i) => {
          const on = marks && !d.first && x.status !== 'same';
          return <div key={`${i}:${x.status}`} className={cx('lt-sp__blk', x.heading && 'is-h', on && `is-${x.status}`)}>
            {on ? <span className="lt-sv__tag t-detail">{CHANGE_TAG[x.status]}</span> : null}
            <Block text={x.text} />
          </div>;
        })}
      </article>
    </div>;
  }

  /** 字幕样式：时间线视图字幕面板的同一套样式页。页的栈（画廊 / 属性 / 动画）记在这里，不写编辑器的 paneView——
      那一格是时间线视图右栏推进到哪一层，两边各推各的，切过去不会把对方的面板也带进样式页。 */
  function CaptionStyle({ctx, view, setView, backLabel}) {
    const st = ctx.subStyle;
    const SUB = window.BC_SUB;
    const src = SUB.source(st) || SUB.tracks(st)[0] || {};
    const selId = ctx.sel && ctx.sel.trackId;
    const editId = SUB.byId(st, selId) ? selId : src.id;
    const ops = window.useSubTrackOps(ctx, editId);
    const local = {...ctx, paneView: view, setPaneView: v => setView(v && /^sub(gallery|props|anim)$/.test(v) ? v : null)};
    return <div className="pview">
      <window.SubStyleTab ctx={local} ops={ops} editId={editId} backLabel={backLabel} />
      {ops.dialog}
    </div>;
  }

  /** 侧栏：顶上一行是「台词 / 脚本」（视频里有脚本才出）与「字幕样式」，下面换页。 */
  /* 侧栏顶上的运行态头（docs/design/lite-editor §3.3）：这部视频正在转录、正在翻译时各一块，与时间线视图的文稿 / 字幕面板
     同一套 LiveHead / TransRunHead（进度、阶梯、取消）。完成后台词按句出现、译文挂在每句原文下面；没有在跑的不占地方。 */
  function LiteJobHeads({ctx}) {
    const D = window.BC_DATA;
    const live = ctx.liveJob && ctx.liveJob.status === 'running' ? ctx.liveJob : null;
    const run = ctx.transJob;
    if (!live && !run) return null;
    const lang = run && run.target ? (D.transLangs.find((l) => l.code === run.target) || {code: run.target, name: run.target}) : null;
    const slice = run ? window.BC_TRUN.runSlice(D.translate.live, run.pct, run.status === 'queued') : null;
    return <div className="lt-side__jobs">
      {live ? <window.LiveHead job={live} dur={D.DUR} onCancel={ctx.cancelLive} /> : null}
      {run ? <window.TransRunHead job={run} lang={lang} slice={slice} onCancel={ctx.cancelTrans} /> : null}
    </div>;
  }

  function LiteSidePane({ctx, seg, lines}) {
    const R = window.RSP;
    const proj = ctx.proj;
    const hasScript = !!(proj.script && proj.script.versions && proj.script.versions.length);
    const [tab, setTab] = useState('lines');
    const [versions, setVersions] = useState(false);
    const [style, setStyle] = useState(null);   // 字幕样式推进到哪一层：subprops / subgallery / subanim；null = 没打开
    const page = !hasScript ? 'lines' : tab;
    useEffect(() => { setVersions(false); setStyle(null); }, [proj.id]);
    if (style) return <CaptionStyle ctx={ctx} view={style} setView={setStyle} backLabel={page === 'script' ? '脚本' : '台词'} />;
    if (page === 'script' && versions) return <ScriptVersions proj={proj} onBack={() => setVersions(false)} />;
    const canStyle = ctx.cues.length > 0 && ctx.subsOn;
    const styleBtn = <Tip label={canStyle ? '改字幕的样式，与时间线视图的字幕面板同一套' : ctx.cues.length ? '字幕关着，打开后才能改样式' : '这部视频还没有字幕'}>
      <R.ActionButton size="S" isQuiet isDisabled={!canStyle} onPress={() => setStyle('subprops')}>
        <Ic n="captions" className="ic--16" /><R.Text>字幕样式</R.Text>
      </R.ActionButton>
    </Tip>;
    const jobs = <LiteJobHeads ctx={ctx} />;
    if (!hasScript) return <div className="pview">
      <div className="lt-side__top"><span className="t-title-sm">台词</span><span className="grow" />{styleBtn}</div>
      {jobs}
      {lines}
    </div>;
    /* 有脚本：「台词 / 脚本」是 S2 Tabs（两页并列的内容，不是同一份内容的两种显示），「字幕样式」挂在标签行右端 */
    return <R.Tabs aria-label="侧栏" selectedKey={page} onSelectionChange={k => setTab(String(k))} UNSAFE_className="pview lt-side__tabs">
      <div className="lt-side__top lt-side__top--tabs">
        <R.TabList aria-label="侧栏"><R.Tab id="lines">台词</R.Tab><R.Tab id="script">脚本</R.Tab></R.TabList>
        <span className="grow" />
        {styleBtn}
      </div>
      {jobs}
      <R.TabPanel id="lines" UNSAFE_className="lt-side__panel">{page === 'lines' ? lines : null}</R.TabPanel>
      <R.TabPanel id="script" UNSAFE_className="lt-side__panel">{page === 'script' ? <ScriptPane proj={proj} seg={seg} onVersions={() => setVersions(true)} /> : null}</R.TabPanel>
    </R.Tabs>;
  }

  Object.assign(window, {LiteSidePane});
})();
