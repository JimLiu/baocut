/* 录制中（录屏界面重设计 §3–§5、§7）：控制条、摄像头预览浮窗与托盘 / 菜单栏图标。只在 App 入口加载。
     · 控制条：真实应用里是透明、置顶、不抢焦点、不被录进去的小窗（320 × 64，有警示卡时 150）；录屏幕在屏幕底部居中向上 120，
       录窗口在窗口下边缘居中向上 48，拖把手能拖走。条高 40、圆角 16：停止 + 计时（倒计时的数字也在这里，不再有全屏倒计时）、
       麦克风电平指示、暂停 / 继续、重新开始（确认）、丢弃（确认）、拖动把手。条上方的警示卡讲磁盘快满、设备断开。
       录制中 BaoCut 主窗口收起，原型画模拟桌面（recording-picker.jsx 的 RecDesktop）。
     · 摄像头预览浮窗：缺省 230，拖四角在 150–600 间缩放，缺省在屏幕右下距两边 100，任意处拖动并记住位置；悬停时上方出现
       工具条：关闭（= 不用摄像头）、大小（230 ↔ 400）、形状（圆 → 方 → 宽屏 16:9）、镜像。开始录制后留在屏幕上。
     · 托盘：不录时是菜单（打开 BaoCut、录制屏幕 / 窗口 / 区域、设置、退出 BaoCut）；录制中变成停止图标，单击直接停止。
       原型没有系统菜单栏：图标画在标题栏右侧（带虚线框表示是示意），模拟桌面出现时落在它的菜单栏上。
   警示卡圆角用 10（规格写 12，不在 S2 圆角阶梯上）。 */
