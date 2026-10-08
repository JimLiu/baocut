/* App 自动更新的纯模型（§17.7，2026-10-01）：状态机、设置 › 关于的状态行与按钮、toast 与重启确认的文案。
   只属于 App 外壳（设置页），Web 入口不加载（§22，登记在 model-surface.test.js 的 WEB_DENY）。
   态与文案逐字对着共享契约画；apps/baocut 照同一份落地，字符串一致才有对拍价值。
   时间一律由调用方传 `now`（unix 秒），这一层不读时钟。
   2026-10-05：三处改动（packages/ui 的 app-update 已同步）——
   ① 退出即安装：「已下载」时正常退出 BaoCut，退出途中换上新版本、不重新打开，下次启动就是新版本；
     「重启并更新」照旧（后台任务确认不变）。退出本来就停 Runtime 与后台任务，所以不另加确认；从不替用户重启。
   ② 下载好之后照常自动检查：「已下载」时也静默查，更新的 build 出来就作废旧下载、换成新版本，
     不让人先装一个旧版再更新一次（规则见状态机注释）。
   ③「已下载」= 已校验、已就位：校验（解包、核对 bundle id / 签名 / 公证）挪到下载完立即做，退出时只剩交给换包脚本。
     看得见的只有进度到 100% 之后一小段「正在校验 X…」——不加新态，downloading 的 pct = 100 就是校验中。
   2026-10-05 晚：补上 packages/ui 已有的停止屏障（架构设计 §2.6），文案逐字照它——「重启并更新」时有后台任务在跑，
     确认框给「现在停止并安装」/「等任务结束后安装」/「稍后」三个选择，并列出停了之后仍可能在远端运行或计费的任务；
     选「等」就进等待：关于页与更新窗写「还有 N 个后台任务在跑，都结束后自动安装。」，配「不等了」，数到 0 就安装，
     离开已下载就不等了（`ctx.waiting`）。等待时更新窗不再写「退出 BaoCut 时会自动安装，不用现在重启。」
     ——它和「都结束后自动安装」挨着读像两套说法（packages/ui 的 dialog 已同步）。 */
