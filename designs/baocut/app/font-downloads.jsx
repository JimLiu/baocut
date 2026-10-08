/* 打开视频时的字体条与导出面板里的字体提示（product-design §5.9「字体」；architecture-design §9.1、§9.11）。
   ============================================================================
   **字体条**（`FontOpenStrip`）：编辑器舞台上方一条，整部视频只有这一处说字体下载的事，
   不逐个弹 toast。打开视频时，用到的族里还没下载的按设置开始下载（一个一个下）：

     进行中   「正在下载这个视频用到的字体 · 1/2 · Ma Shan Zheng 42%」＋ 细进度条
              ＋「跳过这个」（这个族先用回退字体，接着下一个）＋ ✕（全部取消）
     全到了   「这个视频用到的 2 个字体已就绪」，3 秒后自己收起
     没取到   「1 个字体没取到，正在用回退字体显示」＋「查看」：展开是 族 → 回退字体 · 原因，每个可以重试；✕ 收起
     自动下载关着  「这个视频用到 2 个没下载的字体，正在用回退字体显示」＋「下载」＋「设置」＋ ✕

   这期间画面照回退字体画，下载好的族到了就换上（真实应用：预览拿到字体后重画这一帧）。
   **导出提示**（`ExportFontNote`）：导出面板视频页里一两行，说清哪些族还在下载（导出先等）、
   哪些没取到（用什么代替），带重试 / 下载。
   两者只在有按需下载的表面画（`BC_SURFACE.fontDownloads`）。
   ============================================================================ */
(function () {
  const {useState, useEffect} = React;
  const L = window.BC_FONTLIB;

  function FontOpenStrip({projectId}) {
    const app = useApp();
    const lib = window.useFontLibrary();
    const S = window.BC_FONTSTORE;
    const [open, setOpen] = useState(false);
    useEffect(() => {
      if (!window.BC_SURFACE.fontDownloads) return undefined;
      S.openVideo(projectId);
      return () => S.leaveVideo(projectId);
    }, [projectId]);
    const strip = window.BC_SURFACE.fontDownloads && lib.open && lib.open.projectId === projectId ? L.openStrip(lib.open, lib.byName) : null;
    const kind = strip && strip.kind;
    useEffect(() => {
      if (kind !== 'ready') return undefined;
      const t = setTimeout(() => S.dismissOpen(), 3000);
      return () => clearTimeout(t);
    }, [kind]);
    if (!strip) return null;
    const goSettings = () => app.go({r: 'settings', sec: 'fonts'});
    return (
      <div className={cx('fontstrip', 'fontstrip--' + strip.kind)} role="status" aria-live="polite">
        <div className="fontstrip__line">
          <Ic n={strip.kind === 'ready' ? 'check' : strip.kind === 'running' ? 'download' : 'alert'} className="ic--16" />
          <span className="fontstrip__text grow">
            {strip.title}
            {strip.kind === 'running' ? <span className="fontstrip__meta"> · {strip.count} · {strip.current} <span className="t-mono">{strip.progress}</span></span> : null}
          </span>
          {strip.kind === 'running' ? <>
            <Btn variant="quiet" size="s" onClick={() => S.skipCurrent()}>跳过这个</Btn>
            <IconBtn icon="close" size="s" tip="全部取消 · 先用回退字体显示" onClick={() => S.cancelOpen()} />
          </> : null}
          {strip.kind === 'missed' ? <>
            <Btn variant="quiet" size="s" onClick={() => setOpen((v) => !v)}>{open ? '收起' : '查看'}</Btn>
            <IconBtn icon="close" size="s" tip="知道了" onClick={() => S.dismissOpen()} />
          </> : null}
          {strip.kind === 'off' ? <>
            <Btn variant="secondary" size="s" onClick={() => S.downloadOpen()}>下载</Btn>
            {window.BC_SURFACE.pages ? <Btn variant="quiet" size="s" onClick={goSettings}>设置</Btn> : null}
            <IconBtn icon="close" size="s" tip="知道了" onClick={() => S.dismissOpen()} />
          </> : null}
        </div>
        {strip.kind === 'running' ? <Progress value={strip.value || 0} indeterminate={strip.value == null} thin label="字体下载进度" className="fontstrip__bar" /> : null}
        {(strip.kind === 'missed' && open) || strip.kind === 'off' ? (
          <ul className="fontstrip__list">
            {strip.rows.map((r) => (
              <li key={r.family}>
                <b>{r.family}</b>
                <span className="t-detail">→ {r.fallback} · {r.reason}</span>
                {strip.kind === 'missed' ? <Btn variant="quiet" size="s" icon="refresh" onClick={() => S.download(r.family)}>重试</Btn> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  function ExportFontNote({projectId}) {
    const lib = window.useFontLibrary();
    const S = window.BC_FONTSTORE;
    if (!window.BC_SURFACE.fontDownloads) return null;
    const lines = L.exportNote(lib.list, S.inVideo(projectId), lib.auto);
    if (!lines.length) return null;
    return (
      <>
        {lines.map((l) => (
          <div key={l.tone + l.families.join()} className={cx('xnote', 'fontlib__xnote', l.tone === 'notice' && 'fontlib__xnote--notice')}>
            <Ic n={l.tone === 'notice' ? 'alert' : 'download'} className="ic--14" />
            <span className="grow">{l.text}</span>
            {l.action ? <BCAction type="button" className="xlink" onClick={() => l.families.forEach((n) => S.download(n))}>{l.action}</BCAction> : null}
          </div>
        ))}
      </>
    );
  }

  Object.assign(window, {FontOpenStrip, ExportFontNote});
})();
