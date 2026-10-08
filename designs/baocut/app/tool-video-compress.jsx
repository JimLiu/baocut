/* 工具 › 视频文件 › 压缩（§17.5，2026-09-16；product-design §2.7「视频文件」）。从 tool-video.jsx 拆出。
   源文件来自本机或 Space 里的视频文件条目；压到多小按画质或按体积，规则、命令与数字全部来自 model-video.js（BC_VIDEO）。
   页面外壳、队列与保存位置在 tool-video.jsx（VideoToolShell）。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const V = window.BC_VIDEO;
  const Q = window.BC_VIDEO_QUEUE;
  const store = Q.store;

  function SourceRow({src, onClear, onPick}) {
    return (
      <div className="vsrc">
        <span className="vsrc__ic"><Ic n="film" className="ic--22" /></span>
        <span className="vsrc__txt">
          <b className="t-title-sm t-truncate">{src.name}</b>
          <span className="t-detail-xs">{V.sourceLine(src)}</span>
        </span>
        <Btn variant="quiet" size="s" onClick={onPick}>换一个</Btn>
        <IconBtn icon="close" size="s" tip="移出" onClick={onClear} />
      </div>
    );
  }

  function CompressToolPage() {
    const app = useApp();
    const s = window.useVideoStore();
    const save = window.BC_TOOL_FRAME.useSaveDir();
    const [src, setSrc] = useState(store.drafts.src || null);
    const [f, setF] = useState(store.drafts.compress || V.blankCompress());
    const [advanced, setAdvanced] = useState(false);
    const [tried, setTried] = useState(false);
    const set = (p) => setF((cur) => Object.assign({}, cur, p));
    const input = useRef(null);
    const goRef = useRef(null);
    useEffect(() => { store.drafts.compress = f; store.drafts.src = src; }, [f, src]);
    Q.useCmdEnter(goRef);
    /* 「接着用工具」/ Space 查看器带来的视频文件，或「再做一次」带回的参数 */
    useEffect(() => {
      const p = app.takeToolPreset('compress');
      if (p && p.params) { if (p.params.src) setSrc(p.params.src); if (p.params.form) setF(Object.assign(V.blankCompress(), p.params.form)); }
      else if (p && p.entry) setSrc(window.BC_TOOL_EXTRACT.fromEntry(p.entry));
    }, [app.toolPreset]);

    const st = V.ffmpegState(s.env);
    const ready = st.stage === 'ready' || st.stage === 'update';
    // ffmpeg 还没准备好时，导航栏上不要报「这份 ffmpeg 不带 H.264」——该说的是「先去下面那张卡里装」。
    const gate = Q.ffmpegGate(st);
    const errs = V.compressProblems(f, src, s.caps);
    const line = src ? V.estimateLine(f, src, s.caps) : null;
    const pick = (files) => window.videoProbeFile(files[0]).then(setSrc);

    const go = () => {
      setTried(true);
      if (!ready) { app.toast(st.stage === 'missing' ? '先装 ffmpeg' : 'ffmpeg 还不能用'); return; }
      if (errs.length) { app.toast(errs[0]); return; }
      window.videoEnqueue(app, 'compress', {src, form: f, plan: V.compressPlan(f, src, s.caps, src.path, V.outputName(src.name, 'compressed'))}, save.dir);
    };
    goRef.current = go;
    // 「压缩视频」在吸顶导航栏右端（2026-09-24，Page 的 bar；此前是左栏末尾吸底的 .vw__go）
    const status = gate || (tried && errs.length ? errs[0] : line ? line.text : '先选一个视频文件');
    const bar = (<>
      <span className={cx('t-detail pagenav__note', gate || (line && line.bad) || (tried && errs.length) ? 'vw__err' : null)} title={status}>{status}</span>
      <span className="t-detail-xs t-mono pagenav__hint">⌘↵</span>
      <Btn variant="accent" icon="film" disabled={!ready} onClick={go}>压缩视频</Btn>
    </>);
    const reuse = (r) => {
      if (r.kind !== 'compress') { app.go({r: 'tools', id: r.kind}); return; }
      setSrc(r.source); setF(Object.assign({}, r.form));
      app.toast(`已带回 ${r.name} 的设置`);
    };
    const fix = (k, r) => {
      if (r.kind === 'extract') { app.go({r: 'tools', id: 'extract'}); return; }
      if (k === 'relocateInput') { input.current.click(); return; }
      if (k === 'switchToH264') { setF(Object.assign({}, r.form, {codec: 'h264'})); s.setOutcome('ok'); app.toast('已换成 H.264，按「压缩视频」再试'); return; }
      if (k === 'switchToQualityEncoder') { setF(Object.assign({}, r.form, {accel: 'quality'})); s.setOutcome('ok'); app.toast('已换成画质优先，按「压缩视频」再试'); return; }
      if (k === 'lowerResolution') { setF(Object.assign({}, r.form, {resolution: r.form.resolution === 'original' ? '1080p' : '720p'})); s.setOutcome('ok'); app.toast('已降一档分辨率，按「压缩视频」再试'); return; }
      if (k === 'retry') { s.setOutcome('ok'); window.videoRequeue(app, r); return; }
      if (k === 'setupFfmpeg' || k === 'updateFfmpeg') { s.setEnv(k === 'setupFfmpeg' ? 'missing' : 'update'); app.toast('上面那张卡里可以装 / 升 ffmpeg'); return; }
      app.toast(V.FIXES[k].label + ' · 交互演示到这里');
    };

    return (
      <window.VideoToolShell tool="compress" title="压缩视频" bar={bar} s={s} save={save} onReuse={reuse} onFix={fix}>
            <section className="vw__sec">
              {src
                ? <SourceRow src={src} onClear={() => setSrc(null)} onPick={() => input.current.click()} />
                : <window.VideoDropZone onFiles={pick} title="把视频拖进来" sub="或者从电脑里选一个。支持 mp4 / mov / mkv / webm 等常见格式。" />}
              {src ? null : <window.VideoSpacePick tool="compress" onPick={setSrc} label="或者从 Space 里选一个视频文件…" />}
              <input ref={input} type="file" accept={window.VIDEO_ACCEPT} hidden
                onChange={(e) => { const files = e.target.files; e.target.value = ''; if (files[0]) pick([files[0]]); }} />
            </section>

            <section className="vw__sec">
              <div className="vw__sechd">
                <span className="t-section grow">压到多小</span>
                <Segmented size="s" value={f.target} onChange={(k) => set({target: k})}
                  items={[{k: 'quality', label: '按画质'}, {k: 'size', label: '按体积'}]} />
              </div>
              {f.target === 'quality' ? (
                <BCChoiceGroup className="vw__cards" value={f.quality} onChange={quality => set({quality})} aria-label="画质">
                  {V.QUALITIES.map((q) => (
                    <BCAction key={q.k} type="button" choiceKey={q.k}
                      className={cx('vcard', f.quality === q.k && 'is-on')} >
                      <b>{q.name}</b>
                      <span>{q.sub}</span>
                    </BCAction>
                  ))}
                </BCChoiceGroup>
              ) : (
                <>
                  <div className="vw__row">
                    <span className="vw__lab">目标</span>
                    <NumField value={f.megabytes} onChange={(v) => set({megabytes: v})} min={1} max={4096} step={5} digits={0} unit="MB" label="目标体积" />
                    <div className="vw__chips">
                      {V.SIZE_PRESETS.map((p) => (
                        <Chip key={p.mb} pill on={f.megabytes === p.mb} onClick={() => set({megabytes: p.mb})}>{p.label}</Chip>
                      ))}
                    </div>
                  </div>
                  <span className="t-detail-xs vw__indent">
                    单遍编码往目标压，误差几个百分点，会往下留 3% 余量。压完超了会给你一枚「再紧一点」。
                    {src ? ` 这个时长最小能压到约 ${V.minSizeText(src.seconds, f.audio)}。` : ''}
                  </span>
                </>
              )}
            </section>

            <section className="vw__sec">
              <div className="vw__sechd">
                <span className="t-section grow">更多设置</span>
                <BCAction className="viewall" onClick={() => setAdvanced((v) => !v)}>{advanced ? '收起' : '展开'}</BCAction>
              </div>
              {advanced ? (
                <>
                  <div className="vw__row">
                    <span className="vw__lab">分辨率</span>
                    <Segmented size="s" value={f.resolution} onChange={(k) => set({resolution: k})}
                      items={V.RES_CAPS.map((r) => ({k: r.k, label: r.name}))} />
                    <span className="t-detail-xs grow">按短边封顶，只往下缩；竖屏视频照样是竖的。</span>
                  </div>
                  <div className="vw__row">
                    <span className="vw__lab">帧率</span>
                    <Segmented size="s" value={f.fps} onChange={(k) => set({fps: k})}
                      items={V.FPS_CAPS.map((r) => ({k: r.k, label: r.name}))} />
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
                  <div className="vw__row">
                    <span className="vw__lab">声音</span>
                    <Checkbox on={f.audio === 'keep'} onChange={(v) => set({audio: v ? 'keep' : 'remove'})} label="保留音轨" />
                    <span className="t-detail-xs grow">
                      {f.target === 'size'
                        ? '按体积压时音轨一律重编成 128 kbps AAC——不然体积的分母不确定。'
                        : '已经是 AAC 就直接拷过去，不重新编码。'}
                    </span>
                  </div>
                </>
              ) : (
                <span className="t-detail">
                  {(V.RES_CAPS.find((r) => r.k === f.resolution) || {}).name} · {(V.FPS_CAPS.find((r) => r.k === f.fps) || {}).name}
                  {' · '}{(V.CODECS.find((c) => c.k === f.codec) || {}).name}
                  {' · '}{(V.ACCELS.find((a) => a.k === f.accel) || {}).name}
                  {' · '}{f.audio === 'keep' ? '保留音轨' : '去掉音轨'}
                </span>
              )}
            </section>

            {line && line.plan && line.plan.warnings.length ? (
              <div className="vw__warn">
                {line.plan.warnings.map((w) => <span key={w.k} className="t-detail-xs"><Ic n="info" className="ic--12" />{w.text}</span>)}
              </div>
            ) : null}

      </window.VideoToolShell>
    );
  }

  Object.assign(window, {CompressToolPage});
})();
