/* 剪成短视频（§15.12）挑片段时的舞台：接管编辑列，与智能裁剪「检查构图」同一位置。
   左边原片叠 9:16 取景窗（取景选「我自己定」时可以横向拖），右边是这一支的成片预览
   （当前这一句的字幕 + 平台安全区），下面一条原片条：整片、章节刻度、每段候选一个色块。
   这里不逐镜头调构图——要调，在切出来的短视频项目里用智能裁剪（裁决点 F）。 */
(function () {
  const {useState, useRef, useEffect, useMemo, useCallback} = React;
  const SC = window.BC_SHORTS_CUT;
  const C = window.BC_CROP;
  const S = window.BC_SHORTS;

  /* 画进视频画面的字幕：白字黑边，不随明暗模式变 */
  const CAPTION = {orig: '#FFFFFF', trans: '#FFE27A', edge: '#000000'}; /* @ds-allow: 成片预览里的字幕配色，是视频内容不是 S2 表面 */

  function SafeZones() {
    const pct = (r) => ({left: r.x + '%', top: r.y + '%', width: r.w + '%', height: r.h + '%'});
    return (
      <div className="safearea" aria-hidden="true">
        {S.zones().map((z) => <div key={z.k} className={cx('safearea__z', 'safearea__z--' + z.k)} style={pct(z)} />)}
        <div className="safearea__box" style={pct(S.safeBox())} />
      </div>
    );
  }

  function Caption({spec, width}) {
    if (!spec.lines.length) return null;
    const px = Math.max(8, width * spec.fontPct / 100);
    const edge = Math.max(1, px / 10);
    return (
      <div className="sc-cap" style={{bottom: (100 - spec.bottom) + '%', width: spec.width + '%', left: (100 - spec.width) / 2 + '%', fontSize: px}}>
        {spec.lines.map((l) => (
          <span key={l.k} style={{color: CAPTION[l.k], WebkitTextStroke: `${edge}px ${CAPTION.edge}`, paintOrder: 'stroke fill'}}>{l.text}</span>
        ))}
      </div>
    );
  }

  function ShortsCutStage({ctx}) {
    const app = useApp();
    const api = app.shortsCut;
    const proj = ctx.proj.id;
    const s = api.sessions[proj];
    const list = SC.visible(s.list);
    const cur = list.find((c) => c.id === s.sel) || list[0] || null;
    const source = ctx.sources.video.find((v) => !v.crop) || ctx.sources.video[0] || null;
    const srcRatio = C.sourceRatio(source);
    const subjects = useMemo(() => C.demoSubjects('podcast'), []);
    const speakerX = useMemo(() => SC.speakerMap(s.sentences, subjects), [s.sentences, subjects]);
    const kids = SC.childrenOf(app.projects, proj);
    const dur = Math.max(1, ctx.duration || (s.sentences.length ? s.sentences[s.sentences.length - 1].end : 1));
    const t = s.t || 0;
    const playing = !!s.playing;
    const setPlaying = useCallback((v) => api.set(proj, (c) => ({playing: typeof v === 'function' ? v(!!c.playing) : v})), [proj]);
    const seek = useCallback((x) => api.seek(proj, Math.min(dur, x)), [proj, dur]);
    const line = s.sentences[SC.indexAt(s.sentences, t)] || null;
    const inCur = cur && t >= cur.start - 0.02 && t <= cur.end + 0.02;
    const size = SC.focusSize(srcRatio);
    const activeLine = line && t >= line.start && t < line.end ? line : null;
    const cx0 = SC.focusAt(s.params, cur, activeLine, speakerX, srcRatio, SC.contextFocus(s.sentences, t, speakerX, subjects));
    const analysisKey = s.params.focus === 'speaker' && cur ? `${proj}:${source && source.id}:${cur.start}:${cur.end}` : null;
    const [analyzed, setAnalyzed] = useState(null);
    useEffect(() => {
      if (!analysisKey) return;
      // Explicitly simulated delay; this prototype does not run video models.
      const timer = setTimeout(() => setAnalyzed(analysisKey), 600);
      return () => clearTimeout(timer);
    }, [analysisKey]);
    const framingPending = analysisKey && analyzed !== analysisKey;
    const framingOutside = analysisKey && (t < Math.max(0, cur.start - 3) || t > cur.end + 3);
    const win = {cx: cx0, cy: 0.5, w: size.w, h: size.h};
    const manual = s.params.focus === 'manual' && !s.facts.portrait;
    const cue = SC.reviewCueAt(ctx.cues || [], t);
    const spec = SC.captionSpec(s.params, inCur ? cue : null, S.SAFE);

    const [box, setBox] = useState({w: 800, h: 480});
    const bodyRef = useRef(null);
    const raf = useRef(null), last = useRef(0);
    const tRef = useRef(t); tRef.current = t;
    const endRef = useRef(cur ? cur.end : dur); endRef.current = cur ? cur.end : dur;

    useEffect(() => {
      const node = bodyRef.current;
      if (!node) return;
      const ro = new ResizeObserver(() => setBox({w: node.clientWidth, h: node.clientHeight}));
      ro.observe(node); setBox({w: node.clientWidth, h: node.clientHeight});
      return () => ro.disconnect();
    }, []);
    /* 本地播放时钟：只推进会话里的播放头，放到这一段末尾就停。 */
    useEffect(() => {
      if (!playing || framingPending) { cancelAnimationFrame(raf.current); return; }
      last.current = performance.now();
      if (tRef.current >= endRef.current - 0.05 && cur) { tRef.current = cur.start; seek(cur.start); }
      const tick = (now) => {
        const dt = (now - last.current) / 1000; last.current = now;
        const nt = tRef.current + dt;
        if (nt >= endRef.current) { seek(endRef.current); setPlaying(false); return; }
        tRef.current = nt; seek(nt); raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf.current);
    }, [playing, cur && cur.id, framingPending]);
    useEffect(() => () => api.set(proj, {playing: false}), [proj]);
    useEffect(() => {
      const key = (e) => {
        if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
        const step = e.shiftKey ? 5 : 1;
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') api.undoRange(proj, e.shiftKey);
        else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') api.undoRange(proj, true);
        else if (e.key === ' ') setPlaying((v) => !v);
        else if (e.key === 'ArrowLeft') seek(Math.max(0, t - step));
        else if (e.key === 'ArrowRight') seek(t + step);
        else if (e.key === 'Escape') { if (s.reviewGesture) { api.undoRange(proj); drag.current=null; edge.current=null; } else api.close(proj); }
        else return;
        e.preventDefault(); e.stopPropagation();
      };
      window.addEventListener('keydown', key, true);
      return () => window.removeEventListener('keydown', key, true);
    }, [t, proj, s.reviewGesture]);

    const gap = 16, pad = 16, labelH = 24;
    const innerW = Math.max(0, box.w - pad * 2 - gap), innerH = Math.max(0, box.h - pad * 2 - labelH);
    const srcW = Math.round(innerW * 0.62), outW = innerW - srcW;
    const srcFit = window.BC_LAYOUT.fitStage(srcW, innerH, srcRatio, 0);
    const outFit = window.BC_LAYOUT.fitStage(outW, innerH, 9 / 16, 0);
    const pct = (v) => `${v * 100}%`;

    /* 拖取景框：只横向，整支一个位置。 */
    const drag = useRef(null);
    const onDown = (e) => {
      if (!manual || !cur || e.button !== 0) return;
      drag.current = {x0: e.clientX, w: e.currentTarget.parentElement.getBoundingClientRect().width, base: cx0, id: cur.id};
      api.beginEdit(proj, cur.id);
      e.currentTarget.setPointerCapture(e.pointerId);
      setPlaying(false);
      e.preventDefault();
    };
    const onMove = (e) => {
      const d = drag.current; if (!d) return;
      api.edit(proj, d.id, {focusX: +SC.clampFocus(d.base + (e.clientX - d.x0) / d.w, srcRatio).toFixed(3)});
    };
    const onUp = () => { if (drag.current) api.endEdit(proj); drag.current = null; };

    /* 原片条：点空白处跳播放头，点色块选中那一段，拖选中那一段的两端调起止（吸附到句子边界）。 */
    const trackRef = useRef(null);
    const edge = useRef(null);
    const timeAt = (e) => {
      const r = trackRef.current.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur;
    };
    const scrub = (e) => { setPlaying(false); seek(timeAt(e)); };
    const edgeDown = (e, id, which) => {
      e.stopPropagation();
      edge.current = {id, which};
      api.beginEdit(proj, id); api.set(proj, {expand: id});
      e.currentTarget.setPointerCapture(e.pointerId);
      setPlaying(false);
    };
    const edgeMove = (e) => { if (edge.current) api.drag(proj, edge.current.id, edge.current.which, timeAt(e)); };
    const edgeUp = () => { if (edge.current) api.endEdit(proj); edge.current = null; };
    const head = useRef(null);
    const headDown = (e) => {
      e.stopPropagation(); head.current={x:e.clientX, time:t};
      e.currentTarget.setPointerCapture(e.pointerId); setPlaying(false);
    };
    const headMove = (e) => {
      if (!head.current) return; e.stopPropagation();
      seek(Math.max(0, Math.min(dur, head.current.time + (e.clientX-head.current.x)/trackRef.current.getBoundingClientRect().width*dur)));
    };

    const focusName = s.facts.portrait ? '原片就是竖屏，不用取景' : SC.focusOf(s.params.focus).name;
    return (
      <div className="cr-stage sc-stage" aria-label="挑片段">
        <div className="cr-stage__bar">
          <Ic n="clip" className="ic--16" />
          <b>挑片段</b>
          <span className="t-detail t-truncate">{cur ? `第 ${list.indexOf(cur) + 1} 段 · ${cur.title} · ${SC.spanText(cur)}` : '还没有候选'}</span>
          <span className="grow" />
          <IconBtn icon="undo" size="s" tip="撤销范围调整" disabled={!SC.reviewCanStep(s, false)} onClick={() => api.undoRange(proj)} />
          <IconBtn icon="redo" size="s" tip="重做范围调整" disabled={!SC.reviewCanStep(s, true)} onClick={() => api.undoRange(proj, true)} />
          <Btn size="s" variant="secondary" icon="back" onClick={() => api.close(proj)}>回到编辑器</Btn>
        </div>
        <div className="cr-stage__body" ref={bodyRef}>
          <div className="cr-pane" style={{width: srcW}}>
            <div className="cr-pane__lab"><b>原片</b><span>{C.ratioId(srcRatio)} · {manual ? '拖取景框定这一支的位置' : `取景 · ${focusName}`}</span></div>
            <div className="cr-frame" style={{width: srcFit.w, height: srcFit.h}} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
              <window.CropScene subjects={subjects} ratio={srcRatio} />
              {!framingPending && !framingOutside && <>
              <i className="cr-shade" style={{left: 0, top: 0, bottom: 0, width: pct(win.cx - win.w / 2)}} />
              <i className="cr-shade" style={{right: 0, top: 0, bottom: 0, width: pct(1 - win.cx - win.w / 2)}} />
              <div className={cx('cr-win', manual && 'is-manual', !manual && 'sc-win--fixed')}
                style={{left: pct(win.cx - win.w / 2), top: pct(win.cy - win.h / 2), width: pct(win.w), height: pct(win.h)}}
                onPointerDown={onDown} role={manual ? 'slider' : undefined} aria-label={manual ? '取景框' : undefined} tabIndex={manual ? 0 : undefined}>
                <em>{manual ? SC.focusText(cur && cur.focusX) : focusName}</em>
              </div>
              </>}
            </div>
          </div>
          <div className="cr-pane" style={{width: outW}}>
            <div className="cr-pane__lab"><b>这一支</b><span>9:16 · {SC.STYLES.find((x) => x.id === s.params.style).name}</span></div>
            <div className="cr-frame cr-frame--out" style={{width: outFit.w, height: outFit.h}}>
              {framingPending || framingOutside ? <div className="sc-framing-pending" role="status">{framingPending ? '正在分析跟拍，完成后显示预览…' : '点「试看」回到片段内查看跟拍。'}</div> : <>
              <span className="cr-cell">
                <span className="cr-cell__in" style={{width: `${100 / win.w}%`, height: `${100 / win.h}%`, left: `${-(win.cx - win.w / 2) / win.w * 100}%`, top: `${-(win.cy - win.h / 2) / win.h * 100}%`}}>
                  <window.CropScene subjects={subjects} ratio={srcRatio} />
                </span>
              </span>
              <Caption spec={spec} width={outFit.w} />
              <SafeZones />
              </>}
            </div>
            {spec.blocked ? <div className="sc-stage__warn">字幕压在平台文案区里 · 换成「短视频字幕」就避开了</div> : null}
          </div>
        </div>
        <div className="cr-strip">
          <div className="cr-strip__row">
            <IconBtn icon={playing ? 'pause' : 'play'} size="s" tip={playing ? '暂停' : '播放这一段'} onClick={() => setPlaying((v) => !v)} />
            <span className="t-mono t-detail cr-time sc-time">{cur
              ? `这一段 ${SC.mmss(Math.max(0, Math.min(cur.end, t) - cur.start))} / ${SC.mmss(cur.end - cur.start)}` : SC.mmss(t)}</span>
            <span className="t-mono t-detail">原片 {SC.mmss(t)} / {SC.mmss(dur)}</span>
            <span className="grow" />
            <span className="cr-legend">
              <span className="sc-legend is-on">勾上的</span>
              <span className="sc-legend">没勾的</span>
              {kids.length ? <span className="sc-legend is-done">已切过</span> : null}
            </span>
          </div>
          <div className="cr-track sc-track" ref={trackRef} onPointerDown={(e) => { scrub(e); e.currentTarget.setPointerCapture(e.pointerId); }}
            onPointerMove={(e) => { if (edge.current) edgeMove(e); else if (e.buttons & 1) scrub(e); }} onPointerUp={edgeUp} onPointerCancel={edgeUp}
            role="slider" aria-label="原片条" aria-valuenow={Math.round(t)} tabIndex={0}>
            {ctx.chapters.map((ch) => <i key={ch.id} className="sc-tick" style={{left: pct(ch.start / dur)}} title={ch.title} />)}
            {kids.map((k) => SC.bar(SC.usedRanges(k), dur).map((b, i) => (
              <span key={k.id + i} className="sc-seg is-done" style={{left: b.left + '%', width: b.width + '%'}} title={`已切过 · ${k.title}`} />
            )))}
            {list.map((c, i) => {
              const on = cur && c.id === cur.id;
              return (
                <span key={c.id} className={cx('sc-seg', c.on && 'is-on', on && 'is-cur')} style={{left: pct(c.start / dur), width: pct((c.end - c.start) / dur)}}
                  title={`第 ${i + 1} 段 · ${c.title} · ${SC.spanText(c)}`}
                  onPointerDown={(e) => { e.stopPropagation(); setPlaying(false); api.select(proj, c.id); }}>
                  <b>{i + 1}</b>
                  {on && (c.end-c.start)/dur*(trackRef.current?.clientWidth || 0) >= 24 ? <i className="sc-grip sc-grip--l" onPointerDown={(e) => edgeDown(e, c.id, 'start')} onPointerMove={edgeMove} onPointerUp={edgeUp} title="拖这里改起点" /> : null}
                  {on && (c.end-c.start)/dur*(trackRef.current?.clientWidth || 0) >= 24 ? <i className="sc-grip sc-grip--r" onPointerDown={(e) => edgeDown(e, c.id, 'end')} onPointerMove={edgeMove} onPointerUp={edgeUp} title="拖这里改终点" /> : null}
                </span>
              );
            })}
            <i className="sc-playhead-line" style={{left: pct(t / dur)}} />
            <span className="sc-playhead" style={{left: pct(t / dur)}} role="slider" aria-label="播放头" aria-valuenow={t} tabIndex={0}
              onPointerDown={headDown} onPointerMove={headMove} onPointerUp={(e)=>{e.stopPropagation();head.current=null;}} onPointerCancel={()=>{head.current=null;}}><i /></span>
          </div>
        </div>
      </div>
    );
  }

  Object.assign(window, {ShortsCutStage});
})();
