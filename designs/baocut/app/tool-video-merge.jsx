/* 工具 › 合并视频 —— §17.5（2026-09-16）。
   把几段视频按顺序首尾接成一个文件。交互照剪辑工具里那一套通行做法：一列可以拖着
   排序的片段、一条说清「能不能不重新编码」的横幅、两个方式（快速 / 重新编码）。
   ffmpeg 卡、任务队列、结果与失败卡、页面外壳（三个动作切换、保存位置）都从 tool-video.jsx 拿，这里只管这一页的表单。
   2026-10-06（product-design §2.7「视频文件」）：片段也能从 Space 里的视频文件条目添加；结果是保存位置里的文件、Space 里的视频文件条目。
   兼容性判定与两条路的参数在 model-video.js（BC_VIDEO.analyze / mergePlan）。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const V = window.BC_VIDEO;

  /** 一段片段：序号、名字、规格，右边是上移 / 下移 / 移出。
   *  `bad` = 这一段里没有画面（纯音频文件被拖进来了），整行标出来。 */
  function ClipRow({c, index, total, mismatch, onMove, onDrop, onDragStart, onDragOver, dragging}) {
    const bad = !c.width || !c.height;
    return (
      <div className={cx('vclip', bad && 'is-bad', dragging && 'is-dragging')} draggable
        onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDrop}>
        <span className="vclip__n t-mono">{index + 1}</span>
        <Ic n="drag" className="ic--14 vclip__grip" />
        <span className="vclip__txt">
          <b className="t-title-sm t-truncate">{c.name}</b>
          <span className={cx('t-detail-xs', mismatch && 'vclip__off')}>
            {bad ? '这个文件里没有画面' : V.sourceLine(c)}
          </span>
        </span>
        <IconBtn icon="chevup" size="s" tip="上移" disabled={index === 0} onClick={() => onMove(-1)} />
        <IconBtn icon="chevdown" size="s" tip="下移" disabled={index === total - 1} onClick={() => onMove(1)} />
        <IconBtn icon="close" size="s" tip="移出" onClick={() => onMove(0)} />
      </div>
    );
  }

  /** 兼容性横幅：能拷流就一句话，不能就把对不上的每一项列出来。
   *  这是这一页最要紧的一块——「为什么这次要重新编码」必须当场说清，
   *  而不是等用户发现跑了十分钟才反应过来。 */
  function CompatBanner({banner, mode}) {
    return (
      <div className={cx('vcompat', 'vcompat--' + banner.tone)}>
        <Ic n={banner.tone === 'positive' ? 'ok' : 'info'} className="ic--16 vcompat__ic" />
        <div className="vcompat__txt">
          <b className="t-title-sm">{banner.title}</b>
          <span className="t-detail">{banner.line}</span>
          {banner.mismatches.length ? (
            <ul className="vcompat__list">
              {banner.mismatches.map((m) => <li key={m} className="t-detail-xs">{m}</li>)}
            </ul>
          ) : null}
          {mode === 'fast' && banner.tone !== 'positive' ? (
            <span className="t-detail-xs">选的是「快速合并」，但这几段接不上，会自动改成重新编码。</span>
          ) : null}
        </div>
      </div>
    );
  }

  function MergeToolPage() {
    const app = useApp();
    const s = window.useVideoStore();
    const Q = window.BC_VIDEO_QUEUE;
    const save = window.BC_TOOL_FRAME.useSaveDir();
    const [clips, setClips] = useState(window.videoMergeDraft().clips || []);
    const [f, setF] = useState(window.videoMergeDraft().form || V.blankMerge());
    const [advanced, setAdvanced] = useState(false);
    const [tried, setTried] = useState(false);
    const [drag, setDrag] = useState(null);
    const input = useRef(null);
    const goRef = useRef(null);
    const set = (p) => setF((cur) => Object.assign({}, cur, p));
    useEffect(() => { window.videoMergeDraft({clips, form: f}); }, [clips, f]);
    Q.useCmdEnter(goRef);
    /* 「接着用工具」/ Space 查看器带来的视频文件加成一段；「再做一次」带回片段与设置 */
    useEffect(() => {
      const p = app.takeToolPreset('merge');
      if (p && p.params && p.params.clips) { setClips(p.params.clips.slice()); if (p.params.form) setF(Object.assign(V.blankMerge(), p.params.form)); }
      else if (p && p.entry) setClips((cur) => cur.concat([window.BC_TOOL_EXTRACT.fromEntry(p.entry)]));
    }, [app.toolPreset]);

    const st = V.ffmpegState(s.env);
    const ready = st.stage === 'ready' || st.stage === 'update';
    const gate = Q.ffmpegGate(st);
    const errs = V.mergeProblems(f, clips, s.caps);
    const banner = V.compatBanner(f, clips);
    const raw = clips.length >= 2 ? V.mergePlan(f, clips, s.caps, 'clips.txt', `合并-${String(s.list.length + 1).padStart(3, '0')}.mp4`) : null;
    const plan = raw && !raw.error ? raw : null;
    const compat = clips.length ? V.analyze(clips) : null;
    const summary = plan
      ? `${plan.mode === 'fast' ? '快速合并' : '重新编码'} · ${V.humanDuration(compat.seconds || 0)} · ${V.fmtRes(compat.width, compat.height)}`
        + `${plan.estimatedBytes ? ` · 约 ${V.humanBytes(plan.estimatedBytes)}` : ''}`
      : (errs[0] || '至少要两段视频');
    // 哪些片段与目标规格不一样：那几行的规格用橙色标出来，不用用户自己对照。
    const off = (c) => !!compat && !compat.canCopy && (c.width !== compat.width || c.height !== compat.height);

    const add = (files) => Promise.all(files.map(window.videoProbeFile)).then((probed) => setClips((cur) => cur.concat(probed)));
    const move = (index, delta) => setClips((cur) => (delta === 0
      ? cur.filter((_, i) => i !== index)
      : V.reorder(cur, index, delta)));

    const go = () => {
      setTried(true);
      if (!ready) { app.toast(st.stage === 'missing' ? '先装 ffmpeg' : 'ffmpeg 还不能用'); return; }
      if (errs.length) { app.toast(errs[0]); return; }
      const rec = window.videoEnqueue(app, 'merge', {clips, form: f, plan}, save.dir);
      if (plan.fellBack) app.toast(`${rec.name} 要重新编码：${banner.mismatches[0]}`);
    };
    goRef.current = go;
    // 「合并视频」在吸顶导航栏右端（2026-09-24，Page 的 bar；此前是左栏末尾吸底的 .vw__go）
    const status = gate || summary;
    const bar = (<>
      <span className={cx('t-detail pagenav__note', gate || (tried && errs.length) ? 'vw__err' : null)} title={status}>{status}</span>
      <span className="t-detail-xs t-mono pagenav__hint">⌘↵</span>
      <Btn variant="accent" icon="layers" disabled={!ready} onClick={go}>合并视频</Btn>
    </>);
    const reuse = (r) => {
      if (r.kind !== 'merge') { app.go({r: 'tools', id: r.kind}); return; }
      setClips(r.clips.slice()); setF(Object.assign({}, r.form));
      app.toast(`已带回 ${r.name} 的片段与设置`);
    };
    const fix = (k, r) => {
      if (r.kind === 'extract') { app.go({r: 'tools', id: 'extract'}); return; }
      if (k === 'relocateInput') { input.current.click(); return; }
      if (k === 'switchToH264') { set({codec: 'h264'}); s.setOutcome('ok'); app.toast('已换成 H.264，按「合并视频」再试'); return; }
      if (k === 'switchToQualityEncoder') { set({accel: 'quality'}); s.setOutcome('ok'); app.toast('已换成画质优先，按「合并视频」再试'); return; }
      if (k === 'retry') { s.setOutcome('ok'); window.videoRequeue(app, r); return; }
      if (k === 'setupFfmpeg' || k === 'updateFfmpeg') { s.setEnv(k === 'setupFfmpeg' ? 'missing' : 'update'); app.toast('上面那张卡里可以装 / 升 ffmpeg'); return; }
      app.toast(V.FIXES[k].label + ' · 交互演示到这里');
    };

    return (
      <window.VideoToolShell tool="merge" title="合并视频" bar={bar} s={s} save={save} onReuse={reuse} onFix={fix}>

            <section className="vw__sec">
              <div className="vw__sechd">
                <span className="t-section grow">片段 · 按这个顺序首尾相接</span>
                {clips.length ? <BCAction className="viewall" onClick={() => setClips([])}>全部移出</BCAction> : null}
                {clips.length ? <BCAction className="viewall" onClick={() => input.current.click()}>添加视频…</BCAction> : null}
              </div>
              <window.VideoSpacePick tool="merge" onPick={(src) => setClips((cur) => cur.concat([src]))} label="从 Space 里添加视频文件…" />
              {clips.length ? (
                <>
                  <div className="vclips">
                    {clips.map((c, i) => (
                      <ClipRow key={c.name + i} c={c} index={i} total={clips.length} mismatch={off(c)}
                        dragging={drag === i}
                        onMove={(d) => move(i, d)}
                        onDragStart={() => setDrag(i)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          if (drag == null || drag === i) return;
                          setClips((cur) => V.reorder(cur, drag, i - drag));
                          setDrag(i);
                        }}
                        onDrop={() => setDrag(null)} />
                    ))}
                  </div>
                  <span className="t-detail-xs">
                    {clips.length} 段 · 合起来 {V.humanDuration((compat && compat.seconds) || 0)}
                    {' · 源文件共 '}{V.humanBytes((compat && compat.bytes) || 0)}
                    {' · 拖着这一列换顺序，或者用行尾的上下箭头。'}
                  </span>
                </>
              ) : (
                <window.VideoDropZone icon="layers" onFiles={add} multiple
                  title="把要接起来的视频拖进来"
                  sub="至少两段。按这里的顺序首尾相接，之后还能拖着换顺序。" />
              )}
              <input ref={input} type="file" accept={window.VIDEO_ACCEPT} multiple hidden
                onChange={(e) => { const files = Array.prototype.slice.call(e.target.files); e.target.value = ''; if (files.length) add(files); }} />
            </section>

            {banner ? <CompatBanner banner={banner} mode={f.mode} /> : null}

            <section className="vw__sec">
              <div className="vw__sechd">
                <span className="t-section grow">怎么接</span>
                <Segmented size="s" value={f.mode} onChange={(k) => set({mode: k})}
                  items={V.MERGE_MODES.map((m) => ({k: m.k, label: m.name}))} />
              </div>
              <span className="t-detail">{(V.MERGE_MODES.find((m) => m.k === f.mode) || {}).sub}</span>
              {plan && plan.mode === 'reencode' ? (
                <>
                  <div className="vw__sechd">
                    <span className="t-section grow">重新编码的设置</span>
                    <BCAction className="viewall" onClick={() => setAdvanced((v) => !v)}>{advanced ? '收起' : '展开'}</BCAction>
                  </div>
                  {advanced ? (
                    <>
                      <div className="vw__row">
                        <span className="vw__lab">画质</span>
                        <Segmented size="s" value={f.quality} onChange={(k) => set({quality: k})}
                          items={V.QUALITIES.map((q) => ({k: q.k, label: q.name}))} />
                        <span className="t-detail-xs grow">合并默认用高画质：接起来之后往往还要再剪。</span>
                      </div>
                      <div className="vw__row">
                        <span className="vw__lab">编码</span>
                        <Segmented size="s" value={f.codec} onChange={(k) => set({codec: k})}
                          items={V.CODECS.map((c) => ({k: c.k, label: c.name}))} />
                        <span className="t-detail-xs grow">{(V.CODECS.find((c) => c.k === f.codec) || {}).sub}</span>
                      </div>
                      <div className="vw__row">
                        <span className="vw__lab">编码方式</span>
                        <Segmented size="s" value={f.accel} onChange={(k) => set({accel: k})}
                          items={V.ACCELS.map((a) => ({k: a.k, label: a.name}))} />
                        <span className="t-detail-xs grow">{(V.ACCELS.find((a) => a.k === f.accel) || {}).sub}</span>
                      </div>
                    </>
                  ) : (
                    <span className="t-detail">
                      {(V.QUALITIES.find((q) => q.k === f.quality) || {}).name}
                      {' · '}{(V.CODECS.find((c) => c.k === f.codec) || {}).name}
                      {' · '}{(V.ACCELS.find((a) => a.k === f.accel) || {}).name}
                    </span>
                  )}
                </>
              ) : null}
              {plan && plan.silent && plan.silent.length ? (
                <div className="hint">
                  第 {plan.silent.map((i) => i + 1).join('、')} 段没有声音，那几段会各配一段同样长的静音——
                  不这么做的话，整片从那一段起就没声音了。
                </div>
              ) : null}
            </section>

      </window.VideoToolShell>
    );
  }

  Object.assign(window, {MergeToolPage});
})();
