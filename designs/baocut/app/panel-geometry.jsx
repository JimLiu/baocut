/* 几何段 —— 位置 · 大小 · 九宫钉点（设计稿 docs/design/elements/bcut-element-geometry-panel-design.md §7.1）。
   版面编辑器的模板层、元素属性页、文字属性页三处共用这一段；换算全在纯层 `BC_GEOM`
   （镜像 core `geometry_panel.rs`），这里只接宿主：

     模板层  box{x,y,w,h}（左上制）→ `layerBox` / `layerApply` → `ctx.studioBox`
     元素    pose{x,y,w,h?,scale}（中心制）+ 舞台上量出来的盒子 → `elementBox` / `elementApply`
             → `ctx.setElPose`

   面板是投影，不是真相：落盘仍是 box / pose，钉点**不落盘**，会话内按 id 记住（下面两张表），
   首次打开取 `defaultPin`。原型舞台是中心制、没有 verticalAlign，文本的纵向钉点也走会话记忆
   （台账记了这一条）。多选时整段只读，显示第一件。 */
(function () {
  const {useState, useLayoutEffect} = React;
  const G = window.BC_GEOM;
  const P = window.BC_POSE;

  const PINS = new Map();
  const LOCKS = new Map();
  const pinFor = (key, box) => {
    if (!PINS.has(key)) PINS.set(key, G.defaultPin(box));
    return PINS.get(key);
  };

  /** 纯视图：钉点 + 四个数 + 锁比 + 快捷动作 + 末行（旋转 / 翻转，由宿主塞进来）。 */
  function GeometryView({pin, values, onPin, onCommit, onQuick, canH, lock, onLock, fullHeight, disabled, children, aside}) {
    const commit = (k) => (v) => onCommit(Object.assign({}, values, {[k]: v}));
    return (
      <>
        <SecHead aside={aside}>几何</SecHead>
        <div className="sec">
        <div className={window.cx('geom', disabled && 'is-disabled')}>
          <PinGrid value={pin} onChange={onPin} disabled={disabled} />
          <div className="geom__f">
            <NumField label={G.X_LABEL[pin.x]} tip="位置从这个点量起" value={values.x} unit="%"
              disabled={disabled} onChange={commit('x')} />
            <NumField label="宽" value={values.w} unit="%" min={0} disabled={disabled} onChange={commit('w')} />
            <span />
            <NumField label={G.Y_LABEL[pin.y]} tip="位置从这个点量起" value={values.y} unit="%"
              disabled={disabled} onChange={commit('y')} />
            <NumField label="高" value={values.h} unit="%" min={0} disabled={disabled || !canH} onChange={commit('h')} />
            {onLock ? (
              <IconBtn icon={lock ? 'lock' : 'unlock'} size="s" on={lock} tip="锁定比例"
                disabled={disabled} onClick={() => onLock(!lock)} />
            ) : <span />}
          </div>
        </div>
        <div className="geom__q">
          <Btn variant="secondary" size="s" disabled={disabled} onClick={() => onQuick('snapToPin')}>贴齐钉点</Btn>
          <Btn variant="secondary" size="s" disabled={disabled} onClick={() => onQuick('fullWidth')}>整宽</Btn>
          {fullHeight ? (
            <Btn variant="secondary" size="s" disabled={disabled} onClick={() => onQuick('fullHeight')}>整高</Btn>
          ) : null}
        </div>
        {children}
        </div>
      </>
    );
  }

  /* ---------- 宿主一：版面编辑器的模板层 ---------- */
  function LayerGeometry({ctx, l}) {
    const [, bump] = useState(0);
    const key = 'tpl:' + l.id;
    const cur = G.layerBox(l.box);
    const pin = pinFor(key, cur);
    const lock = !!LOCKS.get(key);
    const values = G.project(cur, pin);
    const write = (p, target) => ctx.studioBox(l.id, G.layerApply(l.box, p, target, lock));
    return (
      <GeometryView pin={pin} values={values} canH fullHeight lock={lock}
        onLock={(v) => { LOCKS.set(key, v); bump((n) => n + 1); }}
        onPin={(p) => { PINS.set(key, p); bump((n) => n + 1); }}
        onCommit={(target) => write(pin, target)}
        onQuick={(action) => {
          const q = G.quick(pin, values, action);
          PINS.set(key, q.pin); bump((n) => n + 1);
          write(q.pin, q.values);
        }} />
    );
  }

  /* ---------- 宿主二：元素（贴纸 / 形状 / 图片 / 声波 / 进度 / 计时 / 文字…） ----------
     盒子的像素尺寸从舞台上量：`.frame [data-el=id]` 的 offsetWidth / offsetHeight，帧取
     `.frame` 的 clientWidth / clientHeight——与 `···` 菜单「适应画布」同一个量法
     （stage-toolbar-menu.jsx）。量不到（元素不在当前时间点）就按 pose 推：宽 = w × scale，
     高 = h × scale（free 档）或与宽同像素。 */
  const FALLBACK = {frameW: 1920, frameH: 1080};
  function measure(id, pose) {
    const node = document.querySelector('.stage .frame [data-el="' + id + '"]');
    const fr = node && node.closest('.frame');
    if (node && fr && fr.clientWidth > 0 && node.offsetWidth > 0) {
      return {boxW: node.offsetWidth, boxH: node.offsetHeight, frameW: fr.clientWidth, frameH: fr.clientHeight, live: true};
    }
    const sc = pose.scale || 1;
    const boxW = (pose.w || 0) * sc / 100 * FALLBACK.frameW;
    const boxH = pose.h != null ? pose.h * sc / 100 * FALLBACK.frameH : boxW;
    return Object.assign({boxW, boxH, live: false}, FALLBACK);
  }
  const near = (a, b) => !!a && !!b && ['boxW', 'boxH', 'frameW', 'frameH'].every((k) => Math.abs(a[k] - b[k]) < 0.5);

  function ElementGeometry({ctx, id, kind, pose, disabled, children}) {
    const [m, setM] = useState(() => measure(id, pose));
    const [, bump] = useState(0);
    /* 提交之后舞台才重排；每次渲染完复量一次，量数变了再渲染一次（不变就停，不会循环） */
    useLayoutEffect(() => {
      const next = measure(id, pose);
      if (!near(next, m)) setM(next);
    });
    const caps = P.caps(kind);
    const free = caps.resize === 'free';
    const g = {x: pose.x, y: pose.y, placeW: pose.w, scaleY: 1,
      boxW: m.boxW, boxH: m.boxH, frameW: m.frameW, frameH: m.frameH,
      valign: 'middle', heightTracksWidth: caps.resize !== 'text' && pose.h == null};
    const key = 'el:' + id;
    const cur = G.elementBox(g);
    const pin = pinFor(key, cur);
    const lock = free && !!LOCKS.get(key);
    const values = G.project(cur, pin);
    const write = (p, target) => {
      const r = G.elementApply(g, p, target, lock, P.limitsFor(kind));
      const patch = {x: r.x, y: r.y, w: r.w};
      if (free && Math.abs(r.scaleY - 1) > G.EPS) {
        const fw = pose.w > 0 ? r.w / pose.w : 1;
        const natural = g.heightTracksWidth ? cur.h * fw : cur.h;
        patch.h = G.r1(natural * r.scaleY / (pose.scale || 1));
      }
      ctx.setElPose(id, patch);
    };
    /* 「运动」一组（G11a）挂在几何段之后：只有元素宿主有，模板层（`LayerGeometry`）没有时间轴不长；
       多选只读时不画。 */
    return (
      <>
      <GeometryView pin={pin} values={values} disabled={disabled} canH={free} fullHeight={free}
        aside={disabled ? '多选时只读 · 显示第一件' : null}
        lock={lock} onLock={free ? (v) => { LOCKS.set(key, v); bump((n) => n + 1); } : null}
        onPin={(p) => { PINS.set(key, p); bump((n) => n + 1); }}
        onCommit={(target) => write(pin, target)}
        onQuick={(action) => {
          const q = G.quick(pin, values, action);
          PINS.set(key, q.pin); bump((n) => n + 1);
          write(q.pin, q.values);
        }}>
        {children}
      </GeometryView>
      {!disabled && window.ElementMotion ? <window.ElementMotion ctx={ctx} id={id} kind={kind} pose={pose} m={m} /> : null}
      </>
    );
  }

  /** 多选判据与画布一致：能多选的那几类选中了两件及以上，几何段只读。 */
  const geometryReadOnly = (ctx) => (ctx.sels || []).filter((s) => window.BC_SELECT.canMulti(s.kind)).length >= 2;

  Object.assign(window, {GeometryView, LayerGeometry, ElementGeometry, geometryReadOnly});
})();
