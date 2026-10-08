/* 智能裁剪（§15.9）舞台：检查构图时接管编辑列——左边原片带可拖的取景框和重点标签，
   右边是裁出来的成片预览，下面一条镜头带（谁在框里、手动关键帧、播放头）。
   也导出 CropVideo：画布 / 素材缩略里按构图渲染裁剪产物（有源 URL 就放真视频，否则画演示场景）。 */
(function () {
  const {useState, useRef, useEffect, useMemo, useCallback} = React;
  const C = window.BC_CROP;

  /* ---------- 演示场景：从「重点」画出来的剪影，是画进视频画面的内容，不随明暗模式变 ---------- */
  const ART = {wall: '#2B2F38', floor: '#3A3F4B', person: '#D8D3C8', person2: '#B9B2A4', board: '#F4F1EA', ink: '#8A8F9A', screen: '#1E2230', glow: '#5B8DEF'}; /* @ds-allow: 演示视频画面里的剪影配色，不是 S2 表面 */
  function CropScene({subjects, ratio}) {
    const W = 160, H = Math.round(W / (ratio || 16 / 9));
    let pi = 0;
    return (
      <svg className="cr-art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect x="0" y="0" width={W} height={H} fill={ART.wall} />
        <rect x="0" y={H * 0.78} width={W} height={H * 0.22} fill={ART.floor} />
        {(subjects || []).map((s) => {
          const x = s.x * W, y = s.y * H, w = s.w * W, h = s.h * H;
          if (s.kind === 'board') return <g key={s.id}>
            <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx="1.5" fill={ART.board} />
            {[0.22, 0.38, 0.54, 0.7].map((f, i) => <rect key={i} x={x - w / 2 + w * 0.08} y={y - h / 2 + h * f} width={w * (0.84 - (i % 2) * 0.3)} height={h * 0.035} rx="0.6" fill={ART.ink} />)}
          </g>;
          if (s.kind === 'screen') return <g key={s.id}>
            <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx="1.5" fill={ART.screen} />
            <rect x={x - w / 2 + w * 0.1} y={y - h / 2 + h * 0.18} width={w * 0.5} height={h * 0.08} rx="0.8" fill={ART.glow} />
            <rect x={x - w / 2 + w * 0.1} y={y - h / 2 + h * 0.36} width={w * 0.8} height={h * 0.04} rx="0.6" fill={ART.ink} />
            <rect x={x - w / 2 + w * 0.1} y={y - h / 2 + h * 0.48} width={w * 0.66} height={h * 0.04} rx="0.6" fill={ART.ink} />
          </g>;
          const fill = pi++ % 2 ? ART.person2 : ART.person;
          const headR = h * 0.11, headY = y - h / 2 + headR;
          return <g key={s.id}>
            <circle cx={x} cy={headY} r={headR} fill={fill} />
            <path d={`M ${x - w / 2} ${y + h / 2} C ${x - w / 2} ${headY + headR * 1.6} ${x - w * 0.18} ${headY + headR * 1.2} ${x} ${headY + headR * 1.2} C ${x + w * 0.18} ${headY + headR * 1.2} ${x + w / 2} ${headY + headR * 1.6} ${x + w / 2} ${y + h / 2} Z`} fill={fill} />
          </g>;
        })}
      </svg>
    );
  }

  /* 原片内容：有 URL 放真视频（静音、随时间寻址），没有就是演示场景。 */
  function SourceMedia({crop, subjects, time, playing}) {
    const ref = useRef(null);
    const sync = () => {
      const v = ref.current;
      if (!v) return;
      if (Math.abs(v.currentTime - time) > (playing ? 0.3 : 0.03)) v.currentTime = time;
    };
    /* 元数据没到之前设 currentTime 会被浏览器记成起播位置；到了之后再对一次，确保第一帧就是要的时刻。 */
    useEffect(sync, [time, playing]);
    useEffect(() => {
      const v = ref.current;
      if (!v) return;
      if (playing) v.play().catch(() => {}); else v.pause();
    }, [playing]);
    if (crop && crop.sourceUrl) return <video ref={ref} className="cr-media" src={crop.sourceUrl} muted playsInline preload="auto" aria-hidden="true" onLoadedMetadata={sync} />;
    return <CropScene subjects={subjects} ratio={crop ? crop.srcRatio : 16 / 9} />;
  }

  /* 一格成片：把原片按取景窗平移缩放进目标画幅的盒子。win 用源画面比例坐标。 */
  function CropCell({crop, subjects, win, time, playing, blur}) {
    const style = {width: `${100 / win.w}%`, height: `${100 / win.h}%`, left: `${-(win.cx - win.w / 2) / win.w * 100}%`, top: `${-(win.cy - win.h / 2) / win.h * 100}%`};
    return <span className="cr-cell">
      {blur ? <span className="cr-cell__bg"><SourceMedia crop={crop} subjects={subjects} time={time} playing={false} /></span> : null}
      <span className="cr-cell__in" style={style}><SourceMedia crop={crop} subjects={subjects} time={time} playing={playing} /></span>
    </span>;
  }
  function CropOutput({crop, plan, geom, time, playing, fillH}) {
    const win = C.windowAt(plan, time, geom);
    const dims = C.dimensions(geom.dstRatio);
    const box = {position: 'relative', overflow: 'hidden', width: '100%', height: fillH ? '100%' : null, aspectRatio: fillH ? null : `${dims.w} / ${dims.h}`};
    if (win.split) {
      const v = win.layout.dir === 'v';
      return <span className={cx('cr-out', v ? 'cr-out--v' : 'cr-out--h')} style={{...box, display: 'flex', flexDirection: v ? 'column' : 'row'}}>
        {win.split.map((h, i) => <span key={i} className="cr-out__half"><CropCell crop={crop} subjects={plan.subjects} win={h} time={time} playing={playing} /></span>)}
      </span>;
    }
    return <span className="cr-out" style={{...box, display: 'block'}}><CropCell crop={crop} subjects={plan.subjects} win={win} time={time} playing={playing} blur={crop && crop.fill === 'blur'} /></span>;
  }

  /* 画布 / 缩略里的裁剪产物：时间按元素换算到原片。 */
  function CropVideo({source, el, ctx, fillH}) {
    const crop = source.crop;
    const local = window.BC_VIDEO_EDIT ? window.BC_VIDEO_EDIT.sourceTime(el, ctx.playT) : Math.max(0, ctx.playT - el.start);
    const time = crop.range.start + Math.max(0, Math.min(source.dur || 0, local));
    const geom = {srcRatio: crop.srcRatio, dstRatio: crop.ratio, zoom: crop.zoom || 1};
    return <CropOutput crop={crop} plan={crop.plan} geom={geom} time={time} playing={!!ctx.playing} fillH={fillH} />;
  }

  /* ---------- 检查构图 ---------- */
  const FOLLOW_TONE = ['blue', 'green', 'orange', 'purple'];
  const CHIP_TONE = {blue: 'accent', green: 'positive', orange: 'notice', purple: 'info', indigo: 'info', gray: 'neutral'};
  function followTone(plan, follow) {
    if (follow === 'split') return 'indigo';
    if (follow === 'manual') return 'gray';
    const i = plan.subjects.findIndex((s) => s.id === follow);
    return FOLLOW_TONE[i] || 'gray';
  }

  function CropStage({ctx}) {
    const app = useApp();
    const proj = ctx.proj.id;
    const s = app.crop.sessions[proj];
    const plan = s.plan;
    const geom = useMemo(() => ({srcRatio: C.sourceRatio(s.source), dstRatio: app.crop.ratioValue(s), zoom: s.zoom}), [s.source, s.ratio, s.custom, s.zoom]);
    const crop = useMemo(() => ({sourceUrl: s.source.url, srcRatio: geom.srcRatio, fill: s.fill}), [s.source.url, geom.srcRatio, s.fill]);
    const t = s.t;
    const [playing, setPlaying] = useState(false);
    const [box, setBox] = useState({w: 800, h: 480});
    const bodyRef = useRef(null);
    const raf = useRef(null), last = useRef(0);
    const seek = useCallback((x) => app.crop.seek(proj, x), [proj]);
    const tRef = useRef(t); tRef.current = t;
    const endRef = useRef(s.range.end); endRef.current = s.range.end;
    const dstId = app.crop.ratioIdOf(s);

    useEffect(() => {
      const node = bodyRef.current;
      if (!node) return;
      const ro = new ResizeObserver(() => setBox({w: node.clientWidth, h: node.clientHeight}));
      ro.observe(node); setBox({w: node.clientWidth, h: node.clientHeight});
      return () => ro.disconnect();
    }, []);
    /* 本地播放时钟：只推进会话里的 t，退出检查或到区间末尾就停。 */
    useEffect(() => {
      if (!playing) { cancelAnimationFrame(raf.current); return; }
      last.current = performance.now();
      const tick = (now) => {
        const dt = (now - last.current) / 1000; last.current = now;
        const nt = tRef.current + dt;
        if (nt >= endRef.current) { seek(endRef.current); setPlaying(false); return; }
        tRef.current = nt; seek(nt); raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf.current);
    }, [playing]);
    useEffect(() => {
      const key = (e) => {
        if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
        const step = e.shiftKey ? 5 : 1;
        if (e.key === ' ') { setPlaying((v) => !v); }
        else if (e.key === 'ArrowLeft') seek(t - step);
        else if (e.key === 'ArrowRight') seek(t + step);
        else if (e.key === 'Escape') app.crop.close(proj);
        else return;
        e.preventDefault(); e.stopPropagation();
      };
      window.addEventListener('keydown', key, true);
      return () => window.removeEventListener('keydown', key, true);
    }, [t, proj]);

    /* 版面：两格并排，原片占大头；都按各自画幅在自己的格里 fit。 */
    const gap = 16, pad = 16, labelH = 24;
    const innerW = Math.max(0, box.w - pad * 2 - gap), innerH = Math.max(0, box.h - pad * 2 - labelH);
    const srcW = Math.round(innerW * 0.62), outW = innerW - srcW;
    const srcFit = window.BC_LAYOUT.fitStage(srcW, innerH, geom.srcRatio, 0);
    const outFit = window.BC_LAYOUT.fitStage(outW, innerH, geom.dstRatio, 0);
    const win = C.windowAt(plan, t, geom);
    const shot = win.shot;
    const kf = C.keyframeAt(plan, t);

    /* 拖取景框：按下就在这一刻记一个手动关键帧，之后跟着指针改中心。 */
    const drag = useRef(null);
    const onDown = (e, half) => {
      if (e.button !== 0) return;
      const r = e.currentTarget.parentElement.getBoundingClientRect();
      drag.current = {x0: e.clientX, y0: e.clientY, r, half, base: win};
      e.currentTarget.setPointerCapture(e.pointerId);
      setPlaying(false);
      e.preventDefault();
    };
    const onMove = (e) => {
      const d = drag.current; if (!d) return;
      const dx = (e.clientX - d.x0) / d.r.width, dy = (e.clientY - d.y0) / d.r.height;
      if (d.half == null) {
        const c = C.clampCenter(d.base.cx + dx, d.base.cy + dy, d.base);
        app.crop.editPlan(proj, (p) => C.setKeyframe(p, t, {cx: c.cx, cy: c.cy}));
      } else {
        const split = d.base.split.map((h, i) => i === d.half ? C.clampCenter(h.cx + dx, h.cy + dy, h) : {cx: h.cx, cy: h.cy});
        app.crop.editPlan(proj, (p) => C.setKeyframe(p, t, {cx: d.base.cx, cy: d.base.cy, split}));
      }
    };
    const onUp = () => { drag.current = null; };

    const pct = (v) => `${v * 100}%`;
    const winBox = (w) => ({left: pct(w.cx - w.w / 2), top: pct(w.cy - w.h / 2), width: pct(w.w), height: pct(w.h)});
    const shots = plan.shots;
    const span = s.range.end - s.range.start;
    const flags = useMemo(() => C.flags(plan, geom), [plan, geom]);
    const flagged = new Set(flags.map((f) => f.shot));
    const jump = (dir) => {
      const list = shots.slice().sort((a, b) => a.start - b.start);
      const i = list.findIndex((x) => shot && x.id === shot.id);
      const n = list[Math.max(0, Math.min(list.length - 1, i + dir))];
      if (n) seek(n.start);
    };
    const scrub = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      seek(s.range.start + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * span);
    };

    return (
      <div className="cr-stage" aria-label="检查构图">
        <div className="cr-stage__bar">
          <Ic n="tune" className="ic--16" />
          <b>检查构图</b>
          <span className="t-detail t-truncate">{s.source.name} → {dstId} · 拖左边的取景框就是在这一刻记一个关键帧</span>
          <span className="grow" />
          <Btn size="s" variant="secondary" icon="back" onClick={() => app.crop.close(proj)}>回到编辑器</Btn>
        </div>
        <div className="cr-stage__body" ref={bodyRef}>
          <div className="cr-pane" style={{width: srcW}}>
            <div className="cr-pane__lab"><b>原片</b><span>{C.ratioId(geom.srcRatio)} · 灰的部分会被裁掉</span></div>
            <div className="cr-frame" style={{width: srcFit.w, height: srcFit.h}} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
              <SourceMedia crop={crop} subjects={plan.subjects} time={t} playing={playing} />
              {win.split ? win.split.map((h, i) => (
                <React.Fragment key={i}>
                  <div className={cx('cr-win', 'cr-win--half', kf && 'is-manual')} style={winBox(h)} onPointerDown={(e) => onDown(e, i)} role="slider" aria-label={`同框第 ${i + 1} 格取景`} tabIndex={0}>
                    <em>{win.layout.dir === 'v' ? (i ? '下' : '上') : (i ? '右' : '左')}</em>
                  </div>
                </React.Fragment>
              )) : (
                <>
                  <i className="cr-shade" style={{left: 0, top: 0, right: 0, height: pct(win.cy - win.h / 2)}} />
                  <i className="cr-shade" style={{left: 0, right: 0, bottom: 0, height: pct(1 - win.cy - win.h / 2)}} />
                  <i className="cr-shade" style={{left: 0, top: pct(win.cy - win.h / 2), height: pct(win.h), width: pct(win.cx - win.w / 2)}} />
                  <i className="cr-shade" style={{right: 0, top: pct(win.cy - win.h / 2), height: pct(win.h), width: pct(1 - win.cx - win.w / 2)}} />
                  <div className={cx('cr-win', kf && 'is-manual')} style={winBox(win)} onPointerDown={(e) => onDown(e, null)} role="slider" aria-label="取景框" tabIndex={0}>
                    <em>{kf ? '手动关键帧' : shot ? C.followName(plan, shot.follow) : ''}</em>
                  </div>
                </>
              )}
              {plan.subjects.map((sub) => (
                <span key={sub.id} className={cx('cr-pin', shot && shot.follow === sub.id && 'is-on')} style={{left: pct(sub.x), top: pct(sub.y - sub.h / 2)}}
                  onClick={() => shot && app.crop.editPlan(proj, (p) => C.setShotFollow(p, shot.id, sub.id))} title={`这个镜头改为跟着${sub.name}`}>{sub.name}</span>
              ))}
            </div>
          </div>
          <div className="cr-pane" style={{width: outW}}>
            <div className="cr-pane__lab"><b>裁出来的 {dstId}</b><span>{C.dimensions(geom.dstRatio).w} × {C.dimensions(geom.dstRatio).h}</span></div>
            <div className="cr-frame cr-frame--out" style={{width: outFit.w, height: outFit.h}}>
              <CropOutput crop={crop} plan={plan} geom={geom} time={t} playing={playing} fillH />
            </div>
          </div>
        </div>
        <div className="cr-strip">
          <div className="cr-strip__row">
            <IconBtn icon="prev" size="s" tip="上一个镜头" onClick={() => jump(-1)} />
            <IconBtn icon={playing ? 'pause' : 'play'} size="s" tip={playing ? '暂停' : '播放'} onClick={() => setPlaying((v) => !v)} />
            <IconBtn icon="next" size="s" tip="下一个镜头" onClick={() => jump(1)} />
            <span className="t-mono t-detail cr-time">{C.mmss(t)} / {C.mmss(s.range.end)}</span>
            {shot ? <Chip tone={CHIP_TONE[followTone(plan, shot.follow)]}>镜头 {shots.slice().sort((a, b) => a.start - b.start).findIndex((x) => x.id === shot.id) + 1} · {C.followName(plan, shot.follow)}</Chip> : null}
            <span className="grow" />
            <span className="cr-legend">
              {plan.subjects.map((sub) => <span key={sub.id} className={`cr-legend__i is-${followTone(plan, sub.id)}`}>{sub.name}</span>)}
              {plan.subjects.filter((x) => x.kind === 'person').length > 1 ? <span className="cr-legend__i is-indigo">同框</span> : null}
              <span className="cr-legend__i is-manual">手动关键帧</span>
            </span>
          </div>
          <div className="cr-track" onPointerDown={(e) => { scrub(e); e.currentTarget.setPointerCapture(e.pointerId); }}
            onPointerMove={(e) => { if (e.buttons & 1) scrub(e); }} role="slider" aria-label="镜头带" aria-valuenow={Math.round(t)} tabIndex={0}>
            {shots.map((sh) => (
              <span key={sh.id} className={cx('cr-seg', `is-${followTone(plan, sh.follow)}`, shot && shot.id === sh.id && 'is-cur', flagged.has(sh.id) && 'is-flag')}
                style={{left: pct((sh.start - s.range.start) / span), width: pct((sh.end - sh.start) / span)}} title={`${C.mmss(sh.start)} – ${C.mmss(sh.end)} · ${C.followName(plan, sh.follow)}`} />
            ))}
            {plan.keyframes.filter((k) => !k.auto).map((k, i) => <i key={i} className="cr-kf" style={{left: pct((k.t - s.range.start) / span)}} />)}
            <i className="cr-head" style={{left: pct((t - s.range.start) / span)}} />
          </div>
        </div>
      </div>
    );
  }

  Object.assign(window, {CropStage, CropVideo, CropScene, CropOutput});
})();
