/* 选取覆盖层（录屏界面重设计 §2）：屏幕、窗口、区域三种，Esc 关闭并回到启动器。真实应用里每块屏幕一个透明的全屏窗口、不被录进去；
   原型画一张模拟桌面（菜单栏加几个假窗口，BC_REC.DEMO.windows），把视口当作一块屏幕。几何在 model-recording-area.js。
     · 屏幕：压暗 60%，鼠标在屏幕上时换成强调色 40% 的蒙层；中央是显示器图标、屏幕名、「宽×高 · 帧率FPS」与录制卡。
     · 窗口：压暗 70%，鼠标下的窗口盖一块强调色 40% 的矩形；单击固定选中，再点别的窗口改选。矩形里有应用图标、应用名、
       「宽 × 高」、录制卡与「调整录制区域」。
     · 区域：选区外压暗 45%、十字光标；画、移动、八个把手、三分线与跟随的读数；顶部工具条（读数、比例、重置、铺满、锁定）；
       不足 150 × 150 时出红色小卡、开始不可用；方向键微移（Shift 10），Enter 开始，Esc 先取消拖动再关闭。
   屏幕名与应用名用 28 号（规格写 30 号，不在 S2 字号阶梯上）。 */
(function () {
  const {useState, useEffect, useRef, useLayoutEffect} = React;
  const R = window.RSP;
  const REC = window.BC_REC;
  const A = window.BC_REC_AREA;
  const H = window.BC_REC_HOST;
  const MENUBAR = 24;

  /** 模拟桌面上的窗口：按视口比例摆在菜单栏下面。 */
  function recWindows(vp) {
    const h = vp.h - MENUBAR;
    return REC.DEMO.windows.map((w) => Object.assign({}, w, {
      x: Math.round(w.fx * vp.w), y: Math.round(MENUBAR + w.fy * h), w: Math.round(w.fw * vp.w), h: Math.round(w.fh * h),
    }));
  }
  const APP_ICON = {text: <Ic n="text" />, web: <Ic n="web" />, code: <R.Icons.Code />, music: <Ic n="music" />};

  /** 模拟桌面：壁纸、菜单栏（右侧留给托盘图标，recording-live.jsx 的 RecTray 盖在那里）与几个假窗口。 */
  function RecDesktop({vp}) {
    const wins = recWindows(vp);
    return <div className="rdesk" aria-hidden="true">
      <div className="rdesk__bar"><b>文稿编辑器</b><span>文件</span><span>编辑</span><span>显示</span><span className="spacer" /><span>周五 10:12</span></div>
      {wins.map((w) => <div key={w.id} className={cx('rdesk__win', `rdesk__win--${w.tone}`)} style={{left: w.x, top: w.y, width: w.w, height: w.h}}>
        <div className="rdesk__tb"><i /><i /><i /><span>{w.app} — {w.title}</span></div>
        <div className="rdesk__body"><span /><span /><span /><span /></div>
      </div>)}
    </div>;
  }

  /** 屏幕模式（§2 第一条）。 */
  function DisplayMode({vp, card}) {
    const st = H.useRecorder();
    const [over, setOver] = useState(true);
    const d = REC.DEMO.displays.find((x) => x.id === st.choice.display) || REC.DEMO.displays[0];
    return <div className="rp-layer" onPointerEnter={() => setOver(true)} onPointerLeave={() => setOver(false)}>
      <div className={cx('rp-shade', over ? 'rp-shade--accent' : 'rp-shade--60')} />
      <div className="rp-center">
        <span className="rp-hero-ic"><R.Icons.DeviceLaptop /></span>
        <div className="rp-name">{d.label}</div>
        <div className="rp-meta">{d.w}×{d.h} · {st.settings.fps}FPS</div>
        {card(true)}
      </div>
    </div>;
  }

  /** 窗口模式（§2 第二条）。 */
  function WindowMode({vp, card}) {
    const st = H.useRecorder();
    const wins = recWindows(vp);
    const [hover, setHover] = useState(null);
    const pinned = wins.find((w) => w.id === st.choice.window) || null;
    const active = pinned || wins.find((w) => w.id === hover) || null;
    const onMove = (e) => {
      if (e.target.closest('.rp-win__content')) return;
      const w = A.windowAt(wins, {x: e.clientX, y: e.clientY});
      setHover(w ? w.id : null);
    };
    const onClick = (e) => {
      if (e.target.closest('.rp-win__content')) return;
      const w = A.windowAt(wins, {x: e.clientX, y: e.clientY});
      if (w) H.setChoice({window: w.id});
    };
    const adjust = () => {
      H.setChoice({kind: 'area'});
      H.update({kind: 'area', area: A.fitWindow(active, vp)});
    };
    return <div className="rp-layer" onPointerMove={onMove} onClick={onClick}>
      <div className="rp-shade rp-shade--70" />
      {active ? <div className={cx('rp-win', pinned && 'is-pinned')} style={{left: active.x, top: active.y, width: active.w, height: active.h}}>
        <div className="rp-win__content">
          <span className="rp-app-ic">{APP_ICON[active.icon]}</span>
          <div className="rp-name">{active.app}</div>
          <div className="rp-meta">{active.w} × {active.h}</div>
          {card(true)}
          <R.Button size="S" variant="secondary" onPress={adjust}><R.Icons.Crop /><R.Text>调整录制区域</R.Text></R.Button>
        </div>
      </div> : <div className="rp-center rp-win__content">
        <div className="rp-hint">把鼠标移到要录的窗口上，单击选定</div>
        {card(false)}
      </div>}
    </div>;
  }

  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  /** 区域模式（§2 第三条）。 */
  function AreaMode({vp, session, card, cardSize, onStart}) {
    const st = H.useRecorder();
    const sel = session.area || null;
    const locked = st.areaLocked;
    const ratio = st.ratio;
    const [live, setLive] = useState(null); // 拖动中：{kind: 'draw' | 'move' | 'resize', pt}
    const dragRef = useRef(null);
    const setSel = (r) => {
      H.update({area: r});
      if (st.areaLocked) H.patch({area: r});
    };
    const wins = recWindows(vp);
    const B = vp;

    const begin = (e, kind, handle) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      if (locked && sel) return;
      const p0 = {x: e.clientX, y: e.clientY};
      const start = sel;
      const ref = {cancelled: false, start, moved: false};
      dragRef.current = ref;
      H.drag(e, (dx, dy, ev) => {
        if (ref.cancelled) return;
        if (!ref.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
        ref.moved = true;
        const pt = {x: ev.clientX, y: ev.clientY};
        setLive({kind, pt});
        if (kind === 'draw') setSel(A.drawRect(p0, pt, ratio, B));
        else if (kind === 'move') setSel(A.moveRect(start, dx, dy, B));
        else setSel(A.resizeRect(start, handle, dx, dy, ratio, B));
      }, (dx, dy, ev) => {
        dragRef.current = null;
        setLive(null);
        if (ref.cancelled || ref.moved || kind !== 'draw') return;
        /* 单击（没拖）：让区域贴合鼠标下的那个窗口 */
        const w = A.windowAt(wins, {x: ev.clientX, y: ev.clientY});
        if (w) setSel(A.fitWindow(w, B));
      });
    };
    /* 键盘：Esc 先取消拖动再关闭；方向键微移；Enter 开始 */
    useEffect(() => {
      const onKey = (e) => {
        if (e.target && e.target.closest && e.target.closest('input, [role="menu"], [role="dialog"]')) return;
        if (e.key === 'Escape' && dragRef.current) {
          e.stopPropagation(); e.preventDefault();
          dragRef.current.cancelled = true;
          setSel(dragRef.current.start);
          dragRef.current = null;
          setLive(null);
          return;
        }
        if (sel && !locked && e.key.indexOf('Arrow') === 0) { e.preventDefault(); setSel(A.nudge(sel, e.key, e.shiftKey, B)); }
        else if (e.key === 'Enter' && sel && !A.tooSmall(sel)) { e.preventDefault(); onStart(); }
      };
      window.addEventListener('keydown', onKey, true);
      return () => window.removeEventListener('keydown', onKey, true);
    }, [sel, locked, B.w, B.h]);

    const small = A.tooSmall(sel);
    const edges = sel ? A.edgeHandles(sel) : {};
    const place = sel ? A.cardPlacement(sel, B, cardSize) : null;
    const lock = (on) => H.patch({areaLocked: on, area: on ? sel : st.area});
    return <div className={cx('rp-layer', 'rp-area', locked && sel && 'is-locked')} onPointerDown={(e) => begin(e, 'draw')}>
      {sel ? <div className="rp-sel" style={{left: sel.x, top: sel.y, width: sel.w, height: sel.h}}
        onPointerDown={(e) => begin(e, 'move')}>
        {live ? <><i className="rp-sel__third rp-sel__third--v1" /><i className="rp-sel__third rp-sel__third--v2" />
          <i className="rp-sel__third rp-sel__third--h1" /><i className="rp-sel__third rp-sel__third--h2" /></> : null}
        {!locked ? HANDLES.filter((h) => h.length === 2 || edges[h]).map((h) => <span key={h}
          className={cx('rp-handle', `rp-handle--${h}`, h.length === 2 ? 'rp-handle--corner' : 'rp-handle--edge')}
          onPointerDown={(e) => begin(e, 'resize', h)} />) : null}
        {small ? <div className="rp-small" role="alert"><b>最小 {A.MIN} × {A.MIN}</b><span>{A.sizeText(sel)} 太小</span></div> : null}
      </div> : <><div className="rp-shade rp-shade--45" />
        <div className="rp-center rp-center--hint">
          <div className="rp-hint-lg">拖动鼠标选择录制区域</div>
          <div className="rp-hint">或者单击一个窗口，让区域贴合它</div>
        </div></>}
      {live && sel ? <div className="rp-readout" style={{left: live.pt.x + 14, top: live.pt.y + 14}}>{A.sizeText(sel)}</div> : null}
      <div className="rp-tools" role="toolbar" aria-label="区域" onPointerDown={(e) => e.stopPropagation()}>
        <span className="rp-tools__size">{sel ? A.sizeText(sel) : '画一个区域'}</span>
        <Segmented size="s" value={ratio} items={A.RATIOS.map((r) => ({k: r.id, label: r.label}))}
          onChange={(k) => { H.patch({ratio: k}); if (sel && !locked) setSel(A.applyRatio(sel, k, B)); }} />
        <R.TooltipTrigger><R.ActionButton isQuiet size="S" aria-label="重置选区" isDisabled={!sel || locked}
          onPress={() => setSel(null)}><R.Icons.Revert /></R.ActionButton><R.Tooltip>重置选区</R.Tooltip></R.TooltipTrigger>
        <R.TooltipTrigger><R.ActionButton isQuiet size="S" aria-label="铺满屏幕" isDisabled={locked}
          onPress={() => setSel(A.applyRatio(A.fillScreen(B), ratio, B) || A.fillScreen(B))}><R.Icons.FullScreen /></R.ActionButton><R.Tooltip>铺满屏幕</R.Tooltip></R.TooltipTrigger>
        <R.TooltipTrigger><R.ToggleButton isQuiet size="S" aria-label="锁定区域" isSelected={locked} isDisabled={!sel}
          onChange={lock}>{locked ? <R.Icons.Lock /> : <R.Icons.LockOpen />}</R.ToggleButton>
          <R.Tooltip>{locked ? '已锁定：下次沿用这个区域，不能拖动' : '锁定区域：下次沿用，并防止误拖'}</R.Tooltip></R.TooltipTrigger>
      </div>
      {place ? <div className="rp-card-at" style={{left: place.x, top: place.y}} onPointerDown={(e) => e.stopPropagation()}>{card(!small)}</div> : null}
    </div>;
  }

  /** 覆盖层的根：三种模式、录制卡、没有麦克风的确认；Esc 回到启动器。 */
  function RecPicker({session}) {
    const app = useApp();
    const st = H.useRecorder();
    const vp = H.useViewport();
    const [ask, setAsk] = useState(false);
    const cardRef = useRef(null);
    const [cardSize, setCardSize] = useState({w: 416, h: 132});
    useLayoutEffect(() => {
      const el = cardRef.current;
      if (el && Math.abs(el.offsetHeight - cardSize.h) > 1) setCardSize({w: 416, h: el.offsetHeight});
    });
    const kind = session.kind;
    useEffect(() => {
      const onKey = (e) => {
        if (e.key !== 'Escape' || ask) return;
        if (e.target && e.target.closest && e.target.closest('[role="menu"], [role="dialog"]')) return;
        H.dispatch('escape');
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [ask]);
    const go = () => {
      setAsk(false);
      if (kind === 'area' && st.areaLocked) H.patch({area: session.area});
      H.dispatch({type: 'start', countdown: Number(st.settings.countdown)});
    };
    const start = () => { if (REC.needsMicConfirm(st.choice.mic, st.settings)) setAsk(true); else go(); };
    const Card = window.RecCard;
    const card = (ready) => <Card cardRef={cardRef} mode={session.mode} ready={ready} onStart={start}
      onClose={() => H.dispatch('close-card')} />;
    return <div className={cx('rp', `rp--${kind}`)} role="dialog" aria-modal="true" aria-label="选择录制对象">
      <RecDesktop vp={vp} />
      {kind === 'display' ? <DisplayMode vp={vp} card={card} />
        : kind === 'window' ? <WindowMode vp={vp} card={card} />
        : <AreaMode vp={vp} session={session} card={card} cardSize={cardSize} onStart={start} />}
      {ask && window.RecMicConfirm ? <window.RecMicConfirm onBack={() => setAsk(false)} onGo={go} /> : null}
    </div>;
  }

  Object.assign(window, {RecPicker, RecDesktop, recWindows});
})();
