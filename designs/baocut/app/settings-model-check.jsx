/* 设置 › 本地模型：行上那一条健康状态，与试用面板里的提醒 / 失败块（2026-10-05）。
   说法与动作全在 BC_LOCALCHECK（model-local-check.js），这里只画。
   - ModelCheckLine：检查中（阶段 + 进度 + 取消）/ N 分钟前检查通过 / 没通过（红色一句 + 修复… / 重新检查 / 详情）。
   - ModelTryNote：试听 / 试画里的提醒与失败，同一套「哪里不对 · 怎么办 · 按钮」。 */
(function () {
  const {useState} = React;
  const CK = window.BC_LOCALCHECK;

  function Actions({actions, onAction, detailsOpen}) {
    if (!actions || !actions.length) return null;
    return (
      <span className="lmchk__acts">
        {actions.map((a) => (
          <Btn key={a.k} size="s" variant={a.primary ? 'secondary' : 'quiet'} aria-expanded={a.k === 'details' ? !!detailsOpen : undefined}
            onClick={() => onAction(a.k)}>
            {a.k === 'details' && detailsOpen ? CK.LABEL.hideDetails : a.label}
          </Btn>
        ))}
      </span>
    );
  }

  /** 行上的健康状态。st 见 BC_LOCALCHECK.lineView；onAction(k) 收 cancel / repair / recheck。 */
  function ModelCheckLine({st, cat, m, onAction}) {
    const app = useApp();
    const [open, setOpen] = useState(false);
    const now = Date.now();
    const v = CK.lineView(st, cat, now);
    if (!v) return null;
    const act = (k) => {
      if (k === 'details') { setOpen((x) => !x); return; }
      setOpen(false);
      onAction(k);
    };
    const lines = open ? CK.detailLines(st, m, now) : [];
    return (
      <div className={cx('lmchk', 'is-' + v.tone)} role="status" aria-live="polite">
        <div className="lmchk__line">
          {v.tone === 'running' ? null : <Ic n={v.tone === 'passed' ? 'ok' : 'alert'} className="ic--16 lmchk__ic" />}
          <span className="lmchk__txt">
            {v.head ? <b>{v.head}{v.tone === 'failed' ? '：' : ''}</b> : null}
            {v.tone === 'running' ? <span className="lmchk__phase">{v.text}</span> : v.text}
            {v.todo ? <span className="lmchk__todo">{v.todo}</span> : null}
          </span>
          {v.tone === 'running' ? <span className="lmchk__pg"><Progress value={v.pct} thin label={v.head} /></span> : null}
          <Actions actions={v.actions} onAction={act} detailsOpen={open} />
        </div>
        {lines.length ? (
          <div className="lmchk__dl">
            {lines.map((l) => <span key={l} className="t-mono t-detail-xs">{l}</span>)}
            <span><Btn size="s" variant="quiet" icon="copy" onClick={() => { copyToClipboard(lines.join('\n')); app.toast('已复制技术详情'); }}>{CK.LABEL.copy}</Btn></span>
          </div>
        ) : null}
      </div>
    );
  }

  /** 试用面板里的一块：view = BC_LOCALCHECK.tryNotice / tryFailure 的返回；onAction(k)。 */
  function ModelTryNote({view, onAction, className}) {
    if (!view) return null;
    return (
      <div className={cx('lmtry', className)} role="alert">
        <Ic n="alert" className="ic--16 lmchk__ic" />
        <div className="lmtry__body">
          <span className="lmtry__txt">{view.text}{view.todo ? '。' : ''}{view.todo ? <span className="lmchk__todo">{view.todo}</span> : null}</span>
          <Actions actions={view.actions} onAction={onAction} />
        </div>
      </div>
    );
  }

  Object.assign(window, {ModelCheckLine, ModelTryNote});
})();
