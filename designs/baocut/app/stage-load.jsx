/* 预览还没出画面时的舞台（产品设计 §5.1「预览载入与卡住」）：载入中是一块安静的载入态；媒体要先转换才能播放时
   是「正在准备预览 · N%」与进度条，点名在转哪个媒体；卡住了是画面正中一张卡，说卡在哪一步、给「重试」。判据与文案全在 `BC_STAGE_LOAD`（model-stage-load.js）；这里只按它排一次计时器、
   把结论画出来。挂在 `.frame` 上，盖住演示画面（产品里此刻画布上什么都没有）。 */
(function () {
  const {useState} = React;
  const R = window.RSP;

  /* 盖住画面时整块接住指针：按下、点击、双击、右键都不再冒泡到 `.frame`（框选）与 `.stage`（点空白清选中），
     底下看不见的元素也就点不中。「重试」按钮在卡片里，先于这里处理，照常可点。 */
  const swallow = (ev) => ev.stopPropagation();
  const block = {onMouseDown: swallow, onPointerDown: swallow, onClick: swallow, onDoubleClick: swallow, onContextMenu: swallow};

  function StageLoadNotice({proj}) {
    const app = useApp();
    const X = window.BC_STAGE_LOAD;
    const d = app.stageLoadDemo;
    const [, wake] = useState(0);
    React.useEffect(() => {
      const w = X.waitMs(d, Date.now());
      if (w == null) return undefined;
      const id = setTimeout(() => wake((n) => n + 1), w);
      return () => clearTimeout(id);
    });
    const src = proj && proj.src;
    const names = {media: src ? window.BC_STAGE_MEDIA.fileName(src.name || src.path) : null};
    const n = X.notice(d, Date.now(), names, 'zh');
    if (!n) return null;
    if (n.kind === 'preparing') {
      return (
        <div className="stageload" role="status" aria-label={n.label} {...block}>
          <div className="stageload__prep">
            <div className="stageload__prept">{n.label}</div>
            <R.ProgressBar size="S" staticColor="white" value={n.pct == null ? 0 : n.pct} isIndeterminate={n.pct == null}
              aria-label={n.label} UNSAFE_className="stageload__bar" />
            <div className="stageload__step">{n.detail}</div>
            <div>{n.body}</div>
          </div>
        </div>
      );
    }
    if (n.kind === 'loading') {
      return (
        <div className="stageload" role="status" aria-label={n.label} {...block}>
          {n.spinner ? (
            <div className="stageload__busy">
              <R.ProgressCircle size="S" isIndeterminate staticColor="white" aria-label={n.label} />
              <span>{n.label}</span>
            </div>
          ) : null}
        </div>
      );
    }
    return (
      <div className="stageload" role="alert" {...block}>
        <div className="stageload__card">
          <div className="stageload__t"><Ic n="alert" className="ic--16" />{n.title}</div>
          <div className="stageload__step">{n.detail}</div>
          <div className="stageload__body">{n.body}</div>
          <div className="stageload__act">
            <Btn size="s" variant="secondary" onClick={() => app.setStageLoadDemo(X.demo('retrying', Date.now()))}>{n.retry}</Btn>
          </div>
        </div>
      </div>
    );
  }

  Object.assign(window, {StageLoadNotice});
})();
