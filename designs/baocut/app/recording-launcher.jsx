/* 录制启动器（录屏界面重设计 §1）：桌面端是一个独立的小浮窗（330 × 400，固定大小、置顶、圆角 16、无系统标题栏）。
   原型画成浮在页面上的一层，拖头部移动、记住位置。只在 App 入口加载；状态在 new-recording.jsx 的宿主里（BC_REC_HOST）。
   自上而下：头部（关闭 / 设置）→ 落点行 → 选择录制对象（屏幕 / 窗口 / 区域，前两格带下拉段）→ 摄像头与麦克风（三行，
   右侧药丸）→ 更多选项（鼠标、键盘、把 BaoCut 也录进去）→ 底部提示（磁盘、设备已不在）。启动器里没有「开始录制」，
   开始在覆盖层的录制卡上（recording-card.jsx）。下拉段与设备行点开是窗口内原地滑出的可搜索列表。 */
(function () {
  const {useState} = React;
  const R = window.RSP;
  const REC = window.BC_REC;
  const H = window.BC_REC_HOST;
  const W = 330, HGT = 400;

  const TARGETS = [
    {k: 'display', label: '屏幕', icon: <R.Icons.DeviceLaptop />, list: 'display', listLabel: '选择屏幕'},
    {k: 'window', label: '窗口', icon: <R.Icons.Layout />, list: 'window', listLabel: '选择窗口'},
    {k: 'area', label: '区域', icon: <R.Icons.Crop />},
  ];
  const CURSORS = [
    {k: 'separate', label: '另画光标', note: '之后可以改光标大小，或者隐藏。'},
    {k: 'baked', label: '录进画面', note: '光标录进画面，之后改不了。'},
    {k: 'none', label: '不要光标', note: '没有光标，也就没有自动缩放。'},
  ];
  const KEYS = [
    {k: 'off', label: '不录', note: ''},
    {k: 'shortcuts', label: '只录快捷键', note: ''},
    {k: 'all', label: '全部按键', note: '全部按键会录下你输入的文字。'},
  ];

  /** 设备行（高 42、圆角 10）：左图标 16、设备名 14、右侧药丸；麦克风的电平是整行背景从左向右的填充。 */
  function DeviceRow({icon, name, pill, level, onRow, onPill, rowLabel}) {
    return <div className={cx('rl-dev', pill.state === 'on' && 'is-on')}>
      {level != null ? <span className="rl-dev__lvl" style={{width: `${Math.round(level * 100)}%`}} aria-hidden="true" /> : null}
      <button type="button" className="rl-dev__main" onClick={onRow} aria-label={rowLabel}>
        <span className="rl-dev__ic">{icon}</span>
        <span className="rl-dev__name">{name}</span>
      </button>
      <button type="button" className={cx('rec-pill', `rec-pill--${pill.state}`)} onClick={onPill}
        aria-label={`${rowLabel}：${pill.label}`}>{pill.label}</button>
    </div>;
  }

  /** 原地滑出的列表：返回、搜索、选项。 */
  function ListPane({title, items, value, onPick, onBack}) {
    const [q, setQ] = useState('');
    const shown = REC.filterList(items, q);
    return <div className="rl-list" role="group" aria-label={title}>
      <div className="rl-list__hd">
        <R.ActionButton isQuiet size="S" onPress={onBack}><R.Icons.ChevronLeft /><R.Text>返回</R.Text></R.ActionButton>
        <span className="rl-list__title">{title}</span>
      </div>
      <R.SearchField aria-label={`搜索${title}`} size="S" value={q} onChange={setQ} UNSAFE_className="rl-list__search" autoFocus />
      <div className="rl-list__items bc-scroll" role="listbox" aria-label={title}>
        {shown.length ? shown.map((x) => <button key={x.id} type="button" role="option" aria-selected={x.id === value}
          className={cx('rl-list__item', x.id === value && 'is-on')} onClick={() => onPick(x.id)}>
          {x.icon ? <span className="rl-list__ic">{x.icon}</span> : null}
          <span className="rl-list__name">{x.label}</span>
          {x.meta ? <span className="rl-list__meta">{x.meta}</span> : null}
          {x.id === value ? <span className="rl-list__check"><R.Icons.Checkmark /></span> : null}
        </button>) : <div className="rl-list__empty">没有找到「{q}」</div>}
      </div>
    </div>;
  }

  function RecLauncher({session}) {
    const app = useApp();
    const st = H.useRecorder();
    const vp = H.useViewport();
    const [more, setMore] = useState(false);
    const ch = st.choice;
    const s = session;
    const D = REC.DEMO;
    const level = H.useLevel(ch.mic !== 'none' && st.perms.mic);
    const pos = st.launcherPos || {x: Math.round((vp.w - W) / 2), y: Math.round((vp.h - HGT) / 2)};
    const x = Math.max(0, Math.min(vp.w - W, pos.x)), y = Math.max(0, Math.min(vp.h - HGT, pos.y));
    const onHead = (e) => {
      if (e.target.closest('button')) return;
      const p0 = {x, y};
      H.drag(e, (dx, dy) => H.patch({launcherPos: {x: p0.x + dx, y: p0.y + dy}}));
    };
    const close = () => {
      H.dispatch('close-launcher');
      if (s.mode === 'agent') app.toast('已取消录制。');
    };
    const settings = () => {
      app.go({r: 'settings', sec: 'general'});
      setTimeout(() => { const el = document.getElementById('settings-recording'); if (el) el.scrollIntoView({block: 'start'}); }, 120);
    };
    const land = REC.landing(s.mode, {project: s.project, video: s.video, note: s.note});
    const cam = D.cameras.find((c) => c.id === ch.camera) || null;
    const mic = D.mics.find((m) => m.id === ch.mic) || null;
    const camPill = REC.pill({on: !!cam, connected: cam ? cam.connected : true, permission: st.perms.camera});
    const micPill = REC.pill({on: !!mic, permission: st.perms.mic});
    const sysPill = REC.pill({on: ch.system});
    const pillDo = (p, which, off) => {
      if (p.action === 'open-settings') H.openPermission(app, which);
      else if (p.action === 'turn-off') H.setChoice(off);
      else H.update({list: which});
    };
    const pick = (k) => {
      H.setChoice({kind: k});
      H.dispatch({type: 'pick', kind: k});
    };
    const display = D.displays.find((d) => d.id === ch.display) || D.displays[0];
    const disk = REC.diskLine(D.freeBytes, REC.bytesPerMinute(display.w, display.h, Number(st.settings.fps), !!cam));

    let body;
    if (s.list === 'display' || s.list === 'window') {
      const isWin = s.list === 'window';
      const items = isWin
        ? D.windows.map((w) => ({id: w.id, label: `${w.app} — ${w.title}`}))
        : D.displays.map((d) => ({id: d.id, label: d.label, meta: `${d.w} × ${d.h}${d.main ? ' · 主屏幕' : ''}`}));
      body = <ListPane title={isWin ? '选择窗口' : '选择屏幕'} items={items} value={isWin ? ch.window : ch.display}
        onBack={() => H.update({list: null})}
        onPick={(id) => {
          /* 选中即指定具体的屏幕或窗口，并直接打开那一种覆盖层（窗口已经固定选中） */
          H.setChoice(isWin ? {window: id, kind: 'window'} : {display: id, kind: 'display'});
          H.update({list: null});
          H.dispatch({type: 'pick', kind: isWin ? 'window' : 'display'});
        }} />;
    } else if (s.list === 'camera' || s.list === 'mic') {
      const isCam = s.list === 'camera';
      const items = [{id: 'none', label: isCam ? '不用摄像头' : '不用麦克风'}].concat((isCam ? D.cameras : D.mics)
        .map((d) => ({id: d.id, label: d.label, meta: d.connected === false ? '未连接' : ''})));
      body = <ListPane title={isCam ? '摄像头' : '麦克风'} items={items} value={isCam ? ch.camera : ch.mic}
        onBack={() => H.update({list: null})}
        onPick={(id) => { H.setChoice(isCam ? {camera: id} : {mic: id}); H.update({list: null}); }} />;
    } else {
      const cursorNote = CURSORS.find((c) => c.k === ch.cursor).note;
      const keysNote = KEYS.find((c) => c.k === ch.keys).note;
      const missing = cam && cam.connected === false;
      body = <div className="rl-main bc-scroll">
        <div className="rl-dest">
          <span className="rl-dest__ic"><Ic n={s.mode === 'agent' ? 'agent' : 'folder'} className="ic--16" /></span>
          <span className="rl-dest__b">
            <span className="rl-dest__t">{land.text}</span>
            {land.note ? <span className="rl-dest__note">{land.note}</span> : null}
          </span>
          {land.back ? <R.TooltipTrigger placement="bottom">
            <R.ActionButton isQuiet size="XS" aria-label="回到编辑器" onPress={close}><R.Icons.Close /></R.ActionButton>
            <R.Tooltip>回到编辑器</R.Tooltip>
          </R.TooltipTrigger> : null}
        </div>
        {!st.perms.screen ? <div className="rl-perm" role="alert">
          <span className="rl-perm__ic"><R.Icons.AlertTriangle /></span>
          <span className="rl-perm__t">要先在系统设置里允许 BaoCut 录制屏幕</span>
          <R.Button size="S" variant="secondary" onPress={() => H.openPermission(app, 'screen')}>打开系统设置</R.Button>
        </div> : null}
        <div className="rl-sec">选择录制对象</div>
        <div className="rl-targets" role="group" aria-label="选择录制对象">
          {TARGETS.map((t) => <div key={t.k} className={cx('rl-target', ch.kind === t.k && 'is-on', t.list && 'has-list')}>
            <button type="button" className="rl-target__main" disabled={!st.perms.screen} aria-pressed={ch.kind === t.k}
              onClick={() => pick(t.k)}>
              <span className="rl-target__ic">{t.icon}</span>
              <span className="rl-target__lb">{t.label}</span>
            </button>
            {t.list ? <button type="button" className="rl-target__more" disabled={!st.perms.screen} aria-label={t.listLabel}
              title={t.listLabel} onClick={() => H.update({list: t.list})}><R.Icons.ChevronDown /></button> : null}
          </div>)}
        </div>
        <div className="rl-sec">摄像头与麦克风</div>
        <div className="rl-devs">
          <DeviceRow icon={<R.Icons.Camera />} name={REC.deviceName('camera', cam)} pill={camPill} rowLabel="摄像头"
            onRow={() => (camPill.action === 'open-settings' ? H.openPermission(app, 'camera') : H.update({list: 'camera'}))}
            onPill={() => pillDo(camPill, 'camera', {camera: 'none'})} />
          <DeviceRow icon={<R.Icons.Microphone />} name={REC.deviceName('mic', mic)} pill={micPill} rowLabel="麦克风"
            level={micPill.state === 'on' ? level : null}
            onRow={() => (micPill.action === 'open-settings' ? H.openPermission(app, 'mic') : H.update({list: 'mic'}))}
            onPill={() => pillDo(micPill, 'mic', {mic: 'none'})} />
          <DeviceRow icon={ch.system ? <R.Icons.VolumeTwo /> : <R.Icons.VolumeOff />} name={REC.deviceName('system', ch.system)} pill={sysPill}
            rowLabel="系统声音" onRow={() => H.setChoice({system: !ch.system})} onPill={() => H.setChoice({system: !ch.system})} />
        </div>
        <button type="button" className={cx('rl-more', more && 'is-open')} aria-expanded={more} onClick={() => setMore((v) => !v)}>
          <span>更多选项</span><span className="rl-more__chev"><R.Icons.ChevronDown /></span>
        </button>
        {more ? <div className="rl-opts">
          <div className="rl-opt">
            <span className="rl-opt__lb">鼠标</span>
            <Segmented size="s" value={ch.cursor} onChange={(v) => H.setChoice({cursor: v})} items={CURSORS} />
            {cursorNote ? <span className="rl-opt__note">{cursorNote}</span> : null}
          </div>
          <div className="rl-opt">
            <span className="rl-opt__lb">键盘</span>
            <Segmented size="s" value={ch.keys} onChange={(v) => H.setChoice({keys: v})} items={KEYS} />
            {keysNote ? <span className="rl-opt__note">{keysNote}</span> : null}
          </div>
          {REC.showsIncludeSelf(ch.kind) ? <div className="rl-opt">
            <R.Switch size="S" isSelected={ch.includeSelf} onChange={(v) => H.setChoice({includeSelf: v})}>把 BaoCut 也录进去</R.Switch>
            <span className="rl-opt__note">{REC.selfNote(ch.kind, ch.includeSelf)}</span>
          </div> : null}
        </div> : null}
        {disk.low || missing ? <div className="rl-tips">
          {missing ? <div className="rl-tip" role="status"><R.Icons.AlertTriangle /><span>{cam.label}已不在，这次不会录摄像头。</span></div> : null}
          {disk.low ? <div className="rl-tip" role="status"><R.Icons.AlertTriangle />
            <span>{disk.title}：{display.label}按现在的设置大约只能录 {REC.minutesLeft(D.freeBytes, REC.bytesPerMinute(display.w, display.h, Number(st.settings.fps), !!cam))} 分钟。</span></div> : null}
        </div> : null}
      </div>;
    }

    return <div className="rl" role="dialog" aria-label="录制启动器" style={{left: x, top: y}}>
      <div className="rl-head" onPointerDown={onHead}>
        <R.TooltipTrigger placement="bottom">
          <R.ActionButton isQuiet size="S" aria-label="关闭启动器" onPress={close}><R.Icons.Close /></R.ActionButton>
          <R.Tooltip>关闭启动器</R.Tooltip>
        </R.TooltipTrigger>
        <span className="rl-head__grip" aria-hidden="true" />
        <R.TooltipTrigger placement="bottom">
          <R.ActionButton isQuiet size="S" aria-label="录制设置" onPress={settings}><R.Icons.Settings /></R.ActionButton>
          <R.Tooltip>设置 › 通用 › 屏幕录制</R.Tooltip>
        </R.TooltipTrigger>
      </div>
      <div className={cx('rl-body', s.list && 'is-list')} key={s.list || 'main'}>{body}</div>
    </div>;
  }

  Object.assign(window, {RecLauncher, RecDeviceRow: DeviceRow});
})();
