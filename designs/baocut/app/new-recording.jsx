/* 录制的宿主、入口与设置（录屏界面重设计 §1–§7，交互对齐 Cap 桌面端；不变的规则见屏幕录制设计 docs/design/screen-recording §11、§13；
   product-design §3.2.1、§4.8、§5.9）。只在 App 入口加载。
     · 入口：Home 快捷开始标题行尾的「录制」、Space「新建」菜单的「录制新视频」、编辑器视频素材栏的「录制」、
       智能体会话里的录制卡、托盘菜单。都打开录制启动器（`BC_RECORDER.open`），带上各自的落点。
     · 启动器（recording-launcher.jsx）→ 选取覆盖层（recording-picker.jsx，录制卡在 recording-card.jsx）→ 控制条、
       摄像头浮窗与托盘（recording-live.jsx）。原型是网页：独立的小窗画成浮在页面上的层，覆盖层下面是一张模拟桌面。
     · 原型不真的录：停止时按启动器的选择从示例录制裁出一段（BC_REC.takeFrom），收尾后回到编辑器。
     · Home 顶上的「没有收完的录制」：恢复，或删掉录下的文件（要确认，不能撤销）。
     · 设置 › 通用 ›「屏幕录制」：倒计时、没有麦克风先确认、开始时主窗口、丢弃之后、缺省帧率、菜单栏图标、全局快捷键。
   演示用的屏幕、窗口与设备在 BC_REC.DEMO，名字都是虚构的。地址栏带 `?recperm=none` 时演示没有任何录制权限，带 `?recdisk=low` 时演示磁盘快满（启动器底部提示、控制条上的警告卡），带 `?recsleep=on` 时演示录到第 5 秒电脑睡眠（自动暂停，控制条上提示）。 */
