/* 分屏同框的视图层（docs/design/shorts-framing §8.3–§8.4，模型在 [model-panels.js](model-panels.js)）。
   ============================================================================
   元素文档带 `panels` 的视频（剪成短视频时多人全景的那几段）按格子画：
     · `PanelsPaint`：每一格裁到自己的矩形里，各画一份原片，按这一格的取景点铺满、放大。
     · `PanelsSelection`：选中框是整个画面，格子之间画一条接缝线、角上标「上 / 下」。在一格里拖动只挪这一格的取景点
       （碰到原片边缘就停、记一步历史），四个角没有把手：整件不能拖动、缩放。
     · `PanelsChip`：挂在画面左下角外面的小牌，写「分屏 · 2 格」与段号，ⓘ 说怎么改。
     · `PanelsSection`：属性面板的「版式」段，顶替「取景」段：一人 / 分屏、每格的放大与位置、互换上下、只留一格的人、套到整支。
     · `PanelsLayoutRow`：按原片取景的一人段在「取景」段下面多的那一行，把这一段改成分屏。
     · `subSeam` / `unseamSubs`：分屏段里开始的字幕挂到接缝上（画面与导出预览）、拖走时解开。
   ============================================================================ */
(function () {
  const {useState} = React;
  const PN = window.BC_PANELS;

  /** 这件视频的原片与画面宽高比（同 stage-framing.jsx `framingRatios`）。 */
  function ratiosOf(ctx, id) {
    const list = (ctx.sources && ctx.sources.video) || [];
    const e = (ctx.elements || []).find((x) => x.id === id) || {};
    const el = Object.assign({}, e, (ctx.elDocs || {})[id]);
    const sr = window.BC_CROP.sourceRatio(window.BC_VIDEO_REPLACE.sourceFor(el, list) || list[0]);
    return {src: sr, out: window.BC_LAYOUT.ratioValue(ctx.ratio, sr)};
  }

  /** 这一格里原片的盒，写成 CSS（格子的百分比）。 */
  function cellBox(panel, r) {
    const b = PN.boxIn(panel.focal, r.src, PN.cellRatio(panel.rect, r.out));
    return {left: (b.x - b.w / 2) * 100 + '%', top: (b.y - b.h / 2) * 100 + '%', width: b.w * 100 + '%', height: b.h * 100 + '%'};
  }

  /** 画面：每格一份原片内容（`children` 是一整幅原片的画法，铺满它所在的盒）。 */
  function PanelsPaint({ctx, id, panels, children}) {
    const r = ratiosOf(ctx, id);
    return (
      <span className="pnl" aria-hidden="true">
        {panels.map((p, i) => (
          <span key={i} className="pnl__cell" style={{left: p.rect.x + '%', top: p.rect.y + '%', width: p.rect.w + '%', height: p.rect.h + '%'}}>
            <span className="pnl__src" style={cellBox(p, r)}>{children}</span>
          </span>
        ))}
      </span>
    );
  }

  /** 写回一段的格子，记一步历史，可选 toast（带撤销）。 */
  function writePanels(ctx, id, panels, app, msg, extra) {
    if (ctx.history) ctx.history.begin();
    ctx.setElDoc(id, Object.assign({panels}, extra));
    if (ctx.history) ctx.history.commit('pose');
    if (app && msg) app.toast(msg, 'positive', {label: '撤销', undo: true, run: () => ctx.history.undo()});
  }

  /** 这支视频里别的分屏段（套到整支用）：格数相同的才算。 */
  function otherSplits(ctx, id, n) {
    return (ctx.elements || []).filter((e) => e.kind === 'video' && e.id !== id && !e.hidden
      && (((ctx.elDocs || {})[e.id] || {}).panels || []).length === n);
  }

  function PanelsWhy() {
    return (
      <div className="framewhy">
        <div className="framewhy__t">{PN.COPY.whyTitle}</div>
        <p>{PN.COPY.why}</p>
        <p className="framewhy__hint">{PN.COPY.how}</p>
      </div>
    );
  }

  /* ---------- 画布小牌 ---------- */
  function PanelsChip({el, ctx, panels, hit, frameRef}) {
    const SC = window.BC_SHORTS_CUT;
    const [open, setOpen] = useState(false);
    const frame = frameRef && frameRef.current;
    const root = frame && frame.parentElement;
    if (!root) return null;
    const stop = (ev) => ev.stopPropagation();
    return ReactDOM.createPortal(
      <div className={cx('shotchip', hit && 'is-hit')} onMouseDown={stop} onClick={stop}
        style={{left: frame.offsetLeft, top: Math.min(frame.offsetTop + frame.offsetHeight + 8, root.clientHeight - 40)}}>
        <span className="shotchip__mode" role="status">{hit || PN.COPY.mode(panels.length)}</span>
        <span className="framing-info">
          <IconBtn icon="info" size="s" tip={PN.COPY.whyTitle} onClick={() => setOpen((x) => !x)} />
          <Popover open={open} onClose={() => setOpen(false)} dir="up" align="left" width={280} label={PN.COPY.whyTitle}>
            <PanelsWhy />
          </Popover>
        </span>
        {ctx.composed && el.shot != null ? (
          <>
            <i className="shotchip__sep" />
            <span className="shotchip__t">{SC.shotBadge(el, ctx.tmap ? ctx.tmap.fold : null)}</span>
          </>
        ) : null}
      </div>, root);
  }

  /* ---------- 选中框 ----------
     盒是整个画面（stage-elements.jsx 给分屏的视频 x/y 50、w/h 100）。按下时看落在哪一格，之后的拖动只改那一格的取景点：
     往右拖人往右走 = 窗口往左挪，按这一格窗口的宽换算成取景点的变化。 */
  function PanelsSelection({kind, id, el, ctx, st, set, style, inner, children, onClick, onDoubleClick, frameRef, panels, noToolbar}) {
    const [dragging, setDragging] = useState(null);
    const [hit, setHit] = useState(null);
    const names = PN.names(panels.length);
    const startDrag = (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const frameEl = frameRef && frameRef.current;
      if (!frameEl) return;
      const fr = frameEl.getBoundingClientRect();
      const px = (e.clientX - fr.left) / fr.width * 100, py = (e.clientY - fr.top) / fr.height * 100;
      const i = panels.findIndex((p) => px >= p.rect.x && px <= p.rect.x + p.rect.w && py >= p.rect.y && py <= p.rect.y + p.rect.h);
      if (i < 0) return;
      const r = ratiosOf(ctx, id);
      const p0 = panels[i], w0 = PN.windowOf(p0.focal, r.src, PN.cellRatio(p0.rect, r.out));
      const cellW = fr.width * p0.rect.w / 100, cellH = fr.height * p0.rect.h / 100;
      const hist = ctx.history;
      if (hist) hist.begin();
      let moved = false;
      const move = (ev) => {
        const dx = ev.clientX - e.clientX, dy = ev.clientY - e.clientY;
        if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
        if (!moved) setDragging(i);
        moved = true;
        const left = w0.left - dx / cellW * w0.w, top = w0.top - dy / cellH * w0.h;
        const fx = w0.w < 1 - 1e-9 ? left / (1 - w0.w) : 0.5, fy = w0.h < 1 - 1e-9 ? top / (1 - w0.h) : 0.5;
        setHit(fx < 0 || fx > 1 || fy < 0 || fy > 1 ? PN.COPY.hit.edge : null);
        ctx.setElDoc(id, {panels: PN.withFocal(panels, i, {x: fx, y: fy})});
      };
      const up = () => {
        setDragging(null);
        window.setTimeout(() => setHit(null), 1600);
        if (hist) { if (moved) hist.commit('pose'); else hist.cancel(); }
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };
    return (
      <div className="selwrap" style={style} data-el={id}>
        <div className={cx('selbox', 'is-on', 'selbox--video', 'pnl-sel', dragging != null && 'is-drag')} style={inner}
          onMouseDown={startDrag} onClick={onClick} onDoubleClick={onDoubleClick} title={PN.COPY.dragTip}>
          {children}
          {panels.map((p, i) => (
            <span key={i} className={cx('pnl-sel__cell', dragging === i && 'is-drag')}
              style={{left: p.rect.x + '%', top: p.rect.y + '%', width: p.rect.w + '%', height: p.rect.h + '%'}}>
              <em className="pnl-sel__name">{names[i]}</em>
            </span>
          ))}
        </div>
        <PanelsChip el={el} ctx={ctx} panels={panels} hit={hit} frameRef={frameRef} />
        {noToolbar ? null : <window.Toolbar kind={kind} el={el} ctx={ctx} st={st} set={set} below yielding={dragging != null} clear={0} />}
      </div>
    );
  }

  /* ---------- 属性面板「版式」段 ---------- */
  function PanelsSection({ctx, id, disabled}) {
    const app = useApp();
    const doc = (ctx.elDocs || {})[id] || {};
    const panels = doc.panels;
    if (!panels || !panels.length) return null;
    const r = ratiosOf(ctx, id);
    const names = PN.names(panels.length);
    const others = otherSplits(ctx, id, panels.length);
    const live = (next) => { if (!disabled) ctx.setElDoc(id, {panels: next}); };
    const toSingle = () => writePanels(ctx, id, null, app, PN.COPY.toSingle);
    const solo = (i) => writePanels(ctx, id, null, app, PN.COPY.soloed(names[i]), {focal: PN.soloFrom(panels[i], r.src, r.out)});
    const applyAll = () => {
      if (ctx.history) ctx.history.begin();
      others.forEach((e) => ctx.setElDoc(e.id, {panels: PN.applyTo(panels, ctx.elDocs[e.id].panels)}));
      if (ctx.history) ctx.history.commit('pose');
      app.toast(PN.COPY.appliedAll(others.length + 1), 'positive', {label: '撤销', undo: true, run: () => ctx.history.undo()});
    };
    return (
      <>
        <SecHead aside={PN.COPY.mode(panels.length)}>{PN.COPY.section}</SecHead>
        <PRow label={PN.COPY.section}>
          <Segmented size="s" value="split" onChange={(v) => { if (v === 'single' && !disabled) toSingle(); }}
            items={[{k: 'single', label: PN.COPY.single}, {k: 'split', label: PN.COPY.split}]} />
        </PRow>
        {panels.map((p, i) => {
          const up = PN.upscaleOf(p, {width: 1920, height: 1920 / r.src}, {width: 1080, height: 1080 / r.out});
          return (
            <div key={i} className="pnl-row">
              <div className="pnl-row__head">
                <span className="pnl-row__name">{names[i]}</span>
                {up > PN.UPSCALE_WARN ? <span className="pnl-row__warn">{PN.COPY.upscaled}</span> : null}
              </div>
              <ValueRow label={PN.COPY.zoom} value={Math.round((p.focal.zoom || 1) * 100)} min={100} max={PN.MAX_ZOOM * 100} unit="%"
                onChange={(v) => live(PN.withFocal(panels, i, {zoom: v / 100}))} />
              <ValueRow label={PN.COPY.posX} value={Math.round(p.focal.x * 100)} min={0} max={100}
                onChange={(v) => live(PN.withFocal(panels, i, {x: v / 100}))} />
              <ValueRow label={PN.COPY.posY} value={Math.round(p.focal.y * 100)} min={0} max={100}
                onChange={(v) => live(PN.withFocal(panels, i, {y: v / 100}))} />
            </div>
          );
        })}
        <div className="pnl-acts">
          {panels.length === 2 ? (
            <Btn variant="secondary" size="s" disabled={disabled}
              onPress={() => writePanels(ctx, id, PN.swap(panels), app, PN.COPY.swapped)}>{PN.COPY.swap}</Btn>
          ) : null}
          {panels.map((p, i) => (
            <Btn key={i} variant="secondary" size="s" disabled={disabled} onPress={() => solo(i)}>{PN.COPY.solo(names[i])}</Btn>
          ))}
          {others.length ? (
            <Tip label={PN.COPY.applyAllTip} side="bottom">
              <Btn variant="quiet" size="s" disabled={disabled} onPress={applyAll}>{PN.COPY.applyAll}</Btn>
            </Tip>
          ) : null}
        </div>
        <div className="hint">{PN.COPY.how}</div>
      </>
    );
  }

  /** 一人段的「版式」一行（`FramingSection` 里）：改成分屏时用默认的两格，人还没对准，之后在格子里调。 */
  function PanelsLayoutRow({ctx, id, disabled}) {
    const app = useApp();
    return (
      <PRow label={PN.COPY.section}>
        <Segmented size="s" value="single"
          onChange={(v) => { if (v === 'split' && !disabled) writePanels(ctx, id, PN.defaultPanels(), app, PN.COPY.toSplit); }}
          items={[{k: 'single', label: PN.COPY.single}, {k: 'split', label: PN.COPY.split}]} />
      </PRow>
    );
  }

  /* ---------- 字幕挂到接缝（视频格式规范 §5.6，短视频分屏设计 §7） ---------- */

  /** 这一句字幕在画的各轨（`tracks`）挂到接缝时锚线的平移量（`PN.captionSeam`），不挂时 null。画面与导出预览共用。 */
  function subSeam(ctx, doc, cue, tracks) {
    if (!cue || !tracks.length) return null;
    const S = window.BC_SUB;
    const lines = tracks.map((t) => ({y: S.line(doc, t.id, cue.id).y, ownY: (S.cueOverride(doc, cue.id, t.id) || {}).y != null}));
    return PN.captionSeam(PN.spansOf(ctx.elements, ctx.elDocs, window.BC_DATA.DUR), doc.panelSeam !== false, cue.start, lines);
  }

  /** 拖走挂在接缝上的字幕：放下的地方就是用户要的位置。这一句在画的各轨先按画出来的位置写成中线对齐的锚线，再关掉
   *  `panelSeam`，拖动从这里接着算（原型各轨各自摆，所以各轨都写；产品里写的是根样式的 `y` 与 `verticalAlign`）。 */
  function unseamSubs(ctx, doc, cue, tracks, shift) {
    tracks.forEach((t) => {
      const y = window.BC_SUB.line(doc, t.id, cue.id).y;
      ctx.setSubTrack(t.id, {y: window.BC_POSE.subClampY((y == null ? 86 : y) + shift), valign: 'center'});
    });
    ctx.setSubStyle({panelSeam: false});
  }

  Object.assign(window, {PanelsPaint, PanelsSelection, PanelsSection, PanelsLayoutRow, subSeam, unseamSubs});
})();
