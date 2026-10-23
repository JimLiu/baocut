/* 按原片取景的视图层（product-design §5.10「画面怎么取景」，模型在 [model-framing.js](model-framing.js)）。
   ============================================================================
   带取景点（`elDocs[id].focal`）的视频在画布上只能以取景点为中心放大、缩小（位置是剪的时候按人对准的），
   这里负责让人知道为什么：
     · 画布小牌 `FramingChip`：挂在画面左下角外面，写着「按原片取景」，旁边一枚 ⓘ 弹出 `FramingWhy`；
       拖画面、缩到比铺满还小、放大到上限时，小牌那一行临时换成一句说明（`role="status"`），
       约 2.4 秒后回到「按原片取景」。剪成按镜头分段的子视频时，小牌上还有段号与「套到整支」（只套放大倍数）。
     · 属性面板 `FramingSection`：顶替「位置 / 大小 / 旋转」那一段，只给一条「放大」，同一句为什么，
       和明确的出口「改成自由摆放」。
   改成自由摆放用的是此刻画面上那个盒，所以切换的那一下画面不动；之后换画幅时这一段不再自动对准。
   没有取景点的视频不走这里，照旧用八把手自由摆放（stage-objects.jsx）。
   ============================================================================ */
(function () {
  const {useState} = React;
  const F = window.BC_FRAMING;

  /** 这件视频的原片宽高比与画面宽高比。原片按素材实测（`BC_CROP.sourceRatio`），画面按当前画幅。 */
  function framingRatios(ctx, id, e) {
    const list = (ctx.sources && ctx.sources.video) || [];
    const el = Object.assign({}, e, (ctx.elDocs || {})[id]);
    const sr = window.BC_CROP.sourceRatio(window.BC_VIDEO_REPLACE.sourceFor(el, list) || list[0]);
    return {src: sr, out: window.BC_LAYOUT.ratioValue(ctx.ratio, sr)};
  }

  /** 有取景点时：画面上的盒（按当前画幅现算）与写回取景点的口子；没有就是 null（自由摆放）。 */
  function framingFor(ctx, id, e) {
    const focal = ((ctx.elDocs || {})[id] || {}).focal;
    if (!focal || (e && e.kind !== 'video')) return null;
    const r = framingRatios(ctx, id, e);
    return {focal, src: r.src, out: r.out, pose: F.poseFor(focal, r.src, r.out),
      set: (next) => ctx.setElDoc(id, {focal: next})};
  }

  /** 改成自由摆放：拿此刻画面上的盒当自由摆放的 pose，清掉取景点，记一步历史，toast 可撤销。 */
  function freeFraming(ctx, id, app) {
    const doc = (ctx.elDocs || {})[id] || {};
    if (!doc.focal) return;
    const r = framingRatios(ctx, id, (ctx.elements || []).find((x) => x.id === id));
    const pose = Object.assign({}, window.BC_POSE.poseOf(doc), F.poseFor(doc.focal, r.src, r.out));
    if (ctx.history) ctx.history.begin();
    ctx.setElDoc(id, {focal: null, pose});
    if (ctx.history) ctx.history.commit('pose');
    if (app) app.toast(F.COPY.freed, 'positive', {label: '撤销', undo: true, run: () => ctx.history.undo()});
  }

  /** 「为什么只能放大」：画布小牌与属性面板的 ⓘ 弹出同一份。 */
  function FramingWhy({onFree}) {
    return (
      <div className="framewhy">
        <div className="framewhy__t">{F.COPY.whyTitle}</div>
        <p>{F.COPY.why}</p>
        <p>{F.COPY.limits}</p>
        <p className="framewhy__hint">{F.COPY.freeHint}</p>
        {onFree ? <Btn variant="secondary" size="s" onPress={onFree}>{F.COPY.free}</Btn> : null}
      </div>
    );
  }

  /** ⓘ ＋ 弹层。`dir` / `align` 跟着落点走：画布小牌在画面下方，往上弹；面板里 ⓘ 在行尾，往下弹、右边对齐。 */
  function FramingInfo({onFree, dir = 'down', align = 'left'}) {
    const [open, setOpen] = useState(false);
    return (
      <span className="framing-info">
        <IconBtn icon="info" size="s" tip={F.COPY.whyTip} onClick={() => setOpen((x) => !x)} />
        <Popover open={open} onClose={() => setOpen(false)} dir={dir} align={align} width={280} label={F.COPY.whyTitle}>
          <FramingWhy onFree={onFree ? () => { setOpen(false); onFree(); } : null} />
        </Popover>
      </span>
    );
  }

  /* ---------- 画布小牌 ----------
     挂在画面（`.frame`）左下角的外面：裁成竖屏后视频盒比画面宽，贴着视频盒放会跑出视野；画面上方是视频工具条，
     画面里面会挡住要对的人。两种时候出现：这件视频按原片取景（哪怕只有一段），或它是按镜头分段的其中一段。
     「套到整支」记一步历史：按原片取景的段只把放大倍数套到其它按原片取景的段，各段的取景点（对准各自的人）不动，
     自由摆放的段不碰；自由摆放的段把摆位写到这支视频的每一段。 */
  function FramingChip({el, ctx, pose, framing, hit, frameRef}) {
    const SC = window.BC_SHORTS_CUT;
    const app = useApp();
    const frame = frameRef && frameRef.current;
    const root = frame && frame.parentElement;
    if (!root) return null;
    const segs = ctx.composed
      ? (ctx.elements || []).filter((e) => e.kind === 'video' && e.shot != null && !e.hidden) : [];
    const shot = ctx.composed && el.shot != null;
    const others = shot ? segs.filter((e) => e.id !== el.id
      && (!framing || ((ctx.elDocs || {})[e.id] || {}).focal)) : [];
    const copy = framing ? F.COPY : SC.SHOT_COPY;
    const apply = () => {
      if (ctx.history) ctx.history.begin();
      if (framing) {
        const zoom = framing.focal.zoom || 1;
        others.forEach((e) => ctx.setElDoc(e.id, {focal: Object.assign({}, ctx.elDocs[e.id].focal, {zoom})}));
      } else {
        const patch = {};
        ['x', 'y', 'scale', 'w', 'h'].forEach((k) => { if (pose[k] != null) patch[k] = pose[k]; });
        others.forEach((e) => ctx.setElDoc(e.id, {focal: null,
          pose: Object.assign({}, window.BC_POSE.poseOf(ctx.elDocs[e.id]), patch)}));
      }
      if (ctx.history) ctx.history.commit('pose');
      /* 片段外整段划掉的那几件也一起写（恢复回来时不突兀），但提示里只数这一支里看得见的段 */
      const fold = ctx.tmap ? ctx.tmap.fold : (t) => t;
      const shown = segs.filter((e) => (e.id === el.id || others.includes(e))
        && fold(e.end) - fold(e.start) > 0.05).length;
      app.toast(copy.appliedAll(shown), 'positive', {label: '撤销', undo: true, run: () => ctx.history.undo()});
    };
    const stop = (ev) => ev.stopPropagation();
    return ReactDOM.createPortal(
      <div className={cx('shotchip', hit && 'is-hit')} onMouseDown={stop} onClick={stop}
        style={{left: frame.offsetLeft, top: Math.min(frame.offsetTop + frame.offsetHeight + 8, root.clientHeight - 40)}}>
        {framing ? (
          <>
            <span className="shotchip__mode" role="status">{hit ? F.COPY.hit[hit] : F.COPY.mode}</span>
            <FramingInfo dir="up" onFree={() => freeFraming(ctx, el.id, app)} />
          </>
        ) : null}
        {framing && shot ? <i className="shotchip__sep" /> : null}
        {shot ? <span className="shotchip__t">{SC.shotBadge(el, ctx.tmap ? ctx.tmap.fold : null)}</span> : null}
        {others.length ? (
          <Tip label={copy.applyAllTip} side="bottom">
            <Btn size="s" variant="quiet" className="shotchip__all" onPress={apply}>{SC.SHOT_COPY.applyAll}</Btn>
          </Tip>
        ) : null}
      </div>, root);
  }

  /* ---------- 属性面板「取景」段 ----------
     顶替「位置 / 大小 / 旋转」：按原片取景时那几项没有意义（盒由取景点和画幅现算）。只留「放大」，100% 就是刚好铺满，
     以取景点为中心。 */
  function FramingSection({ctx, id, disabled}) {
    const app = useApp();
    const fr = framingFor(ctx, id, (ctx.elements || []).find((x) => x.id === id));
    if (!fr) return null;
    const pct = Math.round((fr.focal.zoom || 1) * 100);
    const zoom = (v) => {
      if (disabled) return;
      const r = F.zoomTo(fr.focal, v / 100);
      if (!F.sameFocal(r.focal, fr.focal)) fr.set(r.focal);
    };
    return (
      <>
        <SecHead>取景</SecHead>
        <div className="framing-mode">
          <Ic n="fullscreen" className="ic--16" />
          <span className="grow">{F.COPY.mode}</span>
          <FramingInfo align="right" onFree={disabled ? null : () => freeFraming(ctx, id, app)} />
        </div>
        <ValueRow label="放大" value={pct} min={100} max={F.MAX_ZOOM * 100} unit="%" onChange={zoom} />
        {/* 一人改分屏（docs/design/shorts-framing §8.4）：只给竖屏、方屏的子视频；原片画幅的视频没有分屏 */}
        {window.PanelsLayoutRow && fr.out < fr.src - 0.01 ? <window.PanelsLayoutRow ctx={ctx} id={id} disabled={disabled} /> : null}
        <div className="hint">{F.COPY.limits}</div>
        <Btn variant="secondary" size="s" style={{marginTop: 8}} disabled={disabled}
          onPress={() => freeFraming(ctx, id, app)}>{F.COPY.free}</Btn>
      </>
    );
  }

  Object.assign(window, {framingFor, freeFraming, FramingWhy, FramingChip, FramingSection});
})();
