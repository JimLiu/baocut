/* 录制启动器、选取覆盖层、控制条、托盘、智能体录制卡与恢复提示的纯规则：window.BC_REC（录屏界面重设计 §1–§7，
   交互对齐 Cap 桌面端；不变的部分见屏幕录制设计 docs/design/screen-recording §11、§13；product-design §3.2.1、§4.8、§5.9）。
   只在 App 入口加载——录制只在桌面端、Runtime 就在这台电脑上时才有入口。区域几何与各个小窗的位置在 model-recording-area.js。
   对照实现 packages/ui/src/model/recording.ts；本轮的启动器、覆盖层、控制条与设置是原型先行，实现等原型确认后再改。 */
(function () {
  /** 「把 BaoCut 也录进去」只对整块屏幕与区域有意义：录一个窗口时本来就只录那个窗口。 */
  const showsIncludeSelf = (source) => source === 'display' || source === 'area';
  const selfNote = (source, includeSelf) => (!showsIncludeSelf(source) ? '' : includeSelf
    ? 'BaoCut 的窗口也会出现在画面里，控制条除外。'
    : 'BaoCut 自己的窗口不会录进去。');

  /* ---------- 磁盘空间 ---------- */

  /** 大致的码率（字节 / 分钟）：按像素数与帧率估，屏幕内容大多是静止画面，比摄像机画面省得多。 */
  function bytesPerMinute(width, height, fps, withCamera) {
    const px = Math.max(1, width * height);
    const screen = px * (fps || 30) * 60 * 0.035;
    return Math.round(screen + (withCamera ? 45e6 : 0) + 6e6);
  }
  /** 还能录多少分钟（向下取整）。 */
  const minutesLeft = (freeBytes, perMinute) => Math.max(0, Math.floor(freeBytes / Math.max(1, perMinute)));
  const LOW_DISK_MINUTES = 10;
  const gb = (b) => (b / 1e9).toFixed(1).replace(/\.0$/, '') + ' GB';
  /** 磁盘一行：够用时只是一句说明，不足 LOW_DISK_MINUTES 分钟时是一条提醒（仍能开始）。启动器只在 low 时出底部提示。 */
  function diskLine(freeBytes, perMinute) {
    const left = minutesLeft(freeBytes, perMinute);
    if (left < LOW_DISK_MINUTES) {
      return {low: true, title: '磁盘空间不多了',
        text: `录到的文件存在这个项目所在的磁盘上，那里只剩 ${gb(freeBytes)}，按现在的设置大约能录 ${left} 分钟。空间用完时录制会自动停止并保存已经录下的部分。`};
    }
    return {low: false, text: `这块磁盘还剩 ${gb(freeBytes)}，大约能录 ${left > 120 ? '2 小时以上' : left + ' 分钟'}。`};
  }

  /* ---------- 时钟 ---------- */

  /** 「分:秒」，过一小时「时:分:秒」（控制条用等宽数字）。 */
  const clock = (s) => {
    const t = Math.max(0, Math.floor(s));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = String(t % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  };

  /* ---------- 落点（§1 第 2 行、§2 开始按钮的第二行） ---------- */

  /**
   * 启动器的落点行。mode：`new`（Home / Space / 托盘 / 工具页：项目里的一个新视频）、`into`（编辑器：加进当前视频）、
   * `agent`（会话里智能体的 `record`）。返回 {text, note?, back}：back 为真时行尾有「回到编辑器」的 ×。
   */
  function landing(mode, x) {
    const o = x || {};
    if (mode === 'into') return {text: `加进 ${o.video || '当前视频'}`, back: true};
    if (mode === 'agent') return {text: '智能体请求录制', note: o.note || '', back: false};
    return {text: o.project ? `新视频 · ${o.project}` : '新视频', back: false};
  }
  /** 录制卡开始按钮的第二行小字。 */
  const startNote = (mode) => (mode === 'into' ? '加进当前视频' : '录成新视频');

  /* ---------- 设备与药丸（§1 第 4 项、§2 录制卡第二块） ---------- */

  /**
   * 设备行右侧的药丸：没有权限 → 「允许」（警示色，点它打开系统设置）；没选 → 「关」；选的设备不在了 → 「未连接」；否则「开」。
   * 系统声音没有设备与权限，只有开 / 关。返回 {state, label, action}：action 是点药丸做的事。
   */
  function pill(o) {
    if (o.permission === false) return {state: 'allow', label: '允许', action: 'open-settings'};
    if (!o.on) return {state: 'off', label: '关', action: 'open-list'};
    if (o.connected === false) return {state: 'missing', label: '未连接', action: 'open-list'};
    return {state: 'on', label: '开', action: 'turn-off'};
  }
  /** 设备行的名字：没选时「不用摄像头」/「不用麦克风」；系统声音是两句开关文案。 */
  function deviceName(kind, dev) {
    if (kind === 'system') return dev ? '录系统声音' : '不录系统声音';
    if (!dev) return kind === 'camera' ? '不用摄像头' : '不用麦克风';
    return dev.label;
  }
  /** 原地列表的搜索：不分大小写，按名字包含。 */
  const filterList = (items, q) => {
    const k = String(q || '').trim().toLowerCase();
    return k ? items.filter((x) => String(x.label).toLowerCase().includes(k)) : items;
  };
  /** 设置 › 隐私的对应一项（BaoCut 不替用户改系统设置，只打开它）。 */
  const PERMISSION_PANE = {screen: '屏幕与系统录音', camera: '摄像头', mic: '麦克风'};

  /* ---------- 一次录制的状态机（§1–§3、§7） ---------- */

  /**
   * phase：`launcher`（启动器）→ `picker`（选取覆盖层，启动器隐藏）→ `countdown` → `starting` → `recording` ⇄ `paused`
   * → `finishing` → `closed`。`step(s, ev)` 返回下一个状态，不改入参；不认识的事件原样返回。
   *  · pick(kind)：启动器里点一格打开覆盖层；覆盖层开着时再点同一格是取消。
   *  · escape / close-card：覆盖层回到启动器。close-launcher：关掉启动器（这次录制作废）。
   *  · start：有倒计时进 countdown（left = 倒计时秒数），没有就直接 starting。tick 每秒减一，到 0 进 starting。
   *  · started：starting → recording。pause / resume 互换。stop → finishing；finished → closed。
   *  · discard：丢弃；afterDiscard 为 `launcher` 时回到启动器，否则 closed。restart：丢弃后用同样的选择再开始（倒计时里也行，重新倒数）。
   *  · sleep：电脑要睡眠。录制中自动暂停并记下 `slept`（控制条提示一次，继续后去掉）；倒计时或正在开始时取消，醒来不自己开始。
   */
  function step(s, ev) {
    const e = typeof ev === 'string' ? {type: ev} : ev;
    const to = (patch) => Object.assign({}, s, patch);
    const live = s.phase === 'countdown' || s.phase === 'starting' || s.phase === 'recording' || s.phase === 'paused';
    switch (e.type) {
      case 'pick':
        if (s.phase === 'picker' && s.kind === e.kind) return to({phase: 'launcher'});
        if (s.phase === 'launcher' || s.phase === 'picker') return to({phase: 'picker', kind: e.kind});
        return s;
      case 'escape': case 'close-card': return s.phase === 'picker' ? to({phase: 'launcher'}) : s;
      case 'close-launcher': return s.phase === 'launcher' ? to({phase: 'closed', outcome: 'cancelled'}) : s;
      case 'start':
        if (s.phase !== 'picker') return s;
        return (e.countdown || 0) > 0 ? to({phase: 'countdown', left: e.countdown, countdown: e.countdown, elapsed: 0})
          : to({phase: 'starting', countdown: 0, elapsed: 0});
      case 'tick':
        if (s.phase === 'countdown') return s.left > 1 ? to({left: s.left - 1}) : to({phase: 'starting', left: 0});
        if (s.phase === 'recording') return to({elapsed: (s.elapsed || 0) + 1});
        return s;
      case 'started': return s.phase === 'starting' ? to({phase: 'recording'}) : s;
      case 'pause': return s.phase === 'recording' ? to({phase: 'paused'}) : s;
      case 'resume': return s.phase === 'paused' ? to({phase: 'recording', slept: false}) : s;
      case 'sleep':
        if (s.phase === 'recording') return to({phase: 'paused', slept: true});
        return s.phase === 'countdown' || s.phase === 'starting' ? to({phase: 'closed', outcome: 'cancelled'}) : s;
      case 'stop':
        if (s.phase === 'recording' || s.phase === 'paused') return to({phase: 'finishing'});
        /* 倒计时里点停止：还没录下东西，等于取消 */
        return s.phase === 'countdown' || s.phase === 'starting' ? to({phase: 'closed', outcome: 'cancelled'}) : s;
      case 'finished': return s.phase === 'finishing' ? to({phase: 'closed', outcome: 'done'}) : s;
      case 'discard':
        if (!live) return s;
        return e.afterDiscard === 'launcher' ? to({phase: 'launcher', elapsed: 0, outcome: 'discarded'}) : to({phase: 'closed', outcome: 'discarded'});
      case 'restart':
        if (!live) return s;
        return (s.countdown || 0) > 0 ? to({phase: 'countdown', left: s.countdown, elapsed: 0}) : to({phase: 'starting', elapsed: 0});
      default: return s;
    }
  }

  /** 控制条第一格（停止 + 计时）的字：倒计时期间是倒数的数字；其他状态字。 */
  function barStatus(s) {
    switch (s.phase) {
      case 'countdown': return {text: String(s.left), kind: 'countdown'};
      case 'starting': return {text: '正在开始', kind: 'word'};
      case 'paused': return {text: '已暂停', kind: 'word'};
      case 'finishing': return {text: '正在收尾…', kind: 'word'};
      default: return {text: clock(s.elapsed || 0), kind: 'clock'};
    }
  }
  /** 控制条上各个按钮能不能点：倒计时期间不能暂停（停止等于取消）；收尾时都不能点。 */
  function barActions(phase) {
    const rec = phase === 'recording' || phase === 'paused';
    const pre = phase === 'countdown' || phase === 'starting';
    return {stop: rec || pre, pause: rec, restart: rec || pre, discard: rec || pre};
  }

  /** 没有麦克风时开始前要不要先确认（§2 录制卡末条）。 */
  const needsMicConfirm = (mic, settings) => (!mic || mic === 'none') && !!(settings && settings.confirmNoMic);

  /* ---------- 托盘 / 菜单栏（§5） ---------- */

  /** 不在录制时的托盘菜单；录制中单击直接停止，不弹菜单（返回 null）。 */
  function trayMenu(recording) {
    if (recording) return null;
    return [
      {id: 'open', label: '打开 BaoCut'},
      {id: 'sep1', sep: true},
      {id: 'display', label: '录制屏幕'},
      {id: 'window', label: '录制窗口'},
      {id: 'area', label: '录制区域'},
      {id: 'sep2', sep: true},
      {id: 'settings', label: '设置'},
      {id: 'quit', label: '退出 BaoCut'},
    ];
  }

  /* ---------- 智能体的录制卡（§13） ---------- */

  /** 录制卡的状态 → 一行说明与按钮。`waiting` 时打开预先填好的录制启动器；放进视频后能打开视频。 */
  function cardLine(state, extra) {
    const x = extra || {};
    switch (state) {
      case 'waiting': return {text: '等你开始录制', action: 'launcher', actionLabel: '打开录制启动器'};
      case 'countdown': return {text: `${x.left || 3} 秒后开始…`};
      case 'recording': return {text: '正在录制 · ' + clock(x.elapsed || 0), live: true};
      case 'paused': return {text: '已暂停 · ' + clock(x.elapsed || 0)};
      case 'finishing': return {text: '正在收尾…'};
      case 'done': return {text: `已放进视频 · ${clock(x.elapsed || 0)}`, action: 'video', actionLabel: '打开视频', tone: 'positive'};
      case 'cancelled': return {text: '已取消录制。', tone: 'neutral'};
      case 'discarded': return {text: '录制已丢弃', tone: 'neutral'};
      case 'failed': return {text: x.error || '录制没有完成。', tone: 'negative'};
      default: return {text: ''};
    }
  }

  /* ---------- 没有收完的录制（§11 恢复） ---------- */

  /** 启动页顶上的恢复提示：只讲最新的一次，其余几次合成一句。 */
  function recoveryText(list) {
    const items = (list || []).slice().sort((a, b) => (a.ago || 0) - (b.ago || 0));
    if (!items.length) return null;
    const r = items[0];
    return {
      id: r.id,
      title: '有一次没有收完的录制',
      body: `${r.date}的录制（${clock(r.duration)}）在放进视频之前中断了。可以恢复，或者删掉录下的文件。`,
      more: items.length > 1 ? `还有 ${items.length - 1} 次没有收完的录制` : '',
    };
  }

  /* ---------- 设置 › 通用 › 屏幕录制（§6） ---------- */

  const COUNTDOWNS = [{id: '0', label: '关'}, {id: '3', label: '3 秒'}, {id: '5', label: '5 秒'}, {id: '10', label: '10 秒'}];
  const FPS = [{id: '30', label: '30 fps'}, {id: '60', label: '60 fps'}];
  const MAIN_WINDOW = [{id: 'background', label: '关闭到后台'}, {id: 'minimize', label: '最小化'}];
  const AFTER_DISCARD = [{id: 'none', label: '什么也不做'}, {id: 'launcher', label: '重新打开启动器'}];
  /** 全局快捷键：缺省都不设（§6）。 */
  const SHORTCUT_ROWS = [
    {k: 'launcher', label: '打开录制启动器'},
    {k: 'display', label: '录制屏幕', desc: '直接打开屏幕的选取覆盖层。'},
    {k: 'window', label: '录制窗口'},
    {k: 'area', label: '录制区域'},
    {k: 'stop', label: '停止录制'},
    {k: 'pause', label: '暂停与继续'},
    {k: 'restart', label: '重新开始'},
  ];
  const SETTINGS_DEFAULTS = {
    shortcuts: SHORTCUT_ROWS.reduce((o, r) => Object.assign(o, {[r.k]: ''}), {}),
    fps: '30', countdown: '3', confirmNoMic: true, mainWindow: 'background', afterDiscard: 'none', trayIcon: true,
  };
  /* 上一版原型落过盘的缺省快捷键：读到原样的旧缺省就当作没设 */
  const OLD_DEFAULT_KEYS = ['⌥⇧⌘R', '⌥⇧⌘S', '⌥⇧⌘P', '⌘⇧2', '⌘⇧3'];
  const pickId = (list, v, d) => (list.some((x) => x.id === v) ? v : d);
  /** 读回存下的设置：只认现在的字段，取值不在选项里就用缺省；旧版的缺省快捷键丢掉。 */
  function mergeSettings(saved) {
    const v = saved && typeof saved === 'object' ? saved : {};
    const D = SETTINGS_DEFAULTS;
    const keys = {};
    SHORTCUT_ROWS.forEach((r) => {
      const k = v.shortcuts && typeof v.shortcuts[r.k] === 'string' ? v.shortcuts[r.k] : '';
      keys[r.k] = OLD_DEFAULT_KEYS.indexOf(k) >= 0 ? '' : k;
    });
    return {
      shortcuts: keys,
      fps: pickId(FPS, v.fps, D.fps),
      countdown: pickId(COUNTDOWNS, v.countdown, D.countdown),
      confirmNoMic: typeof v.confirmNoMic === 'boolean' ? v.confirmNoMic : D.confirmNoMic,
      mainWindow: pickId(MAIN_WINDOW, v.mainWindow, D.mainWindow),
      afterDiscard: pickId(AFTER_DISCARD, v.afterDiscard, D.afterDiscard),
      trayIcon: typeof v.trayIcon === 'boolean' ? v.trayIcon : D.trayIcon,
    };
  }
  const MOD_KEYS = ['Meta', 'Alt', 'Control', 'Shift'];
  /**
   * 设置里录快捷键：一次按键 → {ok: true, label: '⌃⌥R'}；只按了修饰键返回 null（继续等）；不带修饰键 → {ok: false}。
   * 每个快捷键必须含 ⌘ / ⌥ / ⌃ 之一（只按 Shift 加字母会和打字冲突）。
   */
  function shortcutFrom(e) {
    if (!e || MOD_KEYS.indexOf(e.key) >= 0) return null;
    if (!e.metaKey && !e.altKey && !e.ctrlKey) return {ok: false, error: '快捷键要带 ⌘、⌥ 或 ⌃'};
    const code = String(e.code || '');
    const key = /^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit\d$/.test(code) ? code.slice(5) : String(e.key || '').toUpperCase();
    return {ok: true, label: (e.ctrlKey ? '⌃' : '') + (e.altKey ? '⌥' : '') + (e.shiftKey ? '⇧' : '') + (e.metaKey ? '⌘' : '') + key};
  }

  /* ---------- 原型的演示设备与桌面（名字都是虚构的） ---------- */

  /**
   * 原型把浏览器视口当作一块屏幕：窗口按视口的比例摆（fx / fy / fw / fh），叠放次序从下到上；`tone` 是模拟窗口里
   * 几块示意内容的色系。内建屏 30 fps 磁盘够录，外接 4K 屏会出磁盘提醒。会议室摄像头是一台不在了的设备（未连接）。
   */
  const DEMO = {
    freeBytes: 4.8e9,
    displays: [
      {id: 'd1', label: '内建显示器', w: 2560, h: 1600, main: true},
      {id: 'd2', label: '外接显示器', w: 3840, h: 2160},
    ],
    windows: [
      {id: 'w1', app: '文稿编辑器', title: '第 5 讲提纲', icon: 'text', tone: 'gray', fx: 0.06, fy: 0.1, fw: 0.42, fh: 0.56},
      {id: 'w2', app: '浏览器', title: '课程主页', icon: 'web', tone: 'blue', fx: 0.36, fy: 0.16, fw: 0.5, fh: 0.62},
      {id: 'w3', app: '终端', title: 'build', icon: 'code', tone: 'dark', fx: 0.12, fy: 0.6, fw: 0.34, fh: 0.3},
      {id: 'w4', app: '音乐', title: '正在播放', icon: 'music', tone: 'purple', fx: 0.72, fy: 0.62, fw: 0.22, fh: 0.26},
    ],
    cameras: [
      {id: 'c1', label: '内建摄像头'},
      {id: 'c2', label: '外接摄像头'},
      {id: 'c3', label: '会议室摄像头', connected: false},
    ],
    mics: [
      {id: 'default', label: '系统默认（内建麦克风）'},
      {id: 'm1', label: '外接麦克风'},
    ],
  };

  /* ---------- 原型的「录好的一段」 ---------- */

  /**
   * 原型不真的录：停止时按启动器里的选择，从示例录制裁出一段 `seconds` 秒长的录制（第 n 次，id 与文件名都带 n）。
   * 光标选「录进画面」/「不要光标」时取景文档里不带光标设置，检查器的光标组置灰；没开摄像头、麦克风、系统声音就少那几路。
   * 返回 {rec, sources}：sources 是要加进素材库的视频 / 音频文件（同示例的渐变示意）。
   */
  function takeFrom(demo, n, opts, demoSources) {
    const o = opts || {};
    const len = Math.max(8, Math.min(demo.duration, Math.round(o.seconds || 24)));
    const tag = 'take' + n;
    const s = demo.streams;
    const streams = {screen: Object.assign({}, s.screen, {asset: `screen-${tag}.mp4`})};
    if (o.camera && o.camera !== 'none') streams.camera = Object.assign({}, s.camera, {asset: `camera-${tag}.mp4`});
    if (o.mic && o.mic !== 'none') streams.microphone = {asset: `microphone-${tag}.m4a`};
    if (o.system) streams.system = {asset: `system-audio-${tag}.m4a`};
    const pointer = o.cursor || 'separate';
    const inside = (t) => t < len;
    const rec = {
      id: 'rec-' + tag, view: 'sv-' + tag, link: 'lg-' + tag, duration: len, date: '刚刚', pointer, streams,
      clicks: pointer === 'none' ? [] : demo.clicks.filter((c) => inside(c.t)),
      zooms: pointer === 'none' ? [] : demo.zooms.filter((z) => z.origin === 'auto' && z.t1 <= len).map((z) => ({id: z.id, t0: z.t0, t1: z.t1, scale: 2, focus: {kind: 'pointer'}, origin: 'auto'})),
      follow: demo.follow,
      cursor: pointer === 'separate' ? demo.cursor : null,
    };
    const src = demoSources || {video: [], audio: []};
    const copy = (list, i, asset, id) => (list[i] ? Object.assign({}, list[i], {id, name: asset, dur: len}) : null);
    const sources = {
      video: [copy(src.video, 0, streams.screen.asset, 'rv-' + tag + '-s'), streams.camera && copy(src.video, 1, streams.camera.asset, 'rv-' + tag + '-c')].filter(Boolean),
      audio: [streams.microphone && copy(src.audio, 0, streams.microphone.asset, 'ra-' + tag + '-m'), streams.system && copy(src.audio, 1, streams.system.asset, 'ra-' + tag + '-s')].filter(Boolean),
    };
    return {rec, sources};
  }

  window.BC_REC = {
    showsIncludeSelf, selfNote, bytesPerMinute, minutesLeft, LOW_DISK_MINUTES, diskLine, clock,
    landing, startNote, pill, deviceName, filterList, PERMISSION_PANE,
    step, barStatus, barActions, needsMicConfirm, trayMenu,
    cardLine, recoveryText,
    COUNTDOWNS, FPS, MAIN_WINDOW, AFTER_DISCARD, SHORTCUT_ROWS, SETTINGS_DEFAULTS, mergeSettings, shortcutFrom,
    DEMO, takeFrom,
  };
})();