(function () {
  const FIRST_CHECK_DELAY_S = 15;      // 启动后多久做第一次自动检查
  const CHECK_INTERVAL_H = 6;          // 之后每隔多久再查一次
  const NOTES_MAX_LINES = 6;           // 版本说明最多显示几行
  const DOWNLOAD_PAGE = 'https://baocut.app/v2/';
  const FEEDS = {
    'aarch64-apple-darwin': 'https://baocut.app/v2/appcast-aarch64-apple-darwin.json',
    'x86_64-pc-windows-msvc': 'https://baocut.app/v2/appcast-x86_64-pc-windows-msvc.json',
  };
  /* 与 App 的 15 种界面语言一一对应；版本说明 `notesLocalized` 用同一套码。 */
  const LANGS = ['en', 'de', 'es', 'fr', 'it', 'ja', 'ko', 'nl', 'pl', 'pt-BR', 'ru', 'tr', 'vi', 'zh-Hans', 'zh-Hant'];
  const UI_LANG_CODE = {
    '简体中文': 'zh-Hans', '繁體中文': 'zh-Hant', 'English': 'en', '日本語': 'ja', '한국어': 'ko',
    'Español': 'es', 'Français': 'fr', 'Deutsch': 'de', 'Nederlands': 'nl', 'Português (BR)': 'pt-BR',
    'Italiano': 'it', 'Русский': 'ru', 'Polski': 'pl', 'Türkçe': 'tr', 'Tiếng Việt': 'vi',
  };
  /** 界面语言名 → 说明的语言码；「跟随系统」与没列出的落到 `fallback`（原型的系统语言按简体中文演示）。 */
  function langCode(uiLang, fallback) {
    return UI_LANG_CODE[uiLang] || fallback || 'zh-Hans';
  }

  /** 偏好 `appAutoUpdate` 缺席即开（与 App 的 `app_auto_update` 同语义）。 */
  function autoUpdateOn(prefs) {
    return !prefs || prefs.appAutoUpdate !== false;
  }

  /** 「上次检查：…」的相对时间。 */
  function relTime(thenSec, nowSec) {
    const d = Math.max(0, Math.floor(nowSec - thenSec));
    if (d < 60) return '刚刚';
    if (d < 3600) return `${Math.floor(d / 60)} 分钟前`;
    if (d < 86400) return `${Math.floor(d / 3600)} 小时前`;
    return `${Math.floor(d / 86400)} 天前`;
  }

  /** 下一次自动检查的时刻：启动后 15 s 先查一次，之后距上次检查满 6 小时再查。 */
  function nextAutoCheckAt(launchSec, lastCheckSec) {
    const first = launchSec + FIRST_CHECK_DELAY_S;
    if (lastCheckSec == null || lastCheckSec < launchSec) return first;
    return Math.max(first, lastCheckSec + CHECK_INTERVAL_H * 3600);
  }

  /** 清单里的版本比正在运行的新吗？只比 build（与 v1 同口径）。 */
  function isNewer(info, current) {
    return !!info && !!current && Number(info.build) > Number(current.build);
  }

  /** 当前语言的版本说明，最多 6 行；先取 notesLocalized[lang]，缺了回落英文 `notes`。 */
  function notesFor(info, lang) {
    if (!info) return {lines: [], more: false};
    const loc = info.notesLocalized || {};
    const raw = (lang && loc[lang]) || info.notes || '';
    const all = String(raw).split('\n').map((s) => s.trim()).filter(Boolean);
    return {lines: all.slice(0, NOTES_MAX_LINES), more: all.length > NOTES_MAX_LINES};
  }

  const verOf = (info) => `${info.version}（Build ${info.build}）`;

  /* ---------- 状态机 ----------
     态：unsupported{why: 'dev'|'appStore'} · idle · checking · upToDate · available{info, systemUnmet?}
         · downloading{info, pct} · ready{info, path} · installing{info} · error{msg, info?}
     事件：check{auto?} · found{info} · none · fail{msg} · download · progress{pct} · downloaded{path}
         · cancel · install
     `found` 带 `systemUnmet`（新版本要求的 macOS 版本，本机达不到）时停在 available，不能下载。
     自动检查（§17.7「何时检查」，2026-10-01 裁决）：「已下载」时不发起（2026-10-05 起改了，见下）；「有新版本」
     （含系统版本不够）时是静默的——显示态不变，只在 available 上挂 `bg: true`，侧栏按钮与开着的更新窗都留着，
     结果回来再落地：found 换成新版本信息、none 照规则到已是最新、fail 保持原态。手动检查照旧进 checking。
     2026-10-05：「已下载」时的自动检查也静默（挂 `bg: true`，侧栏按钮与更新窗照旧），结果回来——
       found 同一个 build → 留在已下载；found 别的 build → 旧下载作废，换成 available{新信息}（宿主随后照常
       自动下载或弹「可以更新了」）。「别的」不只是更新的：比已下载的旧、但仍比正在跑的新，说明已下载的那版被撤了，
       同样以更新源为准；found 更新的 build 但带 systemUnmet → 留在已下载：本机装不了新的，手里这版已校验、能装、
       也比正在跑的新，丢掉它只会让人停在旧版；none（更新源里已没有比正在跑的新的，例如那一版被撤下）→ 已是最新，
       不装已撤回的版本（正式版顺手删掉已下载的包）；fail → 留在已下载，一次网络抖动不丢下载好的更新。
       静默检查在途时退出，照样装已下载的那版，检查作废。 */
  const IDLE = {k: 'idle'};
  const BUSY = {checking: true, downloading: true, installing: true};

  /** 静默检查的起点：有新版本、已下载（2026-10-05 起）。显示态不变，只挂 `bg`。 */
  const QUIET = {available: true, ready: true};

  /** 节拍器这一拍能不能发起自动检查：Unsupported、正在查 / 下 / 装、静默检查已在途都不查。 */
  function mayAutoCheck(st) {
    const s = st || IDLE;
    return s.k !== 'unsupported' && !BUSY[s.k] && !(QUIET[s.k] && s.bg);
  }

  /** 去掉静默检查的在途标记。 */
  function settle(st) {
    const {bg, ...rest} = st;
    return rest;
  }
  function reduce(s, ev) {
    const st = s || IDLE;
    if (st.k === 'unsupported') return st;
    const quiet = !!(QUIET[st.k] && st.bg);   // 静默检查在途
    switch (ev.type) {
      case 'check':
        if (ev.auto) {
          if (!mayAutoCheck(st)) return st;
          if (QUIET[st.k]) return {...st, bg: true};   // 静默：显示态不变
        }
        if (BUSY[st.k]) return st;
        return {k: 'checking'};
      case 'found':
        if (st.k !== 'checking' && !quiet) return st;
        if (st.k === 'ready') {
          // 同一个 build：手里这版就是最新的；更新的 build 但本机系统不够：留着已校验、能装的这版（见上方注释）
          const same = Number(ev.info.build) === Number(st.info.build);
          if (same || (ev.systemUnmet && Number(ev.info.build) > Number(st.info.build))) return settle(st);
        }
        return ev.systemUnmet ? {k: 'available', info: ev.info, systemUnmet: ev.systemUnmet} : {k: 'available', info: ev.info};
      case 'none':
        return st.k === 'checking' || quiet ? {k: 'upToDate'} : st;
      case 'fail':
        // 静默检查失败保持原态（一次网络抖动不冲掉已找到 / 已下载的更新，同 App rules::after_check_failure）；
        // 手动检查失败、其余起点的自动检查失败、下载 / 校验失败照常进出错态。
        if (quiet) return settle(st);
        return {k: 'error', msg: ev.msg, info: st.info || null};
      case 'download':
        return ((st.k === 'available' && !st.systemUnmet) || (st.k === 'error' && st.info))
          ? {k: 'downloading', info: st.info, pct: 0} : st;
      case 'progress':
        return st.k === 'downloading' ? {...st, pct: Math.max(0, Math.min(100, Math.round(ev.pct)))} : st;
      case 'downloaded':
        return st.k === 'downloading' ? {k: 'ready', info: st.info, path: ev.path} : st;
      case 'cancel':
        return st.k === 'downloading' ? {k: 'available', info: st.info} : st;
      case 'install':
        return st.k === 'ready' ? {k: 'installing', info: st.info} : st;
      default:
        return st;
    }
  }

  /** 一次检查落地之后宿主接着做什么（2026-10-05 从宿主挪下来）：只有自动检查、且落到能下载的「有新版本」
      才跟进——自动下载开着就后台下载，关着就弹「可以更新了」；留在已下载、系统版本不够、手动检查都不跟进。 */
  function afterCheck(next, auto, autoUpdate) {
    if (!auto || !next || next.k !== 'available' || next.systemUnmet) return null;
    return autoUpdate ? 'download' : 'notify';
  }

  /** 下载到 100% 之后、进已下载之前的那一小段：校验（2026-10-05）。 */
  const verifying = (st) => st.k === 'downloading' && st.pct >= 100;

  /** 正常退出 BaoCut 时会不会顺手装更新：只有已下载（含静默检查在途）会。 */
  function quitInstalls(st) {
    return !!st && st.k === 'ready' && !!st.info;
  }

  /** 错误态的「重试」重做哪一步：带着版本信息的是下载 / 校验失败（重下），没有的是检查失败（重查）。 */
  function retryEvent(st) {
    return st && st.k === 'error' && st.info ? {type: 'download'} : {type: 'check'};
  }

  /** 设置 › 关于的状态块：一行状态（含色调）、版本说明、进度、按钮与链接。 */
  function view(st, ctx) {
    const c = ctx || {};
    const btn = (k, label, variant, disabled) => ({k, label, variant: variant || 'secondary', disabled: !!disabled});
    switch (st.k) {
      case 'unsupported':
        return {line: st.why === 'appStore' ? 'App Store 版本由 App Store 负责更新' : '开发构建不检查更新',
          tone: 'muted', actions: []};
      case 'checking':
        return {line: null, actions: [btn('check', '正在检查…', 'secondary', true)]};
      case 'upToDate':
        return {line: '已是最新版本', tone: 'positive', actions: [btn('check', '检查更新')]};
      case 'available':
        return st.systemUnmet
          ? {line: `有新版本 ${verOf(st.info)}`, tone: 'strong', notes: notesFor(st.info, c.lang),
            warn: `需要 macOS ${st.systemUnmet}`, actions: []}
          : {line: `有新版本 ${verOf(st.info)}`, tone: 'strong', notes: notesFor(st.info, c.lang),
            actions: [btn('download', '下载并安装', 'accent')]};
      case 'downloading':
        return {line: verifying(st) ? `正在校验 ${st.info.version}…` : `正在下载 ${st.info.version} · ${st.pct}%`,
          progress: st.pct, actions: [btn('cancel', '取消')]};
      case 'ready':
        // 在等后台任务结束后安装（`ctx.waiting` = 还有几个在跑；没在等时 null / 缺席）
        return c.waiting != null
          ? {line: `${st.info.version} 已下载，等后台任务结束后安装`, tone: 'strong',
            actions: [btn('restart', '重启并更新', 'accent')], link: {k: 'stopWaiting', label: '不等了'},
            sub: waitingText(c.waiting)}
          : {line: `${st.info.version} 已下载，退出 BaoCut 时自动安装`, tone: 'strong',
            actions: [btn('restart', '重启并更新', 'accent')]};
      case 'installing':
        return {line: null, actions: [btn('install', '正在安装…', 'accent', true)]};
      case 'error':
        return {line: st.msg, tone: 'negative', actions: [btn('retry', '重试')], link: {k: 'downloadPage', label: '前往下载页'}};
      case 'idle':
      default:
        return {line: null, actions: [btn('check', '检查更新')],
          sub: c.lastCheck != null && c.now != null ? `上次检查：${relTime(c.lastCheck, c.now)}` : null};
    }
  }

  /** 等待安装时的那句话：还有几个在跑；数到 0 时是安装前的那一瞬。 */
  function waitingText(running) {
    return running > 0 ? `还有 ${running} 个后台任务在跑，都结束后自动安装。` : '后台任务都结束了，正在安装…';
  }

  /** 这一版的全部说明（更新窗用，不截）；取语言的口径同 `notesFor`。 */
  function notesAll(info, lang) {
    if (!info) return [];
    const loc = info.notesLocalized || {};
    const raw = (lang && loc[lang]) || info.notes || '';
    return String(raw).split('\n').map((s) => s.trim()).filter(Boolean);
  }

  /* ---------- 侧栏更新按钮（§17.7「侧栏更新按钮与更新窗」，2026-10-01） ----------
     侧栏页脚「设置」行右侧的 accent 方钮。只在有事可做时出现：有新版本（系统版本够）、下载中、
     已下载、带着版本信息的出错；系统版本不够、检查失败（没有版本信息）与其余各态都不显示。
     glyph：download | ring（进度环，带 pct）| check；dot：white | positive | negative | null。 */
  const HIDDEN = {visible: false};
  function sideButton(st) {
    const s = st || IDLE;
    switch (s.k) {
      case 'available':
        return s.systemUnmet || !s.info ? HIDDEN
          : {visible: true, glyph: 'download', dot: 'white', tip: `有新版本 · BaoCut ${s.info.version}`};
      case 'downloading':
        return {visible: true, glyph: 'ring', pct: s.pct, dot: null,
          tip: verifying(s) ? '正在校验更新…' : `正在下载更新 · ${s.pct}%`};
      case 'ready':
        return {visible: true, glyph: 'check', dot: 'positive', tip: '更新已下载 · 退出时自动安装'};
      case 'error':
        return s.info ? {visible: true, glyph: 'download', dot: 'negative', tip: '更新出错 · 点击查看'} : HIDDEN;
      default:
        return HIDDEN;
    }
  }

  /* ---------- 更新窗（点侧栏按钮、或 toast「可以更新了」的「查看」打开；宽 480） ----------
     侧栏按钮不该显示的态一律返回 null——视图拿 null 当「窗自动关」。
     `ctx.current` 是正在运行的版本 {version, build}，`ctx.lang` 是说明的语言码。
     footer.left：null | {progress: pct, text} | {error: msg} | {note}；footer.buttons：[{k, label, variant}]，
     k ∈ later（只关窗）/ download / cancel / restart / downloadPage / retry / stopWaiting，动作与关于页同一套。
     2026-10-05：已下载时多一句 `note`（退出时也会装）；下载到 100% 的校验段，底栏左侧写「正在校验…」。
     2026-10-05 晚：`ctx.waiting` 同 `view`——在等时底栏左侧写等待那句、按钮换成「不等了」+「重启并更新」，
     `note` 不写（不和「都结束后自动安装」并排）。 */
  function dialog(st, ctx) {
    if (!sideButton(st).visible) return null;
    const c = ctx || {};
    const info = st.info;
    const btn = (k, label, variant) => ({k, label, variant: variant || 'secondary'});
    const later = btn('later', '稍后');
    const footer =
      st.k === 'available' ? {left: null, buttons: [later, btn('download', '下载并安装', 'accent')]}
      : st.k === 'downloading'
        ? {left: {progress: st.pct, text: verifying(st) ? '正在校验…' : `正在下载 · ${st.pct}%`}, buttons: [btn('cancel', '取消')]}
      : st.k === 'ready'
        ? c.waiting != null
          ? {left: {note: waitingText(c.waiting)}, buttons: [btn('stopWaiting', '不等了'), btn('restart', '重启并更新', 'accent')]}
          : {left: null, buttons: [later, btn('restart', '重启并更新', 'accent')]}
      : {left: {error: st.msg}, buttons: [btn('downloadPage', '前往下载页'), btn('retry', '重试', 'accent')]};
    return {
      title: st.k === 'ready' ? '更新已下载' : '有新版本',
      sub: `BaoCut ${info.version} · Build ${info.build}`,
      current: c.current ? `你现在用的是 BaoCut ${verOf(c.current)}。` : null,
      note: st.k === 'ready' && c.waiting == null ? '退出 BaoCut 时会自动安装，不用现在重启。' : null,
      notesTitle: '更新内容',
      notes: notesAll(info, c.lang),
      footer,
    };
  }

  /* ---------- toast 与重启确认 ---------- */
  /** 自动检查后台下载好了：每个 build 只弹一次（`toastedBuild` 是上次弹过的 build）。 */
  function readyToast(info, toastedBuild) {
    if (!info || Number(toastedBuild) === Number(info.build)) return null;
    return {text: `BaoCut ${info.version} 已下载，退出时自动安装`, action: '重启并更新'};
  }
  /** 自动下载关着时，自动检查发现了新版本。「查看」打开更新窗（2026-10-01 起；原来是打开设置 › 关于）。 */
  function availableToast(info) {
    return info ? {text: `BaoCut ${info.version} 可以更新了`, action: '查看', opens: 'updateWindow'} : null;
  }
  /* ---------- 安装前的停止屏障（架构设计 §2.6，2026-10-05 晚） ---------- */
  /** 原型的后台任务行 → 屏障里的一条 {id, title, where, remote}：只算在跑的；跑在哪写着云端 / 远端的算远端
      （停了之后服务商那边可能还在跑、还在计费）。演示数据里在跑的都在本机，所以远端那段演示不出来。 */
  function barrierTasks(tasks) {
    return (tasks || []).filter((t) => t.status === 'running').map((t) => {
      const where = t.runsOn || t.sub || '';
      return {id: t.id, title: t.title || t.sub || t.id, where, remote: /云端|远端/.test(where)};
    });
  }
  /** 点「重启并更新」：有后台任务在跑先问——「现在停止并安装」/「等任务结束后安装」/「稍后」，并列出停了之后
      仍可能在远端运行或计费的任务；没有任务在跑时返回 null，直接安装。 */
  function restartAsk(tasks) {
    const list = tasks || [];
    const n = list.length;
    if (!n) return null;
    const remote = list.filter((t) => t.remote).map(({id, title, where}) => ({id, title, where}));
    return {title: '现在重启并更新？',
      body: `有 ${n} 个后台任务正在运行，重启会中断它们，之后可以重新开始。`,
      remoteTitle: remote.length ? '下面这些在远端运行，停止后服务商那边可能仍在运行或计费：' : null,
      remote,
      stopLabel: '现在停止并安装', waitLabel: '等任务结束后安装', cancelLabel: '稍后'};
  }

  const AUTO_ROW = {
    label: '自动检查并下载更新',
    desc: '启动时和之后每 6 小时检查一次；下载好的更新在你下次退出时安装，也可以马上重启更新，不会自己重启。',
  };

  /* ---------- 原型演示 ----------
     演示 feed 里的那一版：比 data.js 的 2.2.1（Build 56）新一个 build。说明故意给 7 行，看得到截成 6 行。 */
  const DEMO_INFO = {
    version: '2.3.0', build: 57, date: '2026-10-01', minimumSystemVersion: '14.0',
    notes: 'Settings › About checks for updates and installs them for you.\nExports keep subtitle styles on every track.\nTimeline zoom remembers where you left it.\nThe Agent picks up the movie you are looking at.\nFaster first frame when opening long movies.\nSmaller download for the speech models.\nAssorted fixes.',
    notesLocalized: {
      'zh-Hans': '设置 › 关于可以检查更新，下载好后替你安装。\n导出时每条字幕轨都保留各自的样式。\n时间轴缩放记住你上次停在哪。\nAgent 默认接手你正在看的视频。\n打开长视频时第一帧出得更快。\n语音模型的下载变小了。\n其他修复。',
    },
    app: {format: 'zip', url: 'https://baocut.app/downloads/BaoCut-2.3.0-build.57-aarch64-apple-darwin.zip',
      size: 168204331},
  };
  /** 「已下载」之后更新源又发了一版（2026-10-05，演示旧下载被作废）。 */
  const DEMO_INFO_NEXT = {
    ...DEMO_INFO, version: '2.3.1', build: 58, date: '2026-10-04',
    notes: 'Fixes a crash when exporting with burned-in subtitles.\n' + DEMO_INFO.notes,
    notesLocalized: {'zh-Hans': '修复烧录字幕导出时可能闪退的问题。\n' + DEMO_INFO.notesLocalized['zh-Hans']},
    app: {format: 'zip', url: 'https://baocut.app/downloads/BaoCut-2.3.1-build.58-aarch64-apple-darwin.zip',
      size: 168311902},
  };
  /** 演示里下载好的包放在哪。 */
  function demoPath(info) {
    return `~/Library/Caches/BaoCut/Updates/BaoCut-${info.version}-build.${info.build}-aarch64-apple-darwin.zip`;
  }
  /** 「模拟退出 BaoCut」的 toast：原型不真退，只说正式版这时会做什么。 */
  function quitDemoText(st) {
    return quitInstalls(st)
      ? `原型演示：正式版这时退出并装好 ${st.info.version}，下次打开就是新版本`
      : '原型演示：正式版这时直接退出，没有下载好的更新要装';
  }
  const DEMO_ERRORS = {
    check: '连不上更新服务器，检查网络后再试。',
    verify: '下载的文件没有通过校验，已经删掉。',
  };
  /** 演示开关里的一排态：点哪个就直接落到哪个态（带演示数据）。 */
  const DEMO_STATES = [
    {k: 'idle', label: '空闲'},
    {k: 'checking', label: '检查中'},
    {k: 'upToDate', label: '已是最新'},
    {k: 'available', label: '有新版本'},
    {k: 'blocked', label: '系统版本不够'},
    {k: 'downloading', label: '下载中'},
    {k: 'verifying', label: '校验中'},
    {k: 'ready', label: '已下载'},
    {k: 'installing', label: '安装中'},
    {k: 'errorCheck', label: '检查失败'},
    {k: 'errorVerify', label: '校验失败'},
    {k: 'dev', label: '开发构建'},
    {k: 'appStore', label: 'App Store 版'},
  ];
  function demoState(k) {
    const info = DEMO_INFO;
    switch (k) {
      case 'checking': return {k: 'checking'};
      case 'upToDate': return {k: 'upToDate'};
      case 'available': return {k: 'available', info};
      case 'blocked': return {k: 'available', info, systemUnmet: '27.0'};
      case 'downloading': return {k: 'downloading', info, pct: 42};
      case 'verifying': return {k: 'downloading', info, pct: 100};
      case 'ready': return {k: 'ready', info, path: demoPath(info)};
      case 'installing': return {k: 'installing', info};
      case 'errorCheck': return {k: 'error', msg: DEMO_ERRORS.check, info: null};
      case 'errorVerify': return {k: 'error', msg: DEMO_ERRORS.verify, info};
      case 'dev': return {k: 'unsupported', why: 'dev'};
      case 'appStore': return {k: 'unsupported', why: 'appStore'};
      default: return {k: 'idle'};
    }
  }
  /** 演示开关上哪一格亮。 */
  function demoKeyOf(st) {
    if (st.k === 'unsupported') return st.why === 'appStore' ? 'appStore' : 'dev';
    if (st.k === 'error') return st.info ? 'errorVerify' : 'errorCheck';
    if (st.k === 'available' && st.systemUnmet) return 'blocked';
    if (verifying(st)) return 'verifying';
    return st.k;
  }

  window.BC_UPDATE = {
    FIRST_CHECK_DELAY_S, CHECK_INTERVAL_H, NOTES_MAX_LINES, DOWNLOAD_PAGE, FEEDS, LANGS, AUTO_ROW,
    langCode, autoUpdateOn, relTime, nextAutoCheckAt, isNewer, notesFor, notesAll,
    reduce, mayAutoCheck, afterCheck, quitInstalls, retryEvent, view, sideButton, dialog, readyToast, availableToast, restartAsk,
    waitingText, barrierTasks,
    DEMO_INFO, DEMO_INFO_NEXT, DEMO_ERRORS, DEMO_STATES, demoState, demoKeyOf, demoPath, quitDemoText,
  };
})();