(function () {
  const {useState, useEffect} = React;
  const R = window.RSP;
  const REC = window.BC_REC;

  /* ---------- 设置（本机记住；读写包在 try 里，存不下就用缺省） ---------- */

  const SETTINGS_KEY = () => window.BC_SURFACE.storageKey('bc-recording-settings');
  function loadSettings() {
    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY());
      return REC.mergeSettings(raw ? JSON.parse(raw) : null);
    } catch (e) { return REC.mergeSettings(null); }
  }
  function saveSettings(v) {
    try { window.localStorage.setItem(SETTINGS_KEY(), JSON.stringify(v)); } catch (e) { /* 存不下：这一次照常生效 */ }
  }

  /* ---------- 录制宿主的状态：一次只有一次录制；智能体的请求各记各的状态 ---------- */

  const demoFlag = (k, v) => { try { return new URLSearchParams(window.location.search).get(k) === v; } catch (e) { return false; } };
  const noPerm = demoFlag('recperm', 'none');
  /* 磁盘快满：剩 1.5 GB，按缺省设置只够录几分钟 */
  if (demoFlag('recdisk', 'low')) REC.DEMO.freeBytes = 1.5e9;
  /* 电脑睡眠：每次录制只演示一次 */
  const sleepDemo = demoFlag('recsleep', 'on');
  const store = {
    session: null, requests: {}, takes: 0, subs: new Set(),
    settings: loadSettings(),
    /* 系统隐私设置里的三项（演示）：点「允许」打开系统设置，原型当作用户在那里打开了 */
    perms: {screen: !noPerm, camera: !noPerm, mic: !noPerm},
    /* 上一次的选择（启动器记住）：录什么、具体哪块屏幕 / 哪个窗口、设备、更多选项 */
    choice: {kind: 'display', display: 'd1', window: null, camera: 'none', mic: 'default', system: false,
      cursor: 'separate', keys: 'off', includeSelf: false},
    /* 区域：锁定后下次沿用 */
    area: null, areaLocked: false, ratio: 'free',
    /* 小窗的位置（拖过就记住） */
    launcherPos: null, barPos: null,
    camera: {size: 230, shape: 'round', mirror: true, pos: null},
  };
  const emit = () => store.subs.forEach((f) => f());
  function useRecorder() {
    const [, tick] = useState(0);
    useEffect(() => {
      const f = () => tick((n) => n + 1);
      store.subs.add(f);
      return () => { store.subs.delete(f); };
    }, []);
    return store;
  }
  const setRequest = (id, patch) => {
    store.requests = Object.assign({}, store.requests, {[id]: Object.assign({}, store.requests[id], patch)});
    emit();
  };
  const setChoice = (patch) => { store.choice = Object.assign({}, store.choice, patch); emit(); };
  const setSettings = (patch) => { store.settings = Object.assign({}, store.settings, patch); saveSettings(store.settings); emit(); };
  const patch = (p) => { Object.assign(store, p); emit(); };

  /** 项目名（落点行用）：Space / Home 带来的项目，或会话、视频所在的项目。 */
  const projectName = (dir) => {
    const d = dir && (window.BC_DATA.agentProjects || []).find((x) => x.id === dir);
    return d ? d.name : '';
  };

  /**
   * 打开录制启动器。`mode`：`new`（Home / Space / 托盘：录成项目里的一个新视频）、`into`（编辑器：放到这部视频播放头处的新轨道上，
   * 停止时调 `onDone({rec, sources})`）、`agent`（会话里的录制卡：`request` 预先填好启动器）。`kind` 给了就跳过启动器、
   * 直接进那种选取覆盖层（托盘菜单与全局快捷键）。正在录时不再开第二个。
   */
  function open(opts) {
    if (store.session) return false;
    const o = opts || {};
    const req = o.mode === 'agent' && o.request ? o.request : null;
    if (req) {
      const cam = req.camera && req.camera !== 'none' ? req.camera : 'none';
      setChoice({kind: req.source || store.choice.kind, camera: cam, mic: req.mic || 'none', system: !!req.system, cursor: req.cursor || store.choice.cursor});
      setRequest(req.id, {state: 'waiting'});
    }
    if (o.kind) store.choice = Object.assign({}, store.choice, {kind: o.kind});
    store.session = Object.assign({phase: o.kind ? 'picker' : 'launcher', kind: o.kind || store.choice.kind, list: null,
      area: store.areaLocked ? store.area : null}, o,
      {project: o.project || projectName(o.dir || (req && req.dir))});
    emit();
    return true;
  }
  const busy = () => !!store.session;
  /** 状态机的一步（BC_REC.step），顺带把智能体录制卡的状态报过去。 */
  function dispatch(ev) {
    const s = store.session;
    if (!s) return;
    const next = REC.step(s, ev);
    if (next === s) return;
    store.session = next.phase === 'closed' ? null : next;
    const req = s.mode === 'agent' && s.request ? s.request : null;
    if (req) {
      const st = next.phase === 'closed' ? (next.outcome === 'done' ? null : next.outcome)
        : next.phase === 'launcher' || next.phase === 'picker' ? 'waiting'
        : next.phase === 'starting' ? 'countdown' : next.phase;
      if (st) setRequest(req.id, {state: st, left: next.left, elapsed: next.elapsed});
    }
    emit();
  }
  /** 局部改动（列表页、覆盖层里的目标等），不经过状态机。 */
  const update = (p) => { if (store.session) { store.session = Object.assign({}, store.session, p); emit(); } };

  window.BC_RECORDER = {
    open, busy, subscribe: (f) => { store.subs.add(f); return () => store.subs.delete(f); },
  };

  /* ---------- 几个小窗共用的小工具 ---------- */

  /** 按下之后跟着指针：onMove(dx, dy, ev)，松开时 onEnd(dx, dy, ev)。 */
  function drag(e, onMove, onEnd) {
    const x0 = e.clientX, y0 = e.clientY;
    const move = (ev) => onMove(ev.clientX - x0, ev.clientY - y0, ev);
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (onEnd) onEnd(ev.clientX - x0, ev.clientY - y0, ev);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  /** 视口大小（原型把视口当作一块屏幕）。 */
  function useViewport() {
    const get = () => ({x: 0, y: 0, w: window.innerWidth, h: window.innerHeight});
    const [v, setV] = useState(get);
    useEffect(() => {
      const f = () => setV(get());
      window.addEventListener('resize', f);
      return () => window.removeEventListener('resize', f);
    }, []);
    return v;
  }
  /** 麦克风电平（演示）：0–1 的随机起伏，active 为假时是 0。 */
  function useLevel(active) {
    const [lv, setLv] = useState(0);
    useEffect(() => {
      if (!active) { setLv(0); return undefined; }
      const id = setInterval(() => setLv((x) => Math.max(0.04, Math.min(1, x * 0.55 + Math.random() * 0.6 * (Math.random() < 0.8 ? 1 : 0.2)))), 140);
      return () => clearInterval(id);
    }, [active]);
    return lv;
  }
  /** 「允许」：打开系统设置的对应一项（BaoCut 不替用户改）。原型当作用户在那里打开了。 */
  function openPermission(app, which) {
    app.toast(`已打开系统设置 › 隐私与安全性 › ${REC.PERMISSION_PANE[which]}（原型当作你已经打开）`);
    patch({perms: Object.assign({}, store.perms, {[which]: true})});
  }

  /* 启动器、覆盖层、控制条与托盘共用的内部接口（只在 App 的录制模块之间用） */
  window.BC_REC_HOST = {store, useRecorder, dispatch, update, setChoice, setSettings, patch, loadSettings,
    drag, useViewport, useLevel, openPermission, open};

  /* ---------- 宿主：挂在 App 根上 ---------- */

  /** 选择对应的目标：录哪块屏幕、哪个窗口（屏幕点数）、区域。 */
  const targetOf = (s, ch) => {
    const D = REC.DEMO;
    if (s.kind === 'window') return D.windows.find((w) => w.id === ch.window) || null;
    return D.displays.find((d) => d.id === ch.display) || D.displays[0];
  };

  function RecordingHost() {
    const app = useApp();
    const st = useRecorder();
    const s = st.session;
    const phase = s && s.phase;
    /* 倒计时与计时：每秒一跳；「正在开始」与「正在收尾…」各停一会儿 */
    useEffect(() => {
      if (phase === 'countdown' || phase === 'recording') {
        const id = setInterval(() => {
          dispatch('tick');
          const now = store.session;
          if (sleepDemo && now && now.phase === 'recording' && now.elapsed === 5 && !now.sleptOnce) { update({sleptOnce: true}); dispatch('sleep'); }
        }, 1000);
        return () => clearInterval(id);
      }
      if (phase === 'starting') {
        const id = setTimeout(() => dispatch('started'), 700);
        return () => clearTimeout(id);
      }
      if (phase === 'finishing') {
        const done = s;
        const id = setTimeout(() => { dispatch('finished'); finish(app, done); }, 1400);
        return () => clearTimeout(id);
      }
      return undefined;
    }, [phase]);
    const L = window.RecLauncher, P = window.RecPicker, Live = window.RecLive, Cam = window.RecCameraPreview, Tray = window.RecTray;
    const live = phase && phase !== 'launcher' && phase !== 'picker';
    const cam = REC.DEMO.cameras.find((c) => c.id === st.choice.camera);
    const showCam = !!s && !!cam && cam.connected !== false && st.perms.camera;
    return <>
      {phase === 'launcher' && L ? <L session={s} /> : null}
      {phase === 'picker' && P ? <P session={s} /> : null}
      {live && Live ? <Live session={s} target={targetOf(s, st.choice)} /> : null}
      {showCam && Cam ? <Cam camera={cam} /> : null}
      {Tray ? <Tray /> : null}
    </>;
  }

  /** 收尾之后（§7）：BaoCut 主窗口回来并打开编辑器；录进当前视频时放到播放头处的新轨道上。 */
  function finish(app, s) {
    store.takes += 1;
    const ch = store.choice;
    const seconds = Math.max(s.elapsed || 0, 24);
    const req = s.mode === 'agent' && s.request ? s.request : null;
    if (s.mode === 'into') {
      const take = REC.takeFrom(window.BC_DATA.recordingDemo, store.takes, Object.assign({seconds}, ch), window.BC_DATA.recordingSources);
      if (s.onDone) s.onDone(take);
      app.toast(`录好了（${REC.clock(take.rec.duration)}），已放到播放头处的新轨道上`, 'positive');
      return;
    }
    const p = window.BC_DATA.projects.find((x) => x.recording);
    if (req) {
      setRequest(req.id, {state: 'done', elapsed: p.recording.duration, title: p.title, project: p.id});
      app.toast(`录好了（${REC.clock(p.recording.duration)}），已放进新视频「${p.title}」`, 'positive',
        {label: '打开', run: () => app.go({r: 'editor', id: p.id})});
      return;
    }
    app.go({r: 'editor', id: p.id});
    app.toast(`录好了（${REC.clock(p.recording.duration)}），已放进新视频「${p.title}」`, 'positive');
  }

  /* ---------- 入口 ---------- */

  /** Home 快捷开始标题行尾的「录制」：落点是 Home 当前项目里的新视频。 */
  function HomeRecord() {
    const app = useApp();
    const st = useRecorder();
    const dir = app.newMem && app.newMem.dir;
    return <R.TooltipTrigger placement="bottom">
      <R.ActionButton isQuiet size="S" isDisabled={!!st.session} onPress={() => open({mode: 'new', dir})}>
        <R.Icons.DeviceLaptop /><R.Text>录制</R.Text>
      </R.ActionButton>
      <R.Tooltip>不经过智能体，把屏幕录成一个新视频</R.Tooltip>
    </R.TooltipTrigger>;
  }

  /** Home 顶上的「没有收完的录制」（§11）：恢复后打开放进去的视频；删除要确认，不能撤销。 */
  function HomeRecovery() {
    const app = useApp();
    const [gone, setGone] = useState([]);
    const list = (window.BC_DATA.recordingRecovery || []).filter((r) => gone.indexOf(r.id) < 0);
    const r = REC.recoveryText(list);
    if (!r) return null;
    const p = window.BC_DATA.projects.find((x) => x.recording);
    const recover = () => {
      setGone((g) => g.concat([r.id]));
      app.toast('已恢复录制，放进了新视频', 'positive', {label: '打开', run: () => app.go({r: 'editor', id: p.id})});
    };
    const remove = () => app.confirm({title: '删除这次录制？', body: '录下的文件会被删除，不能撤销。', tone: 'negative', confirmLabel: '删除',
      run: () => { setGone((g) => g.concat([r.id])); app.toast('已删除录制。'); }});
    return <div className="nrec-recover" role="region" aria-label={r.title}>
      <span className="nrec-recover__ic"><Ic n="alert" className="ic--16" /></span>
      <div className="nrec-recover__b">
        <div className="t-title-sm">{r.title}</div>
        <div className="t-detail">{r.body}</div>
        {r.more ? <div className="t-detail-xs nrec-recover__more">{r.more}</div> : null}
      </div>
      <Btn variant="secondary" size="s" onClick={remove}>删除</Btn>
      <Btn variant="accent" size="s" onClick={recover}>恢复</Btn>
    </div>;
  }

  /** 会话里智能体的录制卡（§13）：等你开始 → 倒计时 / 正在录制 → 已放进视频；启动器按请求预先填好。 */
  function RecordingCard({request}) {
    const app = useApp();
    const st = useRecorder();
    const r = st.requests[request.id] || {state: 'waiting'};
    const line = REC.cardLine(r.state, r);
    const mine = !!st.session && !!st.session.request && st.session.request.id === request.id;
    const other = !!st.session && !mine;
    const act = () => {
      if (line.action === 'launcher') open({mode: 'agent', request, note: request.note});
      else if (line.action === 'video') app.go({r: 'editor', id: r.project || request.project});
    };
    const failed = line.tone === 'negative';
    return <section className={cx('dlcard', 'nrec-card', `is-${r.state}`)} aria-label="屏幕录制">
      <header className="dlcard__head">
        <span className="dlcard__ic"><Ic n={failed ? 'alert' : 'video'} className="ic--16" /></span>
        <span className="dlcard__titles">
          <span className="dlcard__title">屏幕录制</span>
          <span className="dlcard__name">{request.source === 'window' ? '一个窗口' : request.source === 'area' ? '一个区域' : '整块屏幕'}{request.camera && request.camera !== 'none' ? ' · 摄像头' : ''}{request.mic && request.mic !== 'none' ? ' · 麦克风' : ''}</span>
        </span>
        {line.live ? <span className="nrec-card__live" aria-hidden="true" /> : null}
      </header>
      <span className={cx('dlcard__line', failed && 'dlcard__err')} role="status">{line.text}</span>
      {line.action ? <div className="dlcard__foot">
        <span className="dlcard__time" />
        <Btn variant={line.action === 'launcher' ? 'accent' : 'secondary'} size="s" disabled={line.action === 'launcher' && (other || mine)} onClick={act}>{line.actionLabel}</Btn>
      </div> : null}
    </section>;
  }

  /* ---------- 设置 › 通用 ›「屏幕录制」（§6） ---------- */

  /** 一个全局快捷键：点一下进录制态，按下带修饰键的组合就绑定；没带修饰键时提示；有绑定时可以清掉。 */
  function ShortcutChip({k, label, value, onSet}) {
    const [rec, setRec] = useState(false);
    const [err, setErr] = useState('');
    useEffect(() => {
      if (!rec) return undefined;
      const onKey = (e) => {
        if (e.key === 'Escape') { setRec(false); setErr(''); return; }
        const r = REC.shortcutFrom(e);
        if (!r) return;
        e.preventDefault();
        if (!r.ok) { setErr(r.error); return; }
        onSet(r.label); setRec(false); setErr('');
      };
      window.addEventListener('keydown', onKey, true);
      return () => window.removeEventListener('keydown', onKey, true);
    }, [rec]);
    return <span className="rset-key">
      {err ? <span className="rset-key__err" role="alert">{err}</span> : null}
      <BCAction className={cx('chip', 'chip--click', 'rset-key__chip', rec && 'is-on', !value && !rec && 'is-empty')}
        aria-label={`${label}的快捷键`} onClick={() => { setRec((x) => !x); setErr(''); }}>
        {rec ? '按下按键…' : value || '未设置'}
      </BCAction>
      {value && !rec ? <R.ActionButton isQuiet size="S" aria-label={`清除${label}的快捷键`} onPress={() => onSet('')}><R.Icons.Close /></R.ActionButton> : null}
    </span>;
  }

  function RecordingSettingsGroup() {
    const Row = window.ShellRow;
    const st = useRecorder();
    const v = st.settings;
    const put = (p) => setSettings(p);
    const opts = (list) => list.map((c) => ({k: c.id, label: c.label}));
    return <section className="setpage__group" id="settings-recording" aria-label="屏幕录制">
      <h2>屏幕录制</h2>
      <div className="setpage__card">
        <Row label="倒计时" desc="按开始录制之后先倒数，数字出现在控制条的计时位。录制卡的齿轮菜单改的也是这一项。">
          <Segmented size="s" value={v.countdown} onChange={(x) => put({countdown: x})} items={opts(REC.COUNTDOWNS)} />
        </Row>
        <Row label="没有麦克风时先确认" desc="没选麦克风就开始时，先问一句，免得录完才发现没有声音。">
          <Switch ariaLabel="没有麦克风时先确认" on={v.confirmNoMic} onChange={(x) => put({confirmNoMic: x})} />
        </Row>
        <Row label="开始录制时主窗口" desc="屏幕上只留控制条，它不会被录进去。停止之后 BaoCut 回来并打开编辑器。">
          <Segmented size="s" value={v.mainWindow} onChange={(x) => put({mainWindow: x})} items={opts(REC.MAIN_WINDOW)} />
        </Row>
        <Row label="丢弃录制之后">
          <Segmented size="s" value={v.afterDiscard} onChange={(x) => put({afterDiscard: x})} items={opts(REC.AFTER_DISCARD)} />
        </Row>
        <Row label="缺省帧率" desc="60 fps 的文件大约大一倍。智能体发起的录制用它给的帧率。">
          <Segmented size="s" value={v.fps} onChange={(x) => put({fps: x})} items={opts(REC.FPS)} />
        </Row>
        <Row label="菜单栏图标" desc="从菜单栏直接录屏幕、窗口或区域。录制中点它就是停止。">
          <Switch ariaLabel="菜单栏图标" on={v.trayIcon} onChange={(x) => put({trayIcon: x})} />
        </Row>
      </div>
      <h3 className="rset-sub">全局快捷键</h3>
      <div className="setpage__card">
        {REC.SHORTCUT_ROWS.map((r) => <Row key={r.k} label={r.label} desc={r.desc}>
          <ShortcutChip k={r.k} label={r.label} value={v.shortcuts[r.k]}
            onSet={(x) => put({shortcuts: Object.assign({}, v.shortcuts, {[r.k]: x})})} />
        </Row>)}
      </div>
      <div className="signpost rset-note">缺省都不设：占着的组合键别的应用就用不了。每个快捷键都要带 ⌘、⌥ 或 ⌃；BaoCut 收起时也能用。</div>
    </section>;
  }

  Object.assign(window, {HomeRecord, HomeRecovery, RecordingHost, RecordingCard, RecordingSettingsGroup});
})();
