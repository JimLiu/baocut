/* 剪成短视频（§15.12）挑片段页：找出来的只是候选，这一页是人拿主意的地方——
   勾哪几段、标题叫什么、起止落在哪一句、自己再加一段、让它再找几段。确认了才创建项目。
   取景和字幕用于预览和创建、不管找片段，所以这一页也能改；从视频 Tab「调整后再生成」进来的那一支
   跳过了设置页，要改就在这里改。缺本机模型时门在主按钮上（下载并创建）。
   预览在中央舞台（stage-shorts-cut.jsx），两边共用会话里的「选中哪一段」与播放头。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const SC = window.BC_SHORTS_CUT;
  const C = window.BC_CROP;
  const {TOOLS} = window.BC_AIFLOWS;
  const NAME = TOOLS.shortscut.name;

  /* 起点 / 终点各一行：那一句的文字 + 往前 / 往后挪一句。 */
  function EdgeRow({edge, c, s, onNudge, onSet}) {
    const start = edge === 'start';
    const line = s.sentences[start ? c.from : c.to] || {};
    const loose = c.loose && c.loose[edge];
    const value = start ? c.start : c.end;
    const [draft, setDraft] = useState(window.BC_TIME.timecode(value));
    const skip = useRef(false);
    useEffect(()=>setDraft(window.BC_TIME.timecode(value)),[value]);
    return (
      <div className="sc-adj__row">
        <span className="sc-adj__lb">{start ? '起点' : '终点'}
          <Field size="s" className="sc-bound-input" value={draft} aria-label={start ? '起点时间' : '终点时间'} onChange={e=>setDraft(e.target.value)}
            onBlur={()=>{if(skip.current) skip.current=false; else if(draft!==window.BC_TIME.timecode(value)) onSet(edge,draft);setDraft(window.BC_TIME.timecode(value));}}
            onKeyDown={e=>{if(e.key==='Enter') e.currentTarget.blur(); if(e.key==='Escape'){skip.current=true;setDraft(window.BC_TIME.timecode(value));e.currentTarget.blur();}}} />
        </span>
        <span className={cx('sc-adj__tx', loose && 'is-loose')} title={line.text}>{line.text}</span>
        <span className="sc-adj__bt">
          <Btn size="s" variant="secondary" disabled={!SC.canNudge(s.sentences, c, edge, -1)} onClick={() => onNudge(edge, -1)}>
            {start ? '从上一句开始' : '到上一句结束'}</Btn>
          <Btn size="s" variant="secondary" disabled={!SC.canNudge(s.sentences, c, edge, 1)} onClick={() => onNudge(edge, 1)}>
            {start ? '从下一句开始' : '到下一句结束'}</Btn>
        </span>
      </div>
    );
  }

  function Candidate({c, n, s, proj, flags, duration}) {
    const app = useApp();
    const api = app.shortsCut;
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(c.title);
    const sel = s.sel === c.id;
    const open = s.expand === c.id;
    const commit = () => { setEditing(false); const t = draft.trim(); if (t && t !== c.title) api.edit(proj, c.id, {title: t}); else setDraft(c.title); };
    const preview = () => { api.select(proj, c.id); api.set(proj, {t: c.start, playing: true}); };
    return (
      <div className={cx('sc-card', sel && 'is-sel', !c.on && 'is-off')} onClick={() => api.select(proj, c.id, {keepT: true})}>
        <div className="sc-card__head">
          <span onClick={(e) => e.stopPropagation()}>
            <Checkbox on={c.on} onChange={(v) => api.edit(proj, c.id, {on: v})} />
          </span>
          <span className="sc-card__n t-mono">{n}</span>
          {editing
            ? <Field size="s" className="sc-card__edit" value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} onBlur={commit}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(c.title); setEditing(false); } }} />
            : <BCAction type="button" className="sc-card__title t-truncate" title="点一下改标题"
                onClick={(e) => { e.stopPropagation(); setDraft(c.title); setEditing(true); }}>{c.title}</BCAction>}
        </div>
        <div className="sc-card__span t-mono">{SC.spanText(c)}{c.added === 'manual' ? ' · 你加的' : c.added === 'more' ? ' · 后找的' : c.added === 'redo' ? ' · 重做' : ''}</div>
        {open ? (
          <div className="sc-adj" onClick={(e) => e.stopPropagation()}>
            <EdgeRow edge="start" c={c} s={s} onNudge={(e, d) => api.nudge(proj, c.id, e, d)} onSet={(e,raw)=>api.setBound(proj,c.id,e,raw,duration)} />
            <EdgeRow edge="end" c={c} s={s} onNudge={(e, d) => api.nudge(proj, c.id, e, d)} onSet={(e,raw)=>api.setBound(proj,c.id,e,raw,duration)} />
            <div className="sc-adj__tip">可直接输入时间。按钮每次挪一句；范围调整可以撤销。</div>
          </div>
        ) : null}
        <div className="sc-quote"><em>开头</em><span>{SC.hookOf(s.sentences, c)}</span></div>
        <div className="sc-why"><em>为什么挑它</em><span>{c.reason}</span></div>
        {s.params.focus === 'manual' ? <div className="sc-why"><em>取景</em><span>{SC.focusText(c.focusX)} · 在左边原片上拖取景框改</span></div> : null}
        {flags.length ? (
          <div className="sc-flags">{flags.map((f, i) => <Chip key={f.k + i} tone={f.tone}>{f.text}</Chip>)}</div>
        ) : null}
        <div className="sc-acts" onClick={(e) => e.stopPropagation()}>
          <Btn size="s" variant="secondary" icon="play" onClick={preview}>试看</Btn>
          <Btn size="s" variant={open ? 'primary' : 'secondary'} onClick={() => { api.select(proj, c.id, {keepT: true}); api.set(proj, {expand: open ? null : c.id}); }}>调起止</Btn>
          <span className="grow" />
          <Btn size="s" variant="quiet" onClick={() => api.edit(proj, c.id, {removed: true, on: false})}>不要这段</Btn>
        </div>

      </div>
    );
  }

  function ShortsCutPick({ctx, s, onBack}) {
    const app = useApp();
    const api = app.shortsCut;
    const proj = ctx.proj.id;
    const kids = SC.childrenOf(app.projects, proj);
    const list = SC.visible(s.list);
    const gone = s.list.filter((c) => c.removed);
    const on = SC.chosen(s.list);
    const [note, setNote] = useState('');
    const [showGone, setShowGone] = useState(false);
    const [miss, setMiss] = useState(false);
    const [pending, setPending] = useState(false);
    const lead = SC.pickLead(s.list, s.preselected);
    const p = s.params;
    const ready = window.shortsCutFocusReady(p.focus, app.modelInstalled);
    const missingMb = ready.missing.reduce((a, m) => a + window.shortsCutModelSize(m.id), 0);
    const downloading = ready.missing.some((m) => app.modelDl[m.id] != null);
    const fctx = {params: s.params, list, children: kids, sentences: s.sentences};
    const speakers = new Set(s.sentences.map((c) => c.sp).filter((x) => x != null)).size || 1;

    const more = () => {
      const n = api.more(proj, note.trim());
      setMiss(!n);
      if (n) { setNote(''); app.toast(`又找到 ${n} 段 · 接在列表里，还没勾`, 'positive'); }
    };
    const addOwn = () => {
      const c = api.addManual(proj, {t: s.t});
      if (c) app.toast(`已加一段 · 从 ${SC.mmss(c.start)} 起 ${SC.secs(c.end - c.start)}`, 'positive');
    };
    const create = () => api.create(proj, {speakers});
    const start = () => {
      if (ready.ok) { create(); return; }
      ready.missing.forEach((m) => app.downloadModel(m.id));
      setPending(true);
    };
    useEffect(() => { if (pending && ready.ok) { setPending(false); create(); } }, [pending, ready.ok]);
    const reset = () => app.confirm({
      title: '重新设置？', body: `回到设置页重新找。现在这 ${list.length} 段候选和你改过的标题、起止都会丢掉。`,
      tone: 'negative', confirmLabel: '重新设置', run: () => api.restart(proj),
    });

    return (
      <div className="pscroll bc-scroll">
        <div className="flowh"><IconBtn icon="back" size="s" tip="返回" onClick={onBack} /><b>{NAME}</b><Chip tone="notice">等你挑</Chip></div>
        <div className="aicard">
          <b>{lead.head}</b>
          <span>{lead.sub}</span>
        </div>

        <div className="sc-list">
          {list.map((c, i) => <Candidate key={c.id} c={c} n={i + 1} s={s} proj={proj} flags={SC.flags(c, fctx)} duration={ctx.duration} />)}
          {!list.length ? <div className="hint">候选都移走了。可以从下面放回，或者自己加一段。</div> : null}
        </div>

        {gone.length ? (
          <>
            <BCAction type="button" className="cr-more" onClick={() => setShowGone((v) => !v)} aria-expanded={showGone}>
              <Ic n={showGone ? 'chevdown' : 'chevright'} className="ic--14" /><span>移走的 {gone.length} 段</span>
            </BCAction>
            {showGone ? (
              <div className="sc-made">
                {gone.map((c) => (
                  <div className="sc-made__row" key={c.id}>
                    <span className="sc-made__t"><b className="t-truncate">{c.title}</b><span>{SC.spanText(c)}</span></span>
                    <Btn variant="quiet" size="s" onClick={() => api.edit(proj, c.id, {removed: false})}>放回</Btn>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        <SecHead aside="勾上的几支用同一套">取景和字幕</SecHead>
        <div className="sec">
          {s.facts.portrait ? <div className="hint sc-flat">原片就是竖屏，不用取景。</div> : (
            <PRow label="取景">
              <Segmented size="s" value={p.focus} onChange={(v) => api.setParams(proj, {focus: v})} items={SC.FOCUS.map((f) => ({k: f.id, label: f.name}))} />
            </PRow>
          )}
          {!ready.ok ? (
            <div className="hint sc-flat">还缺 {ready.missing.map((m) => m.name).join('、')}，先下载 {C.sizeText(missingMb)}，之后离线可用。不想下载就选居中。</div>
          ) : null}
          {s.facts.hasTrans ? (
            <PRow label="字幕轨">
              <Segmented size="s" value={p.tracks} onChange={(v) => api.setParams(proj, {tracks: v})} items={SC.TRACKS.map((t) => ({k: t.id, label: t.name}))} />
            </PRow>
          ) : null}
          <Checkbox on={p.style === 'shorts'} onChange={(v) => api.setParams(proj, {style: v ? 'shorts' : 'project'})} label="用短视频字幕样式" />
          <div className="hint sc-flat">{p.style === 'shorts' ? '字幕避开平台按钮。' : '沿用这部视频的样式，字幕可能被平台按钮挡住。'}这几项用于预览和创建，改了不用重新找片段。</div>
        </div>

        <SecHead>不够，或者不是你要的</SecHead>
        <div className="sec">
          <div className="sc-more">
            <Field size="s" value={note} placeholder="这次想要什么不一样的（可以不填）" onChange={(e) => { setNote(e.target.value); setMiss(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') more(); }} />
            <Btn size="s" variant="secondary" onClick={more}>再找几段</Btn>
          </div>
          {miss ? <div className="hint sc-flat">{s.scope ? `「${s.scope.label}」里` : '这部视频里'}没有找到更多合适的片段。可以自己加一段，或者重新设置换一档时长。</div> : null}
          <div className="sc-row">
            <Btn size="s" variant="secondary" icon="plus" onClick={addOwn}>自己加一段</Btn>
            <span className="t-detail">从预览的播放头（{SC.mmss(s.t)}）那一句起</span>
          </div>
          <div className="sc-row">
            <Btn size="s" variant="quiet" onClick={reset}>重新设置</Btn>
            <span className="t-detail">{lead.redo ? '回设置页，从头找片段' : SC.summaryLine(s.params)}</span>
          </div>
        </div>

        <div className="flowcta">
          <Btn variant="accent" style={{width: '100%'}} disabled={!on.length || downloading || pending} onClick={start}>
            {downloading || pending ? '正在下载模型…' : !ready.ok && on.length ? `下载并创建 · ${C.sizeText(missingMb)}` : SC.createLabel(on.length)}
          </Btn>
        </div>
        <div className="hint">{on.length ? `合计 ${SC.mmss(SC.totalSec(s.list))}。每支一部新视频，引用同一份原片，不复制视频。` : '先勾上要做的片段。'}</div>
      </div>
    );
  }

  Object.assign(window, {ShortsCutPick});
})();
