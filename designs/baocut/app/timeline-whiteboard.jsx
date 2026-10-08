/* 时间轴上的白板手绘条与「被盖住」带（2026-09-11；设计稿 docs/design/video/bcut-whiteboard-animation-design.md）。
   此前白板在时间轴上只是一条 30px 的 brown 元素行：图标 + 名字，看不出画的是哪张图、
   画多久、手在哪几秒动；而它铺了纸的那几秒主视频画面整幅被盖住，视频行却照常铺缩略帧。
   这一份补两样：
     · `WhiteboardBody`——白板条的内容（与视频条同为 74px 两层）：上半**画面带**逐格按秒
       采样 `BC_WHITEBOARD.sample`，从左到右画面渐满、画完之后每格都是整张；下半**画时带**
       条头到生效画时是「手在画」，之后到条尾是「定格」，节拍在带上打点（只读），画时右缘
       是一枚可拖的手柄——拖它 = 手定画时，吸回条尾 = 跟时长走，双击也回自动。
     · `CoverBands`——视频行缩略带上的斜纹「被盖住」带；波形那一半不压（声音没被盖）。
       点一下选中盖住它的那一件。
   几何与秒数都在纯模型（`BC_WHITEBOARD.lane / dragDraw / strip`、`BC_TL.coverSpans`，有单测）。 */
