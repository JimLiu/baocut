/* 智能裁剪（§15.9）工具页：设置 → 分析中 → （检查构图在 panel-crop-review.jsx）→ 生成中 → 完成。
   设计出发点是用户只需回答两个问题——裁哪段、裁成什么画幅；「画面里有什么」有默认值，
   其余都折进「更多设置」。分析完不直接生成，先让人检查构图；生成的是 Video 里的一份新素材，
   原片与时间轴不动；替换是完成页上的一个明确动作。会话与计时器在 store-crop.jsx。 */
(function () {
  const {useState, useEffect, useMemo} = React;
  const C = window.BC_CROP;
  const D = window.BC_DATA;
  const {Job} = window.BC_AIFLOWS;

  const modelSize = (id) => { const m = D.setModels.find((x) => x.id === id); return m ? m.size : 0; };
  const sceneOf = (id) => C.SCENES.find((s) => s.id === id) || C.SCENES[0];

  /* 画幅格：小图画的是「原片外框 + 会留下来的那一块」，一眼看出裁掉多少。 */
  function RatioTile({id, name, sub, srcRatio, dstRatio, on, onClick}) {
    const W = 44, H = 28;
    const fr = srcRatio >= W / H ? {w: W, h: W / srcRatio} : {w: H * srcRatio, h: H};
    const win = dstRatio > 0 ? C.windowSize(srcRatio, dstRatio, 1) : null;
    return (
      <BCAction type="button" className={cx('cr-tile', on && 'is-on')} choiceKey={id}>
        <span className="cr-tile__pic" style={{width: W, height: H}}>
          <i className="cr-tile__src" style={{width: fr.w, height: fr.h}}>
            {win ? <em className="cr-tile__win" style={{width: `${win.w * 100}%`, height: `${win.h * 100}%`}} /> : null}
          </i>
        </span>
        <b>{id === 'custom' ? '自定义' : id}</b>
        <span>{sub || name}</span>
      </BCAction>
    );
  }

  function SceneRow({s, on, onClick}) {
    return (
      <BCAction type="button" className={cx('cr-scene', on && 'is-on')} choiceKey={s.id}  >

        <span className="cr-scene__t"><b>{s.name}</b><span>{s.desc}</span></span>
      </BCAction>
    );
  }

  /* 原片缩略：有海报用海报，没有就是素材的渐变 + 演示场景。 */
  function SourceThumb({source, scene, multi}) {
    const subjects = useMemo(() => C.demoSubjects(scene === 'auto' ? 'podcast' : scene), [scene]);
    return (
      <span className="cr-src__thumb" style={{background: source.grad || 'var(--gray-200)'}}>
        {source.poster ? <img src={source.poster} alt="" /> : <window.CropScene subjects={subjects} />}
      </span>
    );
  }

  /* ---------- 设置 ---------- */
  function CropSetup({ctx, s, onBack}) {
    const app = useApp();
    const proj = ctx.proj.id;
    const set = (p) => app.crop.set(proj, p);
    const [srcPop, setSrcPop] = useState(false);
    const [more, setMore] = useState(false);
    const [pending, setPending] = useState(false);
    const candidates = ctx.sources.video.filter((v) => !v.crop);
    const srcRatio = C.sourceRatio(s.source);
    const dstRatio = app.crop.ratioValue(s);
    const projectRatio = window.BC_LAYOUT.ratioValue(ctx.ratio);
    const projectId = C.ratioId(projectRatio);
    const ready = C.readiness(s.scene, s.multi, app.modelInstalled);
    const missingMb = ready.missing.reduce((a, m) => a + modelSize(m.id), 0);
    const downloading = ready.missing.some((m) => app.modelDl[m.id] != null);
    const whole = !s.wholeRange || (s.range.start <= 0.01 && Math.abs(s.range.end - s.wholeRange.end) < 0.01);
    const dur = s.range.end - s.range.start;
    const start = () => {
      if (!(dstRatio > 0)) { app.toast('先填一个有效的自定义画幅', 'negative'); return; }
      if (ready.ok) { app.crop.analyze(proj, {names: ctx.proj.speakers}); return; }
      ready.missing.forEach((m) => app.downloadModel(m.id));
      setPending(true);
    };
    useEffect(() => { if (pending && ready.ok) { setPending(false); app.crop.analyze(proj, {names: ctx.proj.speakers}); } }, [pending, ready.ok]);
    const pickSource = (v) => { app.crop.set(proj, {source: {id: v.id, name: v.name, dur: v.dur, grad: v.grad, url: v.url, poster: v.poster, meta: v.meta, naturalW: v.naturalW, naturalH: v.naturalH},
      range: {start: 0, end: v.dur || 0}, wholeRange: {start: 0, end: v.dur || 0}}); setSrcPop(false); };

    return (
      <div className="pscroll bc-scroll">
        <div className="flowh"><IconBtn icon="back" size="s" tip="返回" onClick={onBack} /><b>智能裁剪</b></div>
        <div className="aicard">
          <b>换一种画幅，重点留在框里</b>
          <span>认出画面里的人和白板、屏幕，裁掉多余的部分而不是补黑边。在本机运行，视频不上传。</span>
        </div>

        <SecHead>裁哪段视频</SecHead>
        <div className="sec">
          <div className="cr-src">
            <SourceThumb source={s.source} scene={s.scene} multi={s.multi} />
            <div className="cr-src__t">
              <b className="t-truncate" title={s.source.name}>{s.source.name}</b>
              <span>{C.ratioId(srcRatio)} · {C.mmss(s.source.dur || 0)}{s.source.meta ? ` · ${s.source.meta.split(' · ')[0]}` : ''}</span>
            </div>
            {candidates.length > 1 ? (
              <Picker size="s" value="换一段" open={srcPop} popAlign="right" popWidth={260} onClick={() => setSrcPop((v) => !v)} onClose={() => setSrcPop(false)}>
                <Menu>{candidates.map((v) => <MenuItem key={v.id} icon="video" label={v.name} sub={`${C.ratioId(C.sourceRatio(v))} · ${C.mmss(v.dur || 0)}`} on={v.id === s.source.id} onClick={() => pickSource(v)} />)}</Menu>
              </Picker>
            ) : null}
          </div>
          {!whole ? (
            <div className="scopebar"><Ic n="clip" className="ic--14" /><b>只裁这一段</b>
              <span>{C.mmss(s.range.start)} – {C.mmss(s.range.end)} · 时间轴上这个片段用到的区间</span>
              <BCAction className="ccbtn" onClick={() => set({range: {...s.wholeRange}})}>改为整段</BCAction></div>
          ) : <div className="hint">整段 · {C.mmss(dur)}。想只裁某一段，在时间轴上选中那个片段再从它的菜单进来。</div>}
        </div>

        <SecHead aside={dstRatio > 0 ? C.ratioId(srcRatio) + ' → ' + C.ratioId(dstRatio) : null}>裁成什么画幅</SecHead>
        <div className="sec">
          <BCChoiceGroup className="cr-ratios" value={s.ratio} onChange={ratio => set({ratio, ...(ratio === "custom" ? {custom: s.custom || {w: 2, h: 3}} : {})})} aria-label="目标画幅">
            {C.RATIOS.map((r) => (
              <RatioTile key={r.id} id={r.id} name={r.name} srcRatio={srcRatio} dstRatio={r.w / r.h} on={s.ratio === r.id}
                sub={r.id === projectId ? '视频画幅' : Math.abs(r.w / r.h - srcRatio) < 0.0005 ? '和原片一样' : r.name}
                onClick={() => set({ratio: r.id})} />
            ))}
            <RatioTile id="custom" srcRatio={srcRatio} dstRatio={s.ratio === 'custom' ? dstRatio : 0} on={s.ratio === 'custom'} sub="自己填"
              onClick={() => set({ratio: 'custom', custom: s.custom || {w: 2, h: 3}})} />
          </BCChoiceGroup>
          {s.ratio === 'custom' ? (
            <div className="cr-custom">
              <NumField label="宽" value={s.custom ? s.custom.w : 2} min={1} max={64} step={1} digits={0} onChange={(w) => set({custom: {...(s.custom || {h: 3}), w}})} />
              <span className="t-detail">:</span>
              <NumField label="高" value={s.custom ? s.custom.h : 3} min={1} max={64} step={1} digits={0} onChange={(h) => set({custom: {...(s.custom || {w: 2}), h}})} />
              {dstRatio > 0 ? <span className="t-detail">= {C.dimensions(dstRatio).w} × {C.dimensions(dstRatio).h}</span> : null}
            </div>
          ) : null}
          <div className="hint">{dstRatio > 0 ? C.coverageText(srcRatio, dstRatio) : '填一个宽高比'}</div>
        </div>

        <SecHead>画面里有什么</SecHead>
        <BCChoiceGroup className="sec cr-scenes" value={s.scene} onChange={scene => set({scene})} aria-label="画面里有什么">
          {C.SCENES.map((sc) => <SceneRow key={sc.id} s={sc} on={s.scene === sc.id} onClick={() => set({scene: sc.id})} />)}
          {s.scene === 'auto' || s.scene === 'podcast' ? (
            <PRow label="两个人都在说时">
              <Segmented size="s" value={s.multi} onChange={(v) => set({multi: v})} items={C.MULTI.map((m) => ({k: m.id, label: m.name}))} />
            </PRow>
          ) : null}
        </BCChoiceGroup>

        <BCAction type="button" className="cr-more" onClick={() => setMore((v) => !v)} aria-expanded={more}>
          <Ic n={more ? 'chevdown' : 'chevright'} className="ic--14" /><span>更多设置</span>
          {!more ? <em>{C.MOTIONS.find((m) => m.id === s.motion).name} · 取景放大 {Math.round((s.zoom - 1) * 100)}%</em> : null}
        </BCAction>
        {more ? (
          <div className="sec">
            <PRow label="镜头运动">
              <Segmented size="s" value={s.motion} onChange={(v) => set({motion: v})} items={C.MOTIONS.map((m) => ({k: m.id, label: m.name}))} />
            </PRow>
            <div className="hint">{C.MOTIONS.find((m) => m.id === s.motion).desc}</div>
            <PRow label="取景松紧">
              <Slider value={Math.round(s.zoom * 100)} min={100} max={150} step={5} onChange={(v) => set({zoom: v / 100})} />
              <span className="t-detail cr-num">{s.zoom <= 1 ? '不放大' : `放大 ${Math.round((s.zoom - 1) * 100)}%`}</span>
            </PRow>
            <div className="hint">越紧越贴近人脸，越松保留更多环境。</div>
            <PRow label="裁不下时">
              <window.RSP.RadioGroup aria-label="裁不下时" value={s.fill} onChange={fill => set({fill})}>
                <window.RSP.Radio value="zoom">放大裁满</window.RSP.Radio>
                <window.RSP.Radio value="blur">模糊背景补边</window.RSP.Radio>
              </window.RSP.RadioGroup>
            </PRow>
          </div>
        ) : null}

        <SecHead aside="不上传">本机模型</SecHead>
        <div className="sec cr-models">
          {ready.list.map((m) => {
            const pct = app.modelDl[m.id];
            return (
              <div className="cr-model" key={m.id}>
                <Ic n={m.ok ? 'ok' : 'download'} className={cx('ic--14', m.ok ? 'is-ok' : 'is-need')} />
                <span className="cr-model__t"><b>{m.name}</b><span>{m.what}</span></span>
                {pct != null ? <span className="mdlbar"><i style={{width: pct + '%'}} /></span>
                  : <span className="t-detail t-mono">{m.ok ? '已就绪' : C.sizeText(modelSize(m.id))}</span>}
              </div>
            );
          })}
          <div className="hint">{ready.ok ? `${sceneOf(s.scene).name}只需要这${ready.list.length > 1 ? `${ready.list.length} 个` : '一个'}模型，都已就绪。`
            : `还缺 ${ready.missing.map((m) => m.name).join('、')}，先下载 ${C.sizeText(missingMb)}，之后离线可用。`}
            {' '}<BCAction className="stlink" onClick={() => app.go({r: 'settings', sec: 'local', tab: 'vision'})}>管理本地模型</BCAction></div>
        </div>

        <div className="flowcta">
          <Btn variant="accent" style={{width: '100%'}} onClick={start} disabled={downloading || pending}>
            {downloading || pending ? '正在下载模型…' : ready.ok ? '开始分析' : `下载并开始 · ${C.sizeText(missingMb)}`}
          </Btn>
        </div>
        <div className="hint">先分析、再让你检查构图，最后才生成视频。原片和时间轴都不会动。</div>
      </div>
    );
  }

  /* ---------- 分析中 / 生成中 ---------- */
  function CropRunning({ctx, s, onBack}) {
    const app = useApp();
    const task = app.tasks.find((t) => t.id === s.taskId);
    const pct = task ? task.pct || 0 : s.pct || 0;
    const analyzing = s.phase === 'analyzing';
    const stages = analyzing ? C.ANALYSIS_STAGES : C.RENDER_STAGES;
    const dstId = app.crop.ratioIdOf(s);
    return (
      <div className="pscroll bc-scroll">
        <div className="flowh"><IconBtn icon="back" size="s" tip="返回" onClick={onBack} /><b>智能裁剪</b><Chip tone="accent">后台运行中</Chip></div>
        <Job title={analyzing ? `正在看 ${s.source.name}…` : `正在生成 ${dstId} 视频…`} pct={pct} stages={stages}
          cur={C.stageAt(stages, pct).index} activity={task ? task.activity : null} />
        <div className="aicard">
          <b>{analyzing ? '分析完先给你检查' : '构图已定稿'}</b>
          <span>{analyzing
            ? `${C.ratioId(C.sourceRatio(s.source))} → ${dstId} · ${sceneOf(s.scene).name} · ${C.mmss(s.range.end - s.range.start)}。分析完停在「检查构图」，你确认后才生成视频。`
            : `生成的是 Video 里的一份新素材 · ${C.dimensions(app.crop.ratioValue(s)).w} × ${C.dimensions(app.crop.ratioValue(s)).h}。生成期间可以继续剪辑。`}</span>
        </div>
        <div className="signpost">可先切到别处 · 任务在后台跑，这里和后台任务页都能回来。</div>
        <div className="flowcta"><Btn variant="secondary" onClick={() => app.crop.cancel(ctx.proj.id)}>{analyzing ? '取消分析' : '取消生成'}</Btn></div>
      </div>
    );
  }

  /* ---------- 完成 ---------- */
  function CropDone({ctx, s, onBack}) {
    const app = useApp();
    const proj = ctx.proj.id;
    const out = ctx.sources.video.find((v) => v.id === s.output);
    if (!out) return <CropSetup ctx={ctx} s={s} onBack={onBack} />;
    const group = window.BC_VIDEO_REPLACE.replaceGroup({elements: ctx.elements, docs: ctx.elDocs, sources: ctx.sources.video, output: out,
      canvasRatio: window.BC_LAYOUT.ratioValue(ctx.ratio)});
    const dims = C.dimensions(out.crop.ratio);
    return (
      <div className="pscroll bc-scroll">
        <div className="flowh"><IconBtn icon="back" size="s" tip="返回" onClick={onBack} /><b>智能裁剪</b><Chip tone="positive">已生成</Chip></div>
        <div className="aplbar">
          <div className="aplbar__msg"><Ic n="ok" className="ic--16" style={{color: 'var(--green-1000)'}} />
            <b>已生成 {out.name} · {C.mmss(out.dur)} · {dims.w} × {dims.h} · 本机 {C.tookText(out.crop.took)}</b></div>
        </div>
        <div className="cr-outprev" style={out.crop.ratio < 1 ? {aspectRatio: `${dims.w} / ${dims.h}`, height: 300, width: 'auto'} : {aspectRatio: `${dims.w} / ${dims.h}`}}>
          <window.CropVideo source={out} el={{start: 0, end: out.dur, srcStart: 0, rate: 1}} ctx={{playT: Math.min(out.dur - 0.01, 12), playing: false, setPlaying() {}}} fillH />
        </div>
        <div className="hint">和原片按时间对齐 · 已进素材库。原片没动。</div>

        <SecHead>接下来</SecHead>
        <div className="sec cr-next">
          <BCAction className="drill" onClick={() => ctx.replaceWithOutput(out.id)}>
            <span className="ic2"><Ic n="refresh" className="ic--16" /></span>
            <span className="tt"><b>替换时间轴上的视频…</b><span>{group.replaced.length ? `换掉用这段原片的 ${group.replaced.length} 段 · 剪口和字幕不用重做${group.ratioDiffers ? ' · 可选一起把画幅改为 ' + out.crop.ratioId : ''}` : '时间轴上没有用这段原片的片段'}</span></span>
            <NavChevron style={{color: 'var(--gray-500)'}} />
          </BCAction>
          <BCAction className="drill" onClick={() => { const el = window.BC_MEDIA.placement('video-' + ctx.nextSeq(), 'video', out, ctx.playT); if (el) { ctx.addElement(el); app.toast('已添加到画布和时间轴', 'positive'); } }}>
            <span className="ic2"><Ic n="plus" className="ic--16" /></span>
            <span className="tt"><b>放到时间轴</b><span>作为一段新视频放在播放头处，原有片段不动</span></span>
            <NavChevron style={{color: 'var(--gray-500)'}} />
          </BCAction>
          <BCAction className="drill" onClick={() => app.crop.revise(proj)}>
            <span className="ic2"><Ic n="tune" className="ic--16" /></span>
            <span className="tt"><b>再调整构图</b><span>回到检查页改镜头或关键帧，另存第 {(out.crop.version || 1) + 1} 版</span></span>
            <NavChevron style={{color: 'var(--gray-500)'}} />
          </BCAction>
          <BCAction className="drill" onClick={() => { ctx.setTab('video'); ctx.setPaneView(null); }}>
            <span className="ic2"><Ic n="folder" className="ic--16" /></span>
            <span className="tt"><b>在 Video 里查看</b><span>和别的素材一样预览、放置或移除</span></span>
            <NavChevron style={{color: 'var(--gray-500)'}} />
          </BCAction>
        </div>
        <div className="flowcta"><Btn variant="secondary" onClick={() => { app.crop.restart(proj); }}>再裁一段</Btn></div>
      </div>
    );
  }

  function CropPanel({ctx, onBack}) {
    const app = useApp();
    const s = app.crop.sessions[ctx.proj.id];
    const back = () => { app.crop.close(ctx.proj.id); if (onBack) onBack(); };
    if (!s) return null;
    if (s.phase === 'setup') return <CropSetup ctx={ctx} s={s} onBack={back} />;
    if (s.phase === 'analyzing' || s.phase === 'rendering') return <CropRunning ctx={ctx} s={s} onBack={back} />;
    if (s.phase === 'review') return <window.CropReviewPanel ctx={ctx} s={s} onBack={back} />;
    return <CropDone ctx={ctx} s={s} onBack={back} />;
  }

  /* AI 工具列表里那一行的副标题：会话没开着也能看见它到哪一步了。 */
  function cropListStatus(app, projId, fallback) {
    const s = app.crop.sessions[projId];
    if (!s || s.phase === 'setup') return fallback;
    const task = app.tasks.find((t) => t.id === s.taskId);
    if (s.phase === 'analyzing') return `正在分析 ${s.source.name} · ${task ? task.pct || 0 : 0}%`;
    if (s.phase === 'rendering') return `正在生成 ${app.crop.ratioIdOf(s)} 视频 · ${task ? task.pct || 0 : 0}%`;
    if (s.phase === 'review') return `${s.source.name} → ${app.crop.ratioIdOf(s)} · 等你检查构图`;
    return `${s.source.name} → ${app.crop.ratioIdOf(s)} · 已生成`;
  }

  Object.assign(window, {CropPanel, cropListStatus});
})();
