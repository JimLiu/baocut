/* 按原安装方式更新下载工具（product-design §2.7「下载视频」，architecture §12.9「安装动作」）——window.BC_TOOL_UPDATE。
   纯函数，无 React、无 DOM；只在 App 入口加载。

   - 更新办法（`plan`）由 Runtime 探测时判断：macOS 与 Linux 上是 Homebrew、pipx、pip、官方独立程序，Windows 上是 winget、Scoop、
     pip、pipx、官方独立程序；Chocolatey 装的要管理员权限，只给命令。判断不了或要管理员权限时不替用户执行，只给命令让用户
     在终端里自己跑；判断不了时按 Runtime 所在主机列出几种常见做法。
   - 命令一律以参数数组执行、不经 shell；给人看、可复制的那一行（`command`）由 `commandLine` 按 Runtime 所在主机的写法加引号：
     Windows 按 PowerShell，其他系统按 POSIX。要管理员权限的在 POSIX 上前面加 `sudo`，Windows 上说明用管理员身份打开终端——
     BaoCut 不执行它，只交给用户在终端里跑。
   - 卡片里直接显示要执行的完整命令（一行代码块，右边是执行与复制）；用户点执行就是确认，不再弹窗。执行时输出逐行显示，
     结束后重新检测，按前后版本说结果（`summary`）。 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;

  const LABEL = {homebrew: 'Homebrew', pipx: 'pipx', pip: 'pip', standalone: '官方独立程序', winget: 'winget', scoop: 'Scoop', chocolatey: 'Chocolatey'};

  /* 原型的演示挡位：Runtime 所在主机 → 安装方式 → 探测会给出的更新办法（null 是判断不了） */
  const DEMO_HOSTS = [{k: 'darwin', label: 'macOS'}, {k: 'win32', label: 'Windows'}];
  const WIN_ADMIN = '用管理员身份打开终端执行这条命令。';
  const DEMO_PLANS = {
    darwin: {
      homebrew: {path: '/opt/homebrew/bin/yt-dlp', plan: {method: 'homebrew', argv: ['/opt/homebrew/bin/brew', 'upgrade', 'yt-dlp'], runnable: true, reason: null}},
      pip: {path: '~/Library/Python/3.12/bin/yt-dlp', plan: {method: 'pip', argv: ['/usr/local/bin/python3', '-m', 'pip', 'install', '-U', 'yt-dlp[default]'], runnable: true, reason: null}},
      standalone: {path: '~/bin/yt-dlp', plan: {method: 'standalone', argv: ['~/bin/yt-dlp', '-U'], runnable: true, reason: null}},
      admin: {path: '/usr/local/bin/yt-dlp', plan: {method: 'standalone', argv: ['/usr/local/bin/yt-dlp', '-U'], runnable: false,
        reason: '这份 yt-dlp 所在的 /usr/local/bin 要管理员权限才能改写，BaoCut 不替你提权。'}},
      unknown: {path: '/opt/tools/yt-dlp', plan: null},
    },
    /* winget 不交互地升级这一个包（只查 winget 源，免得 msstore 源的协议提示让命令失败）；Scoop 本身是 PowerShell 脚本，
       BaoCut 不经命令行解释器执行，照 Scoop 自己的 scoop.cmd 那样用 powershell.exe 跑 scoop.ps1 */
    win32: {
      winget: {path: 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Links\\yt-dlp.exe', plan: {method: 'winget',
        argv: ['C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe', 'upgrade', '--id', 'yt-dlp.yt-dlp', '--exact', '--source', 'winget',
          '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity'], runnable: true, reason: null}},
      scoop: {path: 'C:\\Users\\me\\scoop\\shims\\yt-dlp.exe', plan: {method: 'scoop',
        argv: ['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Unrestricted', '-File',
          'C:\\Users\\me\\scoop\\apps\\scoop\\current\\bin\\scoop.ps1', 'update', 'yt-dlp'], runnable: true, reason: null}},
      chocolatey: {path: 'C:\\ProgramData\\chocolatey\\bin\\yt-dlp.exe', plan: {method: 'chocolatey', argv: ['choco', 'upgrade', 'yt-dlp'], runnable: false,
        reason: `Chocolatey 装的程序要管理员权限才能更新，BaoCut 不替你提权；${WIN_ADMIN}`}},
      pip: {path: 'C:\\Users\\me\\AppData\\Roaming\\Python\\Python313\\Scripts\\yt-dlp.exe', plan: {method: 'pip',
        argv: ['C:\\Users\\me\\AppData\\Local\\Programs\\Python\\Python313\\python.exe', '-m', 'pip', 'install', '-U', '--user', 'yt-dlp[default]'], runnable: true, reason: null}},
      standalone: {path: 'C:\\Users\\me\\Tools\\yt-dlp.exe', plan: {method: 'standalone', argv: ['C:\\Users\\me\\Tools\\yt-dlp.exe', '-U'], runnable: true, reason: null}},
      admin: {path: 'C:\\Program Files\\yt-dlp\\yt-dlp.exe', plan: {method: 'standalone', argv: ['C:\\Program Files\\yt-dlp\\yt-dlp.exe', '-U'], runnable: false,
        reason: `这份 yt-dlp 所在的 C:\\Program Files\\yt-dlp 要管理员权限才能改写，BaoCut 不替你提权。${WIN_ADMIN}`}},
      unknown: {path: 'D:\\tools\\yt-dlp.exe', plan: null},
    },
  };
  const DEMO_METHODS = {
    darwin: [{k: 'homebrew', label: 'Homebrew 安装的'}, {k: 'pip', label: 'pip 安装的'}, {k: 'standalone', label: '官方独立程序'},
      {k: 'admin', label: '要管理员权限'}, {k: 'unknown', label: '判断不了'}],
    win32: [{k: 'winget', label: 'winget 安装的'}, {k: 'scoop', label: 'Scoop 安装的'}, {k: 'chocolatey', label: 'Chocolatey 安装的'},
      {k: 'pip', label: 'pip 安装的'}, {k: 'standalone', label: '官方独立程序'}, {k: 'admin', label: '在 Program Files 里'}, {k: 'unknown', label: '判断不了'}],
  };
  const DEMO_OUTCOMES = [{k: 'updated', label: '更新成功'}, {k: 'current', label: '已是最新'}, {k: 'failed', label: '命令失败'}];

  const hostOf = (platform) => (platform === 'win32' ? 'win32' : 'darwin');
  /** 演示挡位 → 这台主机上的那一种；换了主机、原来的安装方式这边没有时用第一种。 */
  function demoPlan(platform, method) {
    const plans = DEMO_PLANS[hostOf(platform)];
    return plans[method] || plans[DEMO_METHODS[hostOf(platform)][0].k];
  }

  /* 判断不了安装方式时列出的常见做法，按 Runtime 所在主机 */
  const MANUAL = {
    darwin: [
      {label: 'Homebrew', command: 'brew upgrade yt-dlp'},
      {label: 'pip', command: 'python3 -m pip install -U "yt-dlp[default]"'},
      {label: '官方独立程序', command: 'yt-dlp -U'},
    ],
    win32: [
      {label: 'winget', command: 'winget upgrade yt-dlp.yt-dlp'},
      {label: 'Scoop', command: 'scoop update yt-dlp'},
      {label: 'pip', command: 'py -m pip install -U "yt-dlp[default]"'},
      {label: '官方独立程序', command: 'yt-dlp -U'},
    ],
  };
  const manual = (platform) => MANUAL[hostOf(platform)];

  const SAFE_POSIX = /^[A-Za-z0-9_@%+=:,./~-]+$/;
  const SAFE_POWERSHELL = /^[A-Za-z0-9_+=:./\\-]+$/;
  /**
   * 参数数组 → 给人看、能粘进终端的一行，与 Runtime 同一个写法：POSIX 用单引号，内部的单引号写成 `'\''`；
   * Windows 按 PowerShell，单引号里的单引号（含弯引号）写两遍，第一个词加了引号时前面加调用运算符 `& `。
   */
  function commandLine(argv, platform) {
    if (platform !== 'win32') return argv.map((a) => (a !== '' && SAFE_POSIX.test(a) ? a : `'${String(a).replace(/'/g, `'\\''`)}'`)).join(' ');
    const words = argv.map((a) => (a !== '' && SAFE_POWERSHELL.test(a) ? a : `'${String(a).replace(/['\u2018\u2019\u201a\u201b]/g, '$&$&')}'`));
    if (words.length && words[0] !== argv[0]) words[0] = `& ${words[0]}`;
    return words.join(' ');
  }

  function methodLabel(plan) {
    return plan ? LABEL[plan.method] || plan.method : null;
  }

  /** 卡片里「更新」一节：命令上面的标签，不能代为执行时命令下面的说明。原因里已经说了在终端里怎么执行（Windows 的管理员身份）时不再重复。 */
  function sectionCopy(plan) {
    if (!plan) return {label: '在终端里更新', hint: '判断不了这份 yt-dlp 是怎么装的。按当初的安装方式执行其中一条，完成后点「重新检测」。'};
    if (!plan.runnable) {
      const reason = plan.reason || 'BaoCut 不能代为执行这条命令。';
      return {label: '在终端里更新', hint: `${reason}${/终端执行这条命令/.test(reason) ? '完成后点「重新检测」。' : '在终端里执行这条命令，完成后点「重新检测」。'}`};
    }
    return {label: `用 ${methodLabel(plan)} 更新`, hint: null};
  }

  /* 演示的输出：按 Runtime 所在主机、安装方式与结果给几行近似的终端输出 */
  function demoOutput(method, outcome, from, to, platform) {
    const win = platform === 'win32';
    const release = `Downloading https://github.com/yt-dlp/yt-dlp/releases/download/${to}/yt-dlp.exe`;
    if (method === 'winget') {
      if (outcome === 'current') return ['No available upgrade found.', 'No newer package versions are available from the configured sources.'];
      if (outcome === 'failed') return [`Found yt-dlp [yt-dlp.yt-dlp] Version ${to}`, release, 'An unexpected error occurred while executing the command:', '0x80072ee7 : The server name or address could not be resolved'];
      return [`Found yt-dlp [yt-dlp.yt-dlp] Version ${to}`, release, 'Successfully verified installer hash', 'Starting package install...', 'Successfully installed'];
    }
    if (method === 'scoop') {
      if (outcome === 'current') return [`yt-dlp: ${from} (latest version)`, 'Latest versions for all apps are installed.'];
      if (outcome === 'failed') return [`Updating 'yt-dlp' (${from} -> ${to})`, 'ERROR The following instances of "yt-dlp" are still running. Close them and try again.'];
      return [`Updating 'yt-dlp' (${from} -> ${to})`, 'Downloading new version', 'Checking hash of yt-dlp.exe ... ok.', `Uninstalling 'yt-dlp' (${from})`,
        `Installing 'yt-dlp' (${to}) [64bit] from 'main' bucket`, `Linking ~\\scoop\\apps\\yt-dlp\\current => ~\\scoop\\apps\\yt-dlp\\${to}`, "Creating shim for 'yt-dlp'."];
    }
    if (outcome === 'failed') {
      if (win) {
        return method === 'pip'
          ? ['Collecting yt-dlp[default]', `  Downloading yt-dlp-${to}-py3-none-any.whl (3.3 MB)`, 'Installing collected packages: yt-dlp',
            'ERROR: Could not install packages due to an OSError: [WinError 32] The process cannot access the file because it is being used by another process']
          : [`Current version: stable@${from}`, 'ERROR: Unable to obtain version info (<urlopen error [Errno 11001] getaddrinfo failed>); Please try again later'];
      }
      return method === 'pip'
        ? ['error: externally-managed-environment', '', '× This environment is externally managed', '╰─> To install Python packages system-wide, try brew install', '    xyz, where xyz is the package you are trying to install.']
        : method === 'homebrew'
          ? ['==> Fetching downloads for: yt-dlp', 'curl: (6) Could not resolve host: ghcr.io', 'Error: yt-dlp: Failed to download resource "yt-dlp--' + to + '"']
          : ['Current version: stable@' + from, 'Latest version: stable@' + to, 'ERROR: Unable to write to /usr/local/bin/yt-dlp; check file permissions'];
    }
    if (outcome === 'current') {
      return method === 'homebrew' ? ['==> Auto-updating Homebrew...', `Warning: yt-dlp ${from} already installed`]
        : method === 'standalone' ? [`Current version: stable@${from}`, `Latest version: stable@${from}`, `yt-dlp is up to date (stable@${from})`]
          : [`Requirement already satisfied: yt-dlp[default] in ${win ? 'c:\\users\\me\\appdata\\roaming\\python\\python313\\site-packages' : './site-packages'} (${from})`];
    }
    if (method === 'homebrew') {
      return ['==> Auto-updating Homebrew...', '==> Upgrading 1 outdated package:', `yt-dlp ${from} -> ${to}`, '==> Fetching downloads for: yt-dlp',
        `==> Pouring yt-dlp--${to}.arm64_sequoia.bottle.tar.gz`, `/opt/homebrew/Cellar/yt-dlp/${to}: 1,032 files, 18.6MB`, `==> Running \`brew cleanup yt-dlp\`...`];
    }
    if (method === 'standalone') return [`Current version: stable@${from}`, `Latest version: stable@${to}`, `Updating to stable@${to} ...`, `Updated yt-dlp to stable@${to}`];
    return ['Collecting yt-dlp[default]', `  Downloading yt-dlp-${to}-py3-none-any.whl (3.3 MB)`, `Installing collected packages: yt-dlp`,
      `  Attempting uninstall: yt-dlp`, `    Successfully uninstalled yt-dlp-${from}`, `Successfully installed yt-dlp-${to}`];
  }

  /* winget 没有可升级的版本时以 0x8A15002B（APPINSTALLER_CLI_ERROR_UPDATE_NOT_APPLICABLE）退出：算成功，结果按版本说「已是最新」 */
  const WINGET_NO_UPDATE = 0x8A15002B;
  /** 更新命令算不算成功：退出码 0，或 winget 说没有可升级的版本。 */
  function succeeded(method, exitCode) {
    return exitCode === 0 || (method === 'winget' && exitCode === WINGET_NO_UPDATE);
  }
  /** 退出码给人看：Windows 的 HRESULT 一类大数按十六进制写（0x8A15002B），其余照写。 */
  function exitCodeText(code) {
    return code !== null && code !== undefined && (code < 0 || code > 0xFFFF) ? `0x${(code >>> 0).toString(16).toUpperCase().padStart(8, '0')}` : String(code);
  }

  /**
   * 结束后的一句话：命令没成功（`succeeded`）是失败；成功时按重新检测的版本说更新到了哪个版本、或已是最新。
   * 停止的不猜结果，让人看输出、重新检测。
   */
  function summary({method, exitCode, cancelled, before, after}) {
    if (cancelled) return {tone: 'notice', title: '已停止更新', body: '命令可能只做了一部分。看下方输出，点「重新检测」确认 yt-dlp 现在的版本。'};
    if (!succeeded(method, exitCode)) return {tone: 'negative', title: `更新没有完成（退出码 ${exitCodeText(exitCode)}）`, body: '原来的 yt-dlp 不受影响。输出在下方；也可以复制命令到终端里执行，再点「重新检测」。'};
    if (after && after !== before) return {tone: 'positive', title: `已更新到 ${after}`, body: null};
    return {tone: 'neutral', title: `已是最新版本 ${after || before}`, body: null};
  }

  for (const [platform, plans] of Object.entries(DEMO_PLANS)) {
    for (const demo of Object.values(plans)) {
      if (demo.plan) demo.plan.command = (demo.plan.runnable || platform === 'win32' ? '' : 'sudo ') + commandLine(demo.plan.argv, platform);
    }
  }

  root.BC_TOOL_UPDATE = {LABEL, DEMO_HOSTS, DEMO_PLANS, DEMO_METHODS, DEMO_OUTCOMES, MANUAL, WINGET_NO_UPDATE, demoPlan, manual, commandLine, methodLabel, sectionCopy, demoOutput, succeeded, exitCodeText, summary};
})();
