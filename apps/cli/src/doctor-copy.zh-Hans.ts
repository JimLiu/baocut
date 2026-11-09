import type { DoctorMessages } from './doctor-copy.ts';

export const zhHans: DoctorMessages = {
  help: [
    'baocut doctor',
    '',
    'BaoCut 为什么起不来、为什么读不到：终端找到的是哪个 baocut，CLI 会拉起哪个 Runtime、用哪个主目录，凭据存储',
    '答不答话，以及 macOS 上的完全磁盘访问权限。每一项是 ok、warn、fail 或 skip，有补救命令的附上；next 是第一个',
    '问题的补救。',
    '只读：不拉起 Runtime，也不读任何密钥（钥匙串那一项只问一个编出来的键在不在）。补救命令先征得用户同意再跑。',
    '',
    '旗标：--json',
  ].join('\n'),
  checkName: {
    entry: '命令行',
    runtime: 'Runtime',
    credentials: '凭据',
    fullDiskAccess: '完全磁盘访问',
  },
  remedyLabel: '补救',

  entryApp: (found, version) => `终端用的是 ${found}，就是 BaoCut App${version ? ` ${version}` : ''} 自带的命令行`,
  entryOtherApp: (found, target, app) => `终端用的是 ${found}（${target}），不是 ${app} 那个 BaoCut App 自带的命令行`,
  entryNoApp: (found, target) => `终端用的是 ${found}（${target}）；没找到 BaoCut App`,
  entryMissing: '终端还找不到 baocut。从 BaoCut App 装上它（不要管理员权限）。',
  entryMissingNoApp: '终端找不到 baocut，常见的位置也没有 BaoCut App',

  runtimeRunning: (version, pid, by) => `在跑：版本 ${version}，进程 ${pid}，由${by === 'cli' ? '命令行' : ' BaoCut App '}拉起`,
  runtimeStopped: (entry) => `没在跑。下一条命令会在后台用 ${entry} 拉起它`,
  runtimeUnreachable: (pid, reason) => `有一个 Runtime 在跑（进程 ${pid}），但连不上：${reason}`,
  runtimeNoLaunch: '没在跑，也没有能拉起的 Runtime：装上 BaoCut App，从仓库运行，或把 BAOCUT_RUNTIME_ENTRY 设成 Runtime 的入口。',

  credentialsFile: (file) => `这个构建把密钥存在文件里：${file}`,
  credentialsKeychain: (platform) => (platform === 'win32' ? 'Windows 凭据管理器能用' : 'macOS 钥匙串能用'),
  credentialsDenied:
    '钥匙串拒绝访问。经 SSH 或没有登录桌面时，macOS 可能一直锁着它：在桌面上的终端里运行 baocut，或者解锁登录钥匙串。',
  credentialsNoHelper: (file) => `找不到凭据助手${file ? `（${file}）` : ''}，读不了密钥。重新安装 BaoCut App。`,
  credentialsUnavailable: (reason) => `连不上凭据存储：${reason}`,
  credentialsUnknown: '密钥存在哪里由 BAOCUT_RUNTIME_ENTRY 指的入口决定；没有检查',
  credentialsTimedOut: (seconds) => `助手 ${seconds} 秒内没有回答`,

  fdaGranted: '完全磁盘访问权限已开',
  fdaMissingApp:
    'BaoCut.app 没有完全磁盘访问权限，受保护位置（桌面、文稿、下载、其他磁盘）里的文件可能读不到。在「系统设置 › 隐私与安全性 › 完全磁盘访问权限」里打开 BaoCut，再运行 baocut doctor 复查。',
  fdaMissingCli: (app) =>
    `命令行拉起的 Runtime 没有完全磁盘访问权限；macOS 把它算在${app ?? '运行命令的那个应用（终端，或运行 Agent 的应用）'}头上。在「系统设置 › 隐私与安全性 › 完全磁盘访问权限」里打开那个应用并重新打开它，或者停掉这个 Runtime（baocut runtime stop）再打开 BaoCut App；之后运行 baocut doctor 复查。`,
  fdaNotRunning: 'Runtime 在跑时才查',
};