(function () {
  const {useState} = React;
  const R = window.RSP;
  const REC = window.BC_REC;
  const A = window.BC_REC_AREA;
  const H = window.BC_REC_HOST;

  const LIVE = ['countdown', 'starting', 'recording', 'paused', 'finishing'];

  /** 麦克风电平指示：四根竖条；没有麦克风时是灰色的关闭图标。只是指示，不能静音。 */
  function MicMeter({on}) {
    const lv = H.useLevel(on);
    if (!on) return <span className="rbar__mic is-off" role="img" aria-label="没有麦克风"><R.Icons.Microphone /></span>;
    return <span className="rbar__mic" role="img" aria-label="麦克风电平">
      {[0.25, 0.5, 0.75, 1].map((t) => <i key={t} className={cx(lv >= t * 0.9 && 'is-lit')} style={{height: `${Math.round(4 + t * 12)}px`}} />)}
    </span>;
  }

  function RecLive({session}) {
    const app = useApp();
    const st = H.useRecorder();
    const vp = H.useViewport();
    const s = session;
    const D = REC.DEMO;
    const [alertGone, setAlertGone] = useState(false);
    const kind = s.kind;
    const win = kind === 'window' ? window.recWindows(vp).find((w) => w.id === st.choice.window) : null;
    const display = D.displays.find((d) => d.id === st.choice.display) || D.displays[0];
    const cam = D.cameras.find((c) => c.id === st.choice.camera);
    const disk = REC.diskLine(D.freeBytes, REC.bytesPerMinute(display.w, display.h, Number(st.settings.fps), !!cam));
    /* 磁盘快满：录制开始后出一次警示卡，可以关掉 */
    const alert = disk.low && !alertGone && (s.phase === 'recording' || s.phase === 'paused')
      ? `磁盘快满了：大约还能录 ${REC.minutesLeft(D.freeBytes, REC.bytesPerMinute(display.w, display.h, Number(st.settings.fps), !!cam))} 分钟，用完时会自动停止并保存。` : '';
    const hgt = alert ? A.BAR.hAlert : A.BAR.h;
    const auto = A.barPlacement(kind, win, vp, hgt);
    const pos = st.barPos ? {x: Math.max(0, Math.min(vp.w - A.BAR.w, st.barPos.x)), y: Math.max(0, Math.min(vp.h - hgt, st.barPos.y - (hgt - A.BAR.h)))} : auto;
    const status = REC.barStatus(s);
    const acts = REC.barActions(s.phase);
    const paused = s.phase === 'paused';
    const micOn = st.choice.mic !== 'none' && st.perms.mic;
    const stop = () => {
      if (s.phase === 'countdown' || s.phase === 'starting') app.toast('已取消录制。');
      H.dispatch('stop');
    };
    const restart = () => app.confirm({title: '重新开始录制？', body: '当前这次录制会被丢弃。', tone: 'negative', confirmLabel: '重新开始',
      run: () => H.dispatch('restart')});
    const discard = () => app.confirm({title: '丢弃这次录制？', tone: 'negative', confirmLabel: '丢弃',
      run: () => { H.dispatch({type: 'discard', afterDiscard: st.settings.afterDiscard}); app.toast('录制已丢弃。'); }});
    const onGrip = (e) => {
      const p0 = {x: pos.x, y: pos.y + (hgt - A.BAR.h)};
      H.drag(e, (dx, dy) => H.patch({barPos: {x: p0.x + dx, y: p0.y + dy}}));
    };
    return <div className="rlive">
      <window.RecDesktop vp={vp} />
      <div className="rbar-win" style={{left: pos.x, top: pos.y, height: hgt}}>
        {alert ? <div className="rbar-alert" role="alert">
          <span className="rbar-alert__ic"><R.Icons.AlertTriangle /></span>
          <span className="rbar-alert__t">{alert}</span>
          <R.ActionButton isQuiet size="XS" aria-label="知道了" onPress={() => setAlertGone(true)}><R.Icons.Close /></R.ActionButton>
        </div> : null}
        <div className={cx('rbar', paused && 'is-paused')} role="toolbar" aria-label="录制控制条">
          <R.TooltipTrigger placement="top">
            <button type="button" className={cx('rbar__stop', `rbar__stop--${status.kind}`)} disabled={!acts.stop} onClick={stop}
              aria-label={s.phase === 'countdown' ? `停止（${status.text} 秒后开始）` : `停止录制 · ${status.text}`}>
              <span className="rbar__sq" aria-hidden="true" />
              <span className="rbar__time" role="status">{status.text}</span>
            </button>
            <R.Tooltip>停止录制</R.Tooltip>
          </R.TooltipTrigger>
          <MicMeter on={micOn} />
          <span className="rbar__sep" aria-hidden="true" />
          <R.TooltipTrigger placement="top">
            <R.ActionButton isQuiet size="S" UNSAFE_className={cx('rbar__btn', paused && 'is-paused')} isDisabled={!acts.pause}
              aria-label={paused ? '继续' : '暂停'} onPress={() => H.dispatch(paused ? 'resume' : 'pause')}>
              {paused ? <R.Icons.Play /> : <R.Icons.Pause />}
            </R.ActionButton>
            <R.Tooltip>{paused ? '继续' : '暂停'}</R.Tooltip>
          </R.TooltipTrigger>
          <R.TooltipTrigger placement="top">
            <R.ActionButton isQuiet size="S" UNSAFE_className="rbar__btn" isDisabled={!acts.restart} aria-label="重新开始" onPress={restart}>
              <R.Icons.Refresh />
            </R.ActionButton>
            <R.Tooltip>重新开始</R.Tooltip>
          </R.TooltipTrigger>
          <R.TooltipTrigger placement="top">
            <R.ActionButton isQuiet size="S" UNSAFE_className="rbar__btn" isDisabled={!acts.discard} aria-label="丢弃" onPress={discard}>
              <R.Icons.Delete />
            </R.ActionButton>
            <R.Tooltip>丢弃</R.Tooltip>
          </R.TooltipTrigger>
          <span className="rbar__grip" onPointerDown={onGrip} role="img" aria-label="拖动控制条"><Ic n="drag" className="ic--16" /></span>
        </div>
      </div>
    </div>;
  }

  /** 摄像头预览浮窗（§4）。形状与镜像只影响预览与导入时摄像头片段的缺省布局预设，不改录下的原始画面。 */
  const SHAPE_LABEL = {round: '圆形', square: '方形', wide: '宽屏 16:9'};
  function RecCameraPreview({camera}) {
    const st = H.useRecorder();
    const vp = H.useViewport();
    const c = st.camera;
    const box = A.cameraBox(c.size, c.shape);
    const pos = A.cameraPlacement(c.pos, box, vp);
    const set = (p) => H.patch({camera: Object.assign({}, st.camera, p)});
    const onDrag = (e) => {
      if (e.button !== 0 || e.target.closest('.rcam__tools, .rcam__corner')) return;
      const p0 = pos;
      H.drag(e, (dx, dy) => set({pos: {x: p0.x + dx, y: p0.y + dy}}));
    };
    const onCorner = (corner) => (e) => {
      e.stopPropagation();
      const size0 = c.size;
      /* 左上方向的角缩放时，右下角保持不动 */
      const right = pos.x + box.w, bottom = pos.y + box.h;
      H.drag(e, (dx, dy) => {
        const size = A.resizeCamera(size0, corner, dx, dy);
        const b = A.cameraBox(size, c.shape);
        set({size, pos: {x: corner.includes('w') ? right - b.w : pos.x, y: corner.includes('n') ? bottom - b.h : pos.y}});
      });
    };
    const Tip = ({label, children}) => <R.TooltipTrigger placement="top">{children}<R.Tooltip>{label}</R.Tooltip></R.TooltipTrigger>;
    return <div className={cx('rcam', `rcam--${c.shape}`)} style={{left: pos.x, top: pos.y, width: box.w, height: box.h}}
      onPointerDown={onDrag} role="region" aria-label={`摄像头预览：${camera.label}`}>
      <div className="rcam__tools" role="toolbar" aria-label="摄像头预览">
        <Tip label="不用摄像头"><R.ActionButton isQuiet size="S" aria-label="关闭摄像头预览" onPress={() => H.setChoice({camera: 'none'})}><R.Icons.Close /></R.ActionButton></Tip>
        <Tip label={c.size === A.CAMERA.big ? '缩小到 230' : '放大到 400'}><R.ActionButton isQuiet size="S" aria-label="大小"
          onPress={() => set({size: A.toggleCameraSize(c.size)})}>{c.size === A.CAMERA.big ? <R.Icons.Minimize /> : <R.Icons.Maximize />}</R.ActionButton></Tip>
        <Tip label={`形状：${SHAPE_LABEL[c.shape]}（点一下换）`}><R.ActionButton isQuiet size="S" aria-label="形状"
          onPress={() => set({shape: A.nextShape(c.shape)})}>{c.shape === 'round' ? <R.Icons.Circle /> : <R.Icons.AspectRatio />}</R.ActionButton></Tip>
        <Tip label="镜像"><R.ToggleButton isQuiet size="S" aria-label="镜像" isSelected={c.mirror}
          onChange={(v) => set({mirror: v})}><Ic n="fliph" className="ic--16" /></R.ToggleButton></Tip>
      </div>
      <div className={cx('rcam__view', c.mirror && 'is-mirror')}>
        <span className="rcam__head" /><span className="rcam__body" /><span className="rcam__lamp" />
      </div>
      {['nw', 'ne', 'sw', 'se'].map((k) => <span key={k} className={cx('rcam__corner', `rcam__corner--${k}`)} onPointerDown={onCorner(k)} />)}
    </div>;
  }

  /** 托盘 / 菜单栏图标（§5）。 */
  function RecTray() {
    const app = useApp();
    const st = H.useRecorder();
    const s = st.session;
    const rec = !!s && LIVE.indexOf(s.phase) >= 0;
    const desk = !!s && s.phase !== 'launcher';
    if (!st.settings.trayIcon && !rec) return null;
    if (rec) {
      return <R.TooltipTrigger placement="bottom">
        <button type="button" className={cx('rtray', 'rtray--rec', desk && 'rtray--desk')} disabled={s.phase === 'finishing'}
          aria-label="停止录制" onClick={() => H.dispatch('stop')}><span className="rtray__stop" aria-hidden="true" /></button>
        <R.Tooltip>停止录制</R.Tooltip>
      </R.TooltipTrigger>;
    }
    const onAction = (k) => {
      if (k === 'display' || k === 'window' || k === 'area') {
        H.setChoice({kind: k});
        if (s) H.dispatch({type: 'pick', kind: k});
        else H.open({mode: 'new', dir: app.newMem && app.newMem.dir, kind: k});
      } else if (k === 'settings') {
        app.go({r: 'settings', sec: 'general'});
        setTimeout(() => { const el = document.getElementById('settings-recording'); if (el) el.scrollIntoView({block: 'start'}); }, 120);
      } else if (k === 'quit') app.toast('原型不会真的退出 BaoCut');
      else if (s && s.phase === 'picker') H.dispatch('escape');
    };
    return <R.MenuTrigger>
      <R.ActionButton isQuiet size="S" UNSAFE_className={cx('rtray', desk && 'rtray--desk')} aria-label="菜单栏里的 BaoCut（示意）">
        <R.Icons.Video />
      </R.ActionButton>
      <R.Menu aria-label="BaoCut" onAction={(k) => onAction(String(k))}>
        {REC.trayMenu(false).reduce((g, x) => (x.sep ? g.concat([[]]) : (g[g.length - 1].push(x), g)), [[]]).map((items, i) =>
          <R.MenuSection key={i} aria-label={`第 ${i + 1} 组`}>
            {items.map((x) => <R.MenuItem key={x.id} id={x.id} textValue={x.label}>{x.label}</R.MenuItem>)}
          </R.MenuSection>)}
      </R.Menu>
    </R.MenuTrigger>;
  }

  Object.assign(window, {RecLive, RecCameraPreview, RecTray});
})();
