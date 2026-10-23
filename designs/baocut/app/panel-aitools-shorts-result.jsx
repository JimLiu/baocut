/* 剪成短视频（product-design §5.10）结果页：找到就已经创建好了，这一页是看结果、收拾结果的地方——
   每支一张卡：标题（点一下改名）、在原片里的起止与时长、开头那一句、为什么挑它、提醒。
   点卡片就在同一个编辑器里打开那一支（结果页还在右边、这张卡亮着），头上「第 k/N ‹ ›」逐支翻。
   起止在文稿里调：那一支打开后就是普通的视频编辑（§4.6）——片段外的话在文稿里划掉，点一下恢复，再剪就是普通的剪；
   「正在看」那张卡的「调起止」与子视频横幅的「去文稿调整」直接把人带到文稿里片段前面那条剪缝。
   「不要这支」移入回收站（toast 里可撤销）。这一页属于那一轮会话，挂在来源视频上：
   从来源视频、任何一支子视频、会话里那支视频的卡片都回到这里。 */
(function () {
  const {useState, useEffect} = React;
  const SC = window.BC_SHORTS_CUT;
  const {TOOLS} = window.BC_AIFLOWS;
  const NAME = TOOLS.shortscut.name;

  /* 版式条（docs/design/shorts-framing §8.2）：按这一支的时长排开一人段与分屏段，分屏段标格数；点一段把播放头移到那一段开头，
     这一支没在看时先打开它。 */
  function LayoutStrip({strip, onPick}) {
    return (
      <>
        <div className="sc-strip" role="list" aria-label="版式">
          {strip.map((g, i) => (
            <Tip key={i} label={g.label} side="bottom">
              <BCAction type="button" role="listitem" className={cx('sc-strip__seg', g.n > 1 && 'is-split')} style={{flexGrow: g.len}}
                aria-label={g.label} onClick={(e) => { e.stopPropagation(); onPick(g); }}>{g.n > 1 ? g.n : null}</BCAction>
            </Tip>
          ))}
        </div>
        <div className="sc-strip-key"><span><i />一人</span><span><i className="is-split" />分屏（数字是格数）</span></div>
      </>
    );
  }

  function MadeCard({c, n, s, host, flags, cur, onOpen, onTrim, onSeek}) {
    const app = useApp();
    const api = app.shortsCut;
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(c.title);
    const cut = (app.projById(c.id) || {}).cut;
    const shots = SC.shotsOf(cut).length;
    const strip = SC.layoutStrip(cut, c);
    const commit = () => { setEditing(false); const t = draft.trim(); if (t && t !== c.title) api.edit(host, c.id, {title: t}); else setDraft(c.title); };
    return (
      <div className={cx('sc-card', cur && 'is-sel')} onClick={() => onOpen(c.id)} aria-current={cur ? 'true' : undefined}>
        <div className="sc-card__head">
          <span className="sc-card__n t-mono">{n}</span>
          {editing
            ? <Field size="s" className="sc-card__edit" value={draft} autoFocus aria-label="短视频标题" onChange={(e) => setDraft(e.target.value)} onBlur={commit}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(c.title); setEditing(false); } }} />
            : <BCAction type="button" className="sc-card__title t-truncate" title="点一下改标题"
                onClick={(e) => { e.stopPropagation(); setDraft(c.title); setEditing(true); }}>{c.title}</BCAction>}
          {cur ? <Chip tone="accent">正在看</Chip> : null}
        </div>
        <div className="sc-card__span t-mono">{SC.spanText(c)}{c.added === 'redo' ? ' · 重做' : ''}</div>
        <div className="sc-quote"><em>开头</em><span>{SC.hookOf(s.sentences, c)}</span></div>
        {c.reason ? <div className="sc-why"><em>为什么挑它</em><span>{c.reason}</span></div> : null}
        {/* 取景：分了镜头的写「按 N 个镜头分别取景」（每个镜头裁到谁写在 agent 的说明里）；只有一个位置的照旧只在「我自己定」时说 */}
        {shots > 1 || (s.params.focus === 'manual' && s.params.ratio !== 'source')
          ? <div className="sc-why"><em>取景</em><span>{SC.frameText(cut, c.focusX)}</span></div> : null}
        {strip ? <LayoutStrip strip={strip} onPick={(g) => (cur && onSeek ? onSeek(g.start) : onOpen(c.id))} /> : null}
        {flags.length ? (
          <div className="sc-flags">{flags.map((f, i) => <Chip key={f.k + i} tone={f.tone}>{f.text}</Chip>)}</div>
        ) : null}
        <div className="sc-acts" onClick={(e) => e.stopPropagation()}>
          <span className="grow" />
          {/* 「正在看」那一支：起止在文稿里调（§4.6），这里只给入口；其他卡点开就是看 */}
          {cur && onTrim ? <Btn size="s" variant="secondary" title={SC.CUT_ENTRY_COPY.trimTip} onClick={onTrim}>{SC.CUT_ENTRY_COPY.trim}</Btn> : null}
          <Btn size="s" variant="quiet" onClick={() => api.remove(host, c.id)}>不要这支</Btn>
        </div>
      </div>
    );
  }

  function ShortsCutResult({ctx, s, host, onBack}) {
    const app = useApp();
    const api = app.shortsCut;
    const hostId = host ? host.id : ctx.proj.id;
    const hostTitle = host ? host.title : ctx.proj.title;
    const inChild = ctx.proj.id !== hostId;
    /* 从任务页回来时会话里还没有文稿：用这部视频的文稿把那几支的句子边界补上（子视频与来源视频共用文稿） */
    useEffect(() => {
      if ((!s.sentences || !s.sentences.length) && ctx.cues.length && s.taskId) api.showTask(hostId, s.taskId, ctx.cues);
    }, [s.sentences, ctx.cues.length, s.taskId]);
    /* 结果页上的几支以项目库为准：在 Space 里移入回收站的，这里也撤下；在别处改了名的，跟着改；
       打开后放回了片段外的话，起止与开头那一句跟着那一支现在的剪口走（usedRanges 从剪口派生） */
    const sents = s.sentences || [];
    const now = (c, p) => {
      const u = SC.usedRanges(p);
      if (!u.length || (u[0].start === c.start && u[u.length - 1].end === c.end)) return c;
      const from = sents.findIndex((x) => x.end > u[0].start + 0.02);
      return {...c, start: u[0].start, end: u[u.length - 1].end, from: from < 0 ? c.from : from};
    };
    const live = SC.visible(s.list).map((c) => ({c, p: app.projById(c.id)})).filter((x) => x.p && !x.p.archived)
      .map((x) => now(x.p.title !== x.c.title ? {...x.c, title: x.p.title} : x.c, x.p));
    const mine = new Set(s.list.map((c) => c.id));
    const kids = SC.childrenOf(app.projects, hostId).filter((k) => !mine.has(k.id));
    const fctx = {params: s.params, list: live, children: kids, sentences: s.sentences || []};
    /* 「正在看」：在子视频里就是这一支；在来源视频里是上次选中的那一支（‹ › 从它起） */
    const at = Math.max(0, live.findIndex((c) => c.id === (inChild ? ctx.proj.id : s.sel)));
    const openChild = (id) => {
      api.select(hostId, id);
      if (id !== ctx.proj.id) app.go({r: 'editor', id, tab: 'aitools'});
    };
    const step = (d) => { const next = live[at + d]; if (next) openChild(next.id); };
    /* 「全部导出…」：每支各建一条导出任务（同导出弹层的 startVideo，缺省设置），进度在后台任务里；
       建不了的那一支跳过，提示里说明（product-design §5.10）。 */
    const X = window.BC_EXPORT;
    const E = SC.EXPORT_COPY;
    const exportAll = () => {
      if (!live.length) return;
      const {run, skipped} = SC.exportBatch(live.map((c) => app.projById(c.id)));
      run.forEach(({project: p, seconds}) => {
        const est = X.estimate(1080, p.ratio, seconds);
        const base = String(p.title).replace(/[\\/:*?"<>|]/g, '_');
        app.addTask({kind: 'export', exportTab: 'video', project: p.id, title: '导出 · ' + p.title,
          sub: ['mp4', est.dims.w + '×' + est.dims.h, '字幕烧入'].join(' · '),
          phase: '读取视频', cancellable: true, source: 'app', preparePhase: 'prepare-project', prepareElapsedMs: 0,
          fontsWait: [], fontPins: [], fontFallbacks: [], etaMs: est.ms, frames: est.frames, file: base + '.mp4', size: est.size});
      });
      const note = SC.exportNotes(run.length, skipped);
      if (note.started) app.toast(note.started, 'positive', {label: '看任务', run: () => app.go({r: 'tasks'})});
      if (note.skipped) app.toast(note.skipped, 'negative');
    };
    /* 「返回」：在来源视频里回参数页（设置与提示词保留）；在子视频里回来源视频，结果页仍在那里 */
    const back = inChild ? () => app.go({r: 'editor', id: hostId, tab: 'aitools'}) : onBack;
    if (!s.sentences || !s.sentences.length) return <div className="pscroll bc-scroll"><div className="flowh"><IconBtn icon="back" size="s" tip="返回" onClick={back} /><b>{NAME}</b></div></div>;

    return (
      <div className="pscroll bc-scroll">
        <div className="flowh"><IconBtn icon="back" size="s" tip={inChild ? `回到「${hostTitle}」` : '返回'} onClick={back} /><b>{NAME}</b>
          <Chip tone="positive">{`已创建 ${live.length} 支`}</Chip>
          {live.length ? (
            <span className="sc-pager">
              <span className="t-mono">{`第 ${at + 1}/${live.length}`}</span>
              <IconBtn icon="chevleft" size="s" tip="上一支" disabled={at <= 0} onClick={() => step(-1)} />
              <IconBtn icon="chevright" size="s" tip="下一支" disabled={at >= live.length - 1} onClick={() => step(1)} />
            </span>
          ) : null}
        </div>
        <div className="aicard">
          <b>{SC.resultHead(live)}</b>
          <span>{`${SC.summaryLine(s.params)}。点一支就在这里打开它：片段外的话在文稿里划掉了，点一下可以恢复；标题可以改。`}</span>
        </div>

        <div className="sc-list">
          {live.map((c, i) => <MadeCard key={c.id} c={c} n={i + 1} s={s} host={hostId} flags={SC.flags(c, fctx)}
            cur={inChild ? c.id === ctx.proj.id : false} onOpen={openChild} onTrim={ctx.openCutEntry}
            onSeek={inChild ? (t) => ctx.seek(ctx.tmap ? ctx.tmap.fold(t) : t) : null} />)}
          {!live.length ? <div className="hint">这几支都移入回收站了。可以在 Space 的回收站里恢复，或者再切几支。</div> : null}
        </div>

        <SecHead>接下来</SecHead>
        <div className="sec cr-next">
          <BCAction className="drill" onClick={() => { api.again(hostId); if (inChild) app.go({r: 'editor', id: hostId, tab: 'aitools'}); }}>
            <span className="ic2"><Ic n="split" className="ic--16" /></span>
            <span className="tt"><b>再切几支</b><span>回到设置，已经切过的不再找</span></span>
            <NavChevron style={{color: 'var(--gray-500)'}} />
          </BCAction>
          <BCAction className="drill" onClick={() => app.go({r: 'projects', from: hostId})}>
            <span className="ic2"><Ic n="folder" className="ic--16" /></span>
            <span className="tt"><b>在 Space 里看这几支</b><span>{`按来源筛好 ·「${hostTitle}」切出的短视频`}</span></span>
            <NavChevron style={{color: 'var(--gray-500)'}} />
          </BCAction>
          {live.length ? (
            <BCAction className="drill" onClick={exportAll}>
              <span className="ic2"><Ic n="export" className="ic--16" /></span>
              <span className="tt"><b>{E.exportAll}</b><span>{E.exportAllSub(live.length)}</span></span>
              <NavChevron style={{color: 'var(--gray-500)'}} />
            </BCAction>
          ) : null}
        </div>
        <div className="hint">每支是一部单独的视频，引用同一份原片与文稿。不要哪一支移入回收站即可，可恢复。</div>
      </div>
    );
  }

  Object.assign(window, {ShortsCutResult});
})();
