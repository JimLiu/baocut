/* 舞台上的「缩放取景框」（屏幕录制设计 §5「固定看一点」；product-design §5.9）：选中一段看固定一点的缩放时，
   在屏幕实例的画面上画出这一段放大后露出的那块，拖动它改看哪里。框的大小跟着倍率走（1 / 倍率），夹在画面里。
   松手写回一次（一条历史）。App 与 Web 都加载。 */
(function () {
  const {useState} = React;
  const SV = window.BC_SV;

  function ScreenFramingBox({ctx, frameRef}) {
    const [draft, setDraft] = useState(null);
    const sel = ctx.zoomSel;
    if (!sel || !ctx.screenView) return null;
    const view = ctx.screenView(sel.view);
    const zoom = (view.zooms || []).find((z) => z.id === sel.id);
    if (!zoom || !zoom.focus || zoom.focus.kind !== 'point') return null;
    const screens = (ctx.elements || []).filter((e) => e.screenView === sel.view && !e.hidden);
    const picked = ctx.sel && ctx.sel.kind === 'element' ? screens.find((e) => e.id === ctx.sel.id) : null;
    const el = picked || screens[0];
    if (!el) return null;
    const pose = Object.assign({x: 50, y: 50, w: 100, h: 100, scale: 1}, el.pose || el.place);
    const s = pose.scale || 1;
    const bw = pose.w * s, bh = (pose.h == null ? 100 : pose.h) * s;
    const bx = pose.x - bw / 2, by = pose.y - bh / 2;
    const rect = SV.framingRect(draft || zoom.focus, zoom.scale);

    const down = (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const frame = frameRef && frameRef.current ? frameRef.current.getBoundingClientRect() : null;
      if (!frame) return;
      const pw = frame.width * bw / 100, ph = frame.height * bh / 100;
      const x0 = e.clientX, y0 = e.clientY;
      let last = null;
      const move = (ev) => {
        last = SV.focusFromRect(rect.x + (ev.clientX - x0) / pw, rect.y + (ev.clientY - y0) / ph, zoom.scale);
        setDraft(last);
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        setDraft(null);
        if (last) ctx.setScreenView(sel.view, SV.patchZoom(view, zoom.id, {focus: last}));
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };

    return <div className="scv-frame" style={{left: bx + '%', top: by + '%', width: bw + '%', height: bh + '%'}}>
      <div className="scv-frame__box" role="slider" aria-label="缩放取景框"
        aria-valuetext={`看 ${Math.round((draft || zoom.focus).x * 100)}%, ${Math.round((draft || zoom.focus).y * 100)}%`}
        title="缩放取景框：拖动它选看哪里"
        style={{left: rect.x * 100 + '%', top: rect.y * 100 + '%', width: rect.w * 100 + '%', height: rect.h * 100 + '%'}}
        onMouseDown={down} onClick={(e) => e.stopPropagation()}>
        <span className="scv-frame__lb">{SV.zoomName(view, zoom.id)} · {SV.scaleLabel(zoom.scale)}</span>
      </div>
    </div>;
  }

  Object.assign(window, {ScreenFramingBox});
})();
