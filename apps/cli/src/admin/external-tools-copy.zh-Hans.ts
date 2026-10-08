import type { ToolsMessages } from './external-tools-copy.ts';

export const zhHans: ToolsMessages = {
  help: `用法：
  baocut external-tools [list]     外部工具（yt-dlp、ffmpeg）：状态、版本、路径与来源，以及是否已同意使用
  baocut external-tools detect [名字]
                                   重新探测
  baocut external-tools install <名字> [--yes]
                                   下载受管副本到 Runtime Home 的 tools/：先列出来源、版本、大小与许可，确认后下载并核对
                                   sha256（--yes 表示同意）。下载来源见设置 tools.downloadEndpoint 与环境变量 BAOCUT_TOOLS_ENDPOINT
  baocut external-tools update <名字> [--yes]
                                   按原安装方式（Homebrew、pipx、pip 或官方独立程序）更新系统里的那一份：先列出要执行的完整
                                   命令，确认后由 Runtime 执行（--yes 表示确认），逐行打出输出，结束后重新检测。要管理员权限的
                                   只打印命令，请在终端里自己执行
  baocut external-tools path <名字> <文件>|--clear
                                   用自己安装的那一份（先执行一次 --version 核对）；--clear 取消指定
  baocut external-tools remove <名字>
                                   删除受管副本（不动系统里的与指定的）
  baocut external-tools consent <名字> [--revoke]
                                   同意使用一个下载工具，或撤回同意（撤回之后从链接导入被拒绝）`,
  usage:
    '用法：baocut external-tools [list] | detect [名字] | install <名字> [--yes] | update <名字> [--yes] | path <名字> <文件>|--clear | remove <名字> | consent <名字> [--revoke]',
  clearOrFile: '--clear 与文件只能给一个',
  stateLabels: {
    installed: '已安装',
    missing: '未安装',
    outdated: '需要更新',
    unavailable: '不可用',
  },
  sourceLabels: {
    system: '系统 PATH',
    user: '指定的路径',
    managed: 'BaoCut 下载的副本',
    env: '环境变量',
  },
  updateMethodLabels: {
    homebrew: 'Homebrew',
    pipx: 'pipx',
    pip: 'pip',
    standalone: '官方独立程序',
    winget: 'winget',
    scoop: 'Scoop',
    chocolatey: 'Chocolatey',
  },
  statusHead: (name: string, state: string, version: string | null, source: string | null, purpose: string) =>
    `${name}  ${state}${version ? ` ${version}` : ''}${source ? `（${source}）` : ''}  ${purpose}`,
  pathLine: (path: string) => `  路径：${path}`,
  userPathLine: (path: string) => `  指定的路径：${path}`,
  managedLine: (version: string, path: string) => `  受管副本：${version}  ${path}`,
  consentLine: (label: string) => `  同意：${label}`,
  installingLine: (jobId: string) => `  正在安装：任务 ${jobId}`,
  updatingLine: (jobId: string) => `  正在更新：任务 ${jobId}`,
  updateLine: (command: string, method: string, runnable: boolean) =>
    `  更新：${command}（${method}${runnable ? '' : '，要在终端里自己执行'}）`,
  reasonLine: (reason: string) => `  原因：${reason}`,
  remedyLine: (remedy: string) => `  补救：${remedy}`,
  consentMissing: (name: string) => '还没有同意（用之前要同意：baocut external-tools consent ' + name + '）',
  consentVia: { agent: '经智能体的审批', cli: '在 CLI 里', app: '在应用里' },
  consentGranted: (at: string, via: string) => `已同意（${at}，${via}）`,
  consentRevoked: (at: string) => `已撤回（${at}）`,
  noTools: '没有登记的外部工具',
  cannotUpdate: (label: string, reason: string) => `不能代为更新 ${label}：${reason}`,
  runInTerminal: '在终端里执行：',
  redetect: (name: string) => `完成后重新检测：baocut external-tools detect ${name}`,
  updatePlanHead: (method: string, label: string, version: string | null) =>
    `将按原安装方式（${method}）更新 ${label} ${version ?? ''}`.trimEnd(),
  runLine: (command: string) => `  执行：${command}`,
  updatePrompt: (label: string) => `在本机执行这条命令更新 ${label}？[y/N] `,
  omittedLines: (n: number) => `…（省略 ${n} 行）`,
  updated: (label: string, before: string | null, after: string) => `已更新 ${label}：${before ?? '未知版本'} → ${after}`,
  upToDate: (label: string, version: string | null) => `${label} 已是最新版本${version ? ` ${version}` : ''}`,
  sizeEstimated: (size: string) => `约 ${size}（大小未知，按估计）`,
  sizeAbout: (size: string) => `约 ${size}`,
  willDownload: (label: string, version: string) => `将下载 ${label} ${version}`,
  sourceLine: (url: string | null) => `  来源：${url ?? '（这台机器没有可用的文件）'}`,
  sizeLine: (size: string) => `  大小：${size}`,
  licenseLine: (license: string) => `  许可：${license}`,
  homepageLine: (url: string) => `  主页：${url}`,
  sha256Line: (hash: string) => `  sha256：${hash}`,
  blockedLine: (reason: string) => `  不能下载：${reason}`,
  installPrompt: (label: string, version: string, size: string) => `同意下载并使用 ${label} ${version}（${size}）？[y/N] `,
  noExternalTool: (name) => `没有外部工具「${name}」`,
  alreadyInstalling: (jobId) => `已经在安装（任务 ${jobId}），接着显示进度`,
  installDone: '安装完成',
  notDownloadedByBaoCut: (label, remedy) => `${label} 不由 BaoCut 下载：${remedy ?? '请自己安装'}`,
  cannotDownload: (label, reason) => `不能下载 ${label}：${reason}`,
  notTtyAgreeDownload: '没有在终端里运行：用户同意下载之后加 --yes',
  notTtyConfirmRun: '没有在终端里运行：用户确认执行之后加 --yes',
  notDownloaded: '没有下载',
  notRun: '没有执行',
  remedy: (remedy) => `补救：${remedy}`,
  partialDownloadKept: (name) => `已下载的部分保留：baocut external-tools install ${name} 续传`,
  alreadyUpdating: (jobId) => `已经在更新（任务 ${jobId}），接着显示输出`,
  managedCopy: (label, name) => `此刻用的 ${label} 是 BaoCut 下载的副本：用 baocut external-tools install ${name} 换版本`,
  unknownInstall: (file, name) => `判断不了 ${file} 是怎么安装的：按当初的安装方式在终端里更新，完成后 baocut external-tools detect ${name}`,
  noRunnableTool: (label, remedy) => `没有找到能运行的 ${label}：${remedy}`,
  updateManual: (label, command) => `${label} 的更新要在终端里自己执行：${command}`,
  partialCommand: (name) => `命令可能只做了一部分：baocut external-tools detect ${name} 看此刻的版本`,
};