(function () {
  const {useState} = React;
  const TL = window.BC_TL;
  const W = window.BC_WHITEBOARD;
  const T = window.BC_TIME;
  const vx = (ctx, t, pxps) => TL.px(ctx && ctx.tmap ? ctx.tmap.view(t) : t, pxps);
  const vw = (ctx, a, b, pxps) => (ctx && ctx.tmap ? ctx.tmap.view(b) - ctx.tmap.view(a) : b - a) * pxps;

  const LANE_H = 24;          // 画时带高度：与视频条的波形带同一档，两种媒体条的上半齐平
  const LANE_LABEL_MIN = 45;  // 画时那段够宽才写字（与元素块同一条 45px 判据）
  const HOLD_LABEL_MIN = 36;  // 定格那段够宽才写「定格」

  /** 白板条的内容：`wb` 是这一件的手绘参数、`dur` 是条子时长、`write(patch)` 写回样式文档 */
  function WhiteboardBody({ctx, w, h, pxps, wb, dur, c, write}) {
    const L = W.lane(wb, dur);
    const [drag, setDrag] = useState(null);           // 拖画时手柄中的临时秒数
    const drawS = drag == null ? L.draw : drag;
    const drawW = Math.max(0, Math.min(w, drawS * pxps));
    const holdW = w - drawW;
    const hand = W.handName(wb.hand);
    const beginDraw = (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const x0 = e.clientX, base = L.draw;
      let last = null;
      const move = (ev) => {
        last = base + (ev.clientX - x0) / pxps;
        setDrag(Math.max(W.LIMITS.draw[0], Math.min(dur, last)));
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        setDrag(null);
        // 吸附距离与元素吸附同一个像素数（SNAP_PX），换算成秒
        if (last != null) write({draw: W.dragDraw(last, dur, TL.SNAP_PX / pxps)});
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };
    const drawTip = (L.auto && drag == null ? '跟时长走' : '手定') + ` · 画 ${drawS.toFixed(1)} s · ${hand}`
      + ` · ${W.modeName(L.mode)}${L.pace === 'natural' ? ' · 画完定格' : ''}`
      + '\n拖右缘改画时；拖到条尾 / 双击回到跟时长走';
    /* 拍点刻度（2026-09-17）：每拍在 `at` 打一根竖点；这拍墨线画完到下一拍起画之间（natural 的 hold、
       或 `end` 早于下一拍的空档）压一截细纹「定格」；锚点解析不到的拍没有秒数、不打点。 */
    const beatTip = (b) => `第 ${b.i} 拍${b.label ? ` · ${b.label}` : ''} · ${W.fmtBeat(b)}${b.anchored ? ' · 跟旁白' : ''}`
      + ` · 区域 ${b.box.map((v) => Math.round(v)).join(' / ')}`;
    return (
      <>
        <div className="twb__strip" style={{height: h - LANE_H}}>
          {W.strip(dur, w, pxps, TL.THUMB_W).map((f, i) => (
            <div key={i} className="twb__f" style={{left: f.left, width: f.width - 1}}>
              <window.WhiteboardCanvas props={wb} t={f.t} dur={dur} />
            </div>
          ))}
        </div>
        <div className="twb__lane" style={{height: LANE_H, background: c.bg, boxShadow: `inset 0 0 0 1px ${c.border}`}}>
          <div className={cx('twb__draw', L.auto && drag == null && 'is-auto')} style={{width: drawW, background: c.border}}
            title={drawTip} onDoubleClick={(e) => { e.stopPropagation(); write({draw: null}); }}>
            {drawW >= LANE_LABEL_MIN ? (
              <span className="twb__dl">
                {wb.hand !== 'none' ? <Ic n="edit" className="ic--12" /> : null}
                <b className="t-mono">{drawS.toFixed(1)}s</b>
                {drawW >= 110 ? <em>{drag != null ? '手定' : L.auto ? '跟时长走' : '手定'} · {hand}</em> : null}
              </span>
            ) : null}
          </div>
          {L.hold > 0.05 && holdW >= HOLD_LABEL_MIN ? (
            <span className="twb__hold" style={{left: drawW, width: holdW}} title={`画完定格 ${L.hold.toFixed(1)} s，到条子结束`}>
              <Ic n="pause" className="ic--12" />定格
            </span>
          ) : null}
          {L.beats.filter((b) => b.ok).map((b) => (
            <React.Fragment key={b.i}>
              {b.idleTo - b.drawEnd > 0.05 ? (
                <i className="twb__bhold" style={{left: Math.min(w, b.drawEnd * pxps), width: Math.max(0, Math.min(w, b.idleTo * pxps) - Math.min(w, b.drawEnd * pxps))}}
                  title={`第 ${b.i} 拍画完定格 ${(b.idleTo - b.drawEnd).toFixed(1)} s`} />
              ) : null}
              <i className={cx('twb__beat', b.anchored && 'is-anchor')} style={{left: Math.min(w - 2, b.at * pxps), background: c.fg}}
                title={beatTip(b)} />
            </React.Fragment>
          ))}
          <span className={cx('twb__hnd', drag != null && 'is-drag')} style={{left: drawW - 4, background: c.hover}}
            onMouseDown={beginDraw} onDoubleClick={(e) => { e.stopPropagation(); write({draw: null}); }}
            title="拖动改画时；拖到条尾或双击回到跟时长走" />
        </div>
      </>
    );
  }

  /** 白板条右上角的参数角标：手 · 纸（纸色小方块，透明写字） */
  function WhiteboardMeta({wb}) {
    return (
      <span className="twb__meta" title={`手：${W.handName(wb.hand)} · 纸：${wb.paper || '透明'}`}>
        {W.handName(wb.hand)}
        {wb.paper ? <i className="twb__sw" style={{background: wb.paper}} /> : <i className="twb__sw twb__sw--none" />}
      </span>
    );
  }

  /** 视频行缩略带上的「被盖住」带。`spans` 来自 `BC_TL.coverSpans`（时间轴时钟，画时过折叠时钟）。 */
  function CoverBands({row, ctx, pxps, spans}) {
    if (!spans || !spans.length) return null;
    const goto = (b) => {
      if (ctx.playing) ctx.setPlaying(false);
      ctx.pick({kind: 'element', id: b.id, elKind: b.kind});
      ctx.setTab(b.kind === 'image' ? 'image' : b.kind === 'video' ? 'video' : 'elements');
      ctx.setPaneHidden(false);
    };
    return spans.map((s, i) => {
      const left = vx(ctx, s.start, pxps), w = Math.max(2, vw(ctx, s.start, s.end, pxps));
      const names = s.by.map((b) => `「${b.name}」`).join('、');
      const first = s.by[0];
      return (
        <div key={i} className="tcover" style={{left, width: w, top: 4, height: row.h - 8 - LANE_H}}
          title={`${T.timecode(s.start)} – ${T.timecode(s.end)} 画面被 ${names} 盖住，只剩声音 · 点一下选中它`}
          onMouseDown={(e) => { if (e.button === 0) e.stopPropagation(); }}
          onClick={(e) => { e.stopPropagation(); goto(first); }}>
          {w >= 120 ? <span className="tcover__l"><Ic n={first.icon} className="ic--12" />被{names}盖住</span>
            : w >= 40 ? <span className="tcover__l"><Ic n="layers" className="ic--12" />被盖住</span> : null}
        </div>
      );
    });
  }

  Object.assign(window, {WhiteboardBody, WhiteboardMeta, CoverBands});
})();
