/* 设置 › 视频下载的「网站登录」（product-design §2.7「下载视频」，architecture §7.9 Cookie、§12.9「本机浏览器」）——window.BC_TOOL_COOKIES。
   纯函数，无 React、无 DOM；只在 App 入口加载。

   - Chrome 始终保留为默认选项，其余列出 Runtime 检测到有 Cookie 库或访问被拒绝的浏览器（`externalTools.cookieBrowsers`），最近用过的在前。
   - 勾选的浏览器按列出的顺序逐个试（不是按点选的先后）：读不到 Cookie 或网站仍要求登录时换下一个，用上一个就停。
   - 「所有浏览器」在界面上是全选检测到的（只勾了一部分时半选），提交给下载的仍是浏览器列表。都不勾是匿名下载。
   - 这是一项设置，下载视频工具、从链接转录与智能体下载都用它。默认带 Cookie：没设置过是 `ALL`（Chrome 与其他检测到的浏览器）；
     勾成全选时也存回 `ALL`，之后新检测到的浏览器跟着算进去；其余存浏览器列表，空列表是匿名下载。 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;

  const LABEL = {chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox', safari: 'Safari', brave: 'Brave', chromium: 'Chromium',
    opera: 'Opera', vivaldi: 'Vivaldi', whale: 'Whale'};
  /* Chromium 内核：macOS 上 Cookie 用钥匙串里的密钥加密、读取时会弹授权；Windows 上浏览器开着时 Cookie 库被占用（yt-dlp #7271） */
  const CHROMIUM = ['chrome', 'edge', 'brave', 'chromium', 'opera', 'vivaldi', 'whale'];
  /* Windows 上用应用绑定加密（App-Bound Encryption）保护 Cookie、yt-dlp 目前解不开的（yt-dlp #10927，2026-10 核对）：
     Chrome 127 起的系统级安装、Edge（总是系统级安装）、Brave 的系统级安装。Opera、Vivaldi 目前没有启用，不在此列 */
  const APP_BOUND = ['chrome', 'edge', 'brave'];

  /* 原型的演示挡位：Runtime 所在主机 → 检测结果。真实客户端里来自 Runtime，按 Cookie 库的修改时间排好；
     Safari 没有完全磁盘访问权限时时间为空 */
  const DEMO_DETECTED = {
    darwin: {
      several: [
        {id: 'chrome', label: 'Chrome', lastUsedAt: '2026-10-06T09:42:00Z'},
        {id: 'safari', label: 'Safari', lastUsedAt: '2026-10-05T21:10:00Z'},
        {id: 'firefox', label: 'Firefox', lastUsedAt: '2026-09-28T14:03:00Z'},
        {id: 'edge', label: 'Edge', lastUsedAt: '2026-08-17T08:30:00Z'},
      ],
      one: [{id: 'safari', label: 'Safari', lastUsedAt: null, accessDenied: true},
        {id: 'chrome', label: 'Chrome', lastUsedAt: null, cookieStoreMissing: true}],
      denied: [{id: 'safari', label: 'Safari', lastUsedAt: '2026-10-05T21:10:00Z'},
        {id: 'chrome', label: 'Chrome', lastUsedAt: null, accessDenied: true}],
      none: [{id: 'chrome', label: 'Chrome', lastUsedAt: null, cookieStoreMissing: true}],
    },
    win32: {
      several: [
        {id: 'chrome', label: 'Chrome', lastUsedAt: '2026-10-06T09:42:00Z'},
        {id: 'firefox', label: 'Firefox', lastUsedAt: '2026-10-05T21:10:00Z'},
        {id: 'edge', label: 'Edge', lastUsedAt: '2026-09-28T14:03:00Z'},
        {id: 'brave', label: 'Brave', lastUsedAt: '2026-08-17T08:30:00Z'},
      ],
      one: [{id: 'edge', label: 'Edge', lastUsedAt: '2026-10-02T11:20:00Z'},
        {id: 'chrome', label: 'Chrome', lastUsedAt: null, cookieStoreMissing: true}],
      denied: [{id: 'chrome', label: 'Chrome', lastUsedAt: null, accessDenied: true}],
      none: [{id: 'chrome', label: 'Chrome', lastUsedAt: null, cookieStoreMissing: true}],
    },
  };

  const label = (id) => LABEL[id] || id;
  const hostOf = (platform) => (platform === 'win32' ? 'win32' : 'darwin');
  /** 演示的检测结果：这台主机上的那一个挡位，没有时是检测到几个的那一档。 */
  const demoDetected = (platform, scene) => DEMO_DETECTED[hostOf(platform)][scene] || DEMO_DETECTED[hostOf(platform)].several;
  /** 演示挡位的名字按这台主机的检测结果写。 */
  function demoScenes(platform) {
    const d = DEMO_DETECTED[hostOf(platform)];
    return [{k: 'several', label: `检测到 ${d.several.length} 个浏览器`}, {k: 'one', label: `只检测到 ${d.one[0].label}`},
      {k: 'denied', label: 'Chrome 访问被拒绝'}, {k: 'none', label: '没有检测到 Cookie 库（默认勾选 Chrome）'}];
  }

  /** 勾选的浏览器按检测到的顺序排（就是尝试的顺序）；重新检测后不在列表里的去掉。 */
  function ordered(checked, detected) {
    const set = new Set(checked || []);
    return (detected || []).map((b) => b.id).filter((id) => set.has(id));
  }

  /** 「所有浏览器」：检测到的都勾上是全选，勾了一部分是半选。 */
  function allState(checked, detected) {
    const n = ordered(checked, detected).length;
    const total = (detected || []).length;
    return {selected: total > 0 && n === total, indeterminate: n > 0 && n < total};
  }

  /** 点「所有浏览器」：全选时清空，没选或半选时选上全部。 */
  function toggleAll(checked, detected) {
    return allState(checked, detected).selected ? [] : (detected || []).map((b) => b.id);
  }

  /** 勾上或取消一个浏览器，结果仍按检测到的顺序。 */
  function toggle(checked, id, on, detected) {
    const rest = (checked || []).filter((x) => x !== id);
    return ordered(on ? rest.concat(id) : rest, detected);
  }

  /**
   * 复选框下面的说明：先说按勾选怎么用，再说读了什么、BaoCut 记什么；再按 Runtime 所在主机与勾了哪些浏览器提示——
   * macOS 上的钥匙串授权与 Safari 的完全磁盘访问权限；Windows 上 Chromium 内核的浏览器开着时读不到，
   * Chrome、Edge、Brave 的应用绑定加密 yt-dlp 目前可能解不开，没勾 Firefox 时建议改用它。
   */
  function notes(list, platform, detected = [], access) {
    const names = list.map(label);
    /* Runtime 报告了完全磁盘访问权限的状态（macOS 主机）：未授权时由带按钮的卡片说（fullDiskNeeds），已授权时没有要补的步骤；
       两种情况下说明里都不再写去系统设置的步骤。没有报告（远端或老版本）时才写。 */
    const covered = platform === 'darwin' && (access === 'missing' || access === 'granted');
    const lines = [list.length === 0 ? '都不勾就匿名下载。网站要求登录或验证时，先在浏览器里登录这个网站，再勾选那个浏览器。'
      : list.length === 1 ? `用 ${names[0]} 的 Cookie 访问目标网站。`
        : `按 ${names.join(' → ')} 的顺序逐个试：读不到某个浏览器的 Cookie、或网站仍要求登录时换下一个，用上一个就停，结果里写明用的是哪个。`];
    lines.push('只读取你勾选的浏览器。Cookie 由 yt-dlp 在本机读取，只用于访问目标网站；BaoCut 只记下浏览器名称，不保存 Cookie 内容。');
    if (platform === 'darwin') {
      const keychain = list.filter((id) => CHROMIUM.indexOf(id) >= 0).map(label);
      if (keychain.length) lines.push(`macOS 会为 ${keychain.join('、')}${keychain.length > 1 ? ' 各' : ' '}弹出一次钥匙串授权，选「始终允许」以后就不再问。`);
      if (list.indexOf('safari') >= 0 && !detected.some((b) => b.accessDenied) && !covered) lines.push('读取 Safari 的 Cookie 要先在「系统设置 › 隐私与安全性 › 完全磁盘访问权限」里允许 BaoCut。');
    }
    if (platform === 'win32') {
      const chromium = list.filter((id) => CHROMIUM.indexOf(id) >= 0).map(label);
      const appBound = list.filter((id) => APP_BOUND.indexOf(id) >= 0).map(label);
      if (chromium.length) lines.push(`${chromium.join('、')} 开着时 Cookie 库被占用、读不到，下载前先完全退出${chromium.length > 1 ? '这些' : '这个'}浏览器，包括在后台运行的。`);
      if (appBound.length) lines.push(`${appBound.join('、')} 在 Windows 上通常用应用绑定加密保护 Cookie，yt-dlp 目前可能读不到，退出浏览器也不行。`);
      if (chromium.length && list.indexOf('firefox') < 0) lines[lines.length - 1] += '需要登录时，建议在 Firefox 里登录目标网站后改勾 Firefox。';
    }
    const denied = detected.filter((b) => b.accessDenied).map((b) => label(b.id));
    if (denied.length && !covered) lines.push(platform === 'darwin'
      ? `BaoCut 没有权限访问 ${denied.join('、')} 的浏览器数据。在运行 BaoCut 的电脑上，打开「系统设置 › 隐私与安全性 › 完全磁盘访问权限」，添加并启用 BaoCut；完全退出并重新打开 BaoCut，再点「重新检测浏览器」。`
      : `BaoCut 没有权限访问 ${denied.join('、')} 的浏览器数据。在运行 BaoCut 的电脑上，允许 BaoCut 访问这些浏览器的数据目录，再点「重新检测浏览器」。`);
    if (detected.some((b) => b.id === 'chrome' && b.cookieStoreMissing)) lines.push('没有找到 Chrome 的 Cookie 库。要使用 Chrome 的网站登录，在 Chrome 里登录目标网站，再点「重新检测浏览器」。');
    return lines;
  }

  /* ---------- 完全磁盘访问权限（macOS） ---------- */

  /**
   * 读取 Cookie 要先有「完全磁盘访问权限」的浏览器（只看勾选的）：Safari，以及检测时数据访问被拒绝的。
   * `access` 是 Runtime 所在主机报告的 `fullDiskAccess`（`granted` 或 `missing`，只有 macOS 主机有）；
   * 没有这个值（别的系统、远端主机没有桌面入口、老版本）时不提示，按原来的文字说明。
   */
  function fullDiskNeeds(list, platform, detected, access) {
    if (platform !== 'darwin' || access !== 'missing') return [];
    const denied = new Set((detected || []).filter((b) => b.accessDenied).map((b) => b.id));
    return (list || []).filter((id) => id === 'safari' || denied.has(id));
  }

  /** 授权卡的文案：`step` 是 `idle`（还没去系统设置）或 `opened`（已经打开过系统设置，等用户启用）。 */
  function fullDiskCopy(ids, step) {
    const names = ids.map(label).join('、');
    return step === 'opened'
      ? {title: `在系统设置里启用 BaoCut，再回到这里`,
        body: '启用 BaoCut 旁边的开关；系统问是否退出并重新打开时选「退出并重新打开」。列表里没有 BaoCut 时，点列表下方的「+」把它添加进去。系统没有提示重新打开时，点下面的「重新启动 BaoCut」。',
        primary: '重新启动 BaoCut', secondary: '再次打开系统设置'}
      : {title: `允许 BaoCut 读取 ${names} 的 Cookie`,
        body: 'macOS 要求先给 BaoCut「完全磁盘访问权限」。点「打开系统设置」，BaoCut 会直接带你到这一页，不用自己去找。BaoCut 只读取你勾选的浏览器，不读别的文件。',
        primary: '打开系统设置', secondary: null};
  }

  /** 下载前的询问：这一次要用到、又没有授权的浏览器；「这次跳过」就从这次冻结的列表里去掉它们，用后面的浏览器继续。 */
  function withoutFullDisk(list, needs) {
    return (list || []).filter((id) => needs.indexOf(id) < 0);
  }

  /* 设置的取值：`ALL` 或浏览器列表（空列表 = 匿名下载） */
  const ALL = 'all';

  /** 设置里存的值；没设置过是 `ALL`（默认带 Cookie）。 */
  function setting(prefs) {
    const v = prefs ? prefs.cookieBrowsers : undefined;
    return Array.isArray(v) ? v : ALL;
  }

  /** 设置 → 这一次下载按顺序试的浏览器：`ALL` 是检测到的全部，列表只留还检测得到的。 */
  function resolve(value, detected) {
    return value === ALL ? (detected || []).map((b) => b.id) : ordered(value, detected);
  }

  /** 勾选结果 → 存回设置的值：检测到的全勾上存 `ALL`，否则存按检测顺序排好的列表。 */
  function save(list, detected) {
    return allState(list, detected).selected ? ALL : ordered(list, detected);
  }

  /** 一个都没检测到时的说明。 */
  const EMPTY = '这台电脑上没有找到浏览器的 Cookie，只能匿名下载。在浏览器里登录过目标网站后，点「重新检测浏览器」。';

  /** 任务列表里的一行：匿名、用哪个浏览器，或依次试哪几个。 */
  function subText(list) {
    if (!list || list.length === 0) return '匿名下载';
    if (list.length === 1) return `使用 ${label(list[0])} 的 Cookie`;
    return `依次试 ${list.map(label).join('、')} 的 Cookie`;
  }

  /** 结果里写明用上的浏览器。 */
  const usedText = (id) => `用了 ${label(id)} 的 Cookie`;

  /**
   * 勾选的浏览器都没成功时的说明，与 Runtime 的错误同一个说法（`attempts` 是 [{browser, login}]，login 为真是网站仍要求登录，
   * 否则是读不到 Cookie）。只试了一个时就是那一个的错误。
   */
  function failureText(attempts, platform) {
    if (attempts.length === 1) {
      const id = attempts[0].browser;
      if (attempts[0].login) return '网站要求登录或验证。先在浏览器中登录目标网站，再在「设置 › 视频下载」的网站登录里勾选该浏览器后重新下载。';
      if (id === 'safari') return '读取不到 Safari 的 Cookie。在「系统设置 › 隐私与安全性 › 完全磁盘访问权限」里允许 BaoCut，或换一个浏览器。';
      /* Windows 上没有系统密钥授权这一说：Chromium 内核的先要完全退出，Chrome、Edge、Brave 还可能是应用绑定加密 */
      if (platform === 'win32' && CHROMIUM.indexOf(id) >= 0) {
        return `读取不到 ${label(id)} 的 Cookie。先完全退出 ${label(id)}（包括在后台运行的）再试${APP_BOUND.indexOf(id) >= 0
          ? `；${label(id)} 用应用绑定加密保护 Cookie 时 yt-dlp 读不到，退出也不行，改在 Firefox 里登录目标网站后勾选 Firefox。` : '，或换一个浏览器。'}`;
      }
      if (platform === 'win32') return `读取不到 ${label(id)} 的 Cookie。确认浏览器已登录、已完全退出，或换一个浏览器。`;
      return `读取不到 ${label(id)} 的 Cookie。确认浏览器已登录；数据库被占用时退出浏览器，系统密钥权限被拒时允许访问，或换一个浏览器。`;
    }
    const reasons = attempts.map((a) => `${label(a.browser)}：${a.login ? '网站仍要求登录' : '读不到 Cookie'}`).join('；');
    return `试了 ${attempts.length} 个浏览器的 Cookie 都没成功（${reasons}）。确认在其中一个浏览器里登录了目标网站后重新下载。`;
  }

  root.BC_TOOL_COOKIES = {LABEL, DEMO_DETECTED, EMPTY, ALL, label, demoDetected, demoScenes, ordered, allState, toggleAll, toggle, setting, resolve, save,
    notes, subText, usedText, failureText, fullDiskNeeds, fullDiskCopy, withoutFullDisk};
})();
