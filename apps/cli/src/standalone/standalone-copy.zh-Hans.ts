import type { StandaloneMessages } from './standalone-copy.ts';

export const zhHans: StandaloneMessages = {
  cliHelp: `用法：
  baocut cli install               为当前用户装好这个命令行包，并把 baocut 放进 PATH。包会复制到
                                   ~/.local/share/baocut/versions/<版本>（Windows：%LOCALAPPDATA%\\BaoCut\\cli\\versions\\<版本>），
                                   已经在那里时不复制。macOS：在 ~/.local/bin/baocut 放软链接；Windows：写
                                   %LOCALAPPDATA%\\BaoCut\\bin\\baocut.cmd，并把这个文件夹加进用户的 PATH。不要管理员权限
  baocut cli status                baocut 放在哪、指向装好的哪个版本，以及终端里实际会用哪个 baocut
  baocut cli remove                移除 baocut cli install 放的东西，装好的版本留着。那个位置上不是 BaoCut 放的东西永不替换或删除`,
  help: `baocut update [--check | --rollback]

更新独立的命令行包：读与 BaoCut 应用相同的发布源，下载最新版本的命令行包，核对大小与 sha256（macOS 上还核对签名与公证），
装在当前版本旁边，再让 baocut 指向它。上一版留着给 --rollback 用；更早的、没有 Runtime 还在用的版本会删掉。
  --check      只看有没有新版本
  --rollback   回到上一版
已经在运行的 Runtime 停下之前仍是旧版本（baocut runtime stop）。
只有独立包这样更新：BaoCut 应用自己更新，Homebrew 装的用 brew upgrade。
设置 BAOCUT_UPDATE_APPCAST 可以改读别的发布源（地址或本地文件，测试用）。`,
  version: (version, build) => `${version}（build ${build}）`,
  state: {
    none: '未安装',
    current: '指向当前版本',
    stale: '指向另一份 BaoCut',
    broken: '指向的位置已经不在了',
    foreign: '已有别的东西（不动它）',
  },
  statusPackage: (version, root) => `包        ${version}  ${root}`,
  statusVersions: (versions, root) => `已装      ${versions.join('、')}  ${root}`,
  statusNoVersions: (root) => `${root} 里还没有装好的版本：baocut cli install 会把这个包复制过去`,
  currentMark: '（当前）',
  previousMark: '（上一版）',
  copied: (dest, from) => `已把包复制到 ${dest}；${from} 不再需要了`,
  versionsKept: (dir) => `装好的版本留在 ${dir}：要删掉它们，删除这个文件夹`,
  entryTaken: (path) => `${path} 不是 BaoCut 放的，不动它。请自己移走或删掉，再运行 baocut cli install`,
  pathFailed: (dir) => `没能把 ${dir} 加进用户的 PATH：请在「系统属性 → 环境变量」里加`,
  copyFailed: (from, dest, detail) => `没能把 ${from} 复制到 ${dest}${detail ? `：${detail}` : ''}`,
  updateUsage: (token) => `baocut update 只认 --check 或 --rollback（二选一）：${token}`,
  updateUnavailable:
    'baocut update 更新的是独立的命令行包。这个 baocut 属于 BaoCut 应用，应用会自己更新（BaoCut → 检查更新）；Homebrew 装的用 brew upgrade --cask baocut',
  upToDate: (current) => `已是最新：${current}`,
  available: (latest, current) => `有新版本 ${latest}（现在是 ${current}）`,
  downloading: (version, build, megabytes) => `正在下载 ${version}（build ${build}），${megabytes} MB…`,
  updated: (from, to) => `已更新 ${from} → ${to}`,
  rolledBack: (from, to) => `已从 ${from} 回到 ${to}`,
  rollbackHint: '要回到上一版：baocut update --rollback',
  entrySwitched: (path) => `${path} 现在指向它`,
  entryNotInstalled: (path) => `${path} 没有装：baocut cli install 会把 baocut 放进 PATH`,
  entryLeftAlone: (path) => `${path} 指向的不是这个包，没有改它：baocut cli install 会让它指向这里`,
  removedVersions: (versions) => `已删除更早的版本：${versions.join('、')}`,
  runtimeStillRunning: (pid) => `有一个 Runtime（pid ${pid}）还在以启动时的版本运行；它停下后，下一条命令会启动新版本（baocut runtime stop 可以现在停下它）`,
  systemTooOld: (required, system) => `新版本需要 macOS ${required}，这台 Mac 是 ${system}`,
  feedFailed: (url, detail) => `没能读取发布源 ${url}：${detail}`,
  feedMissing: (url) => `发布源 ${url} 里还没有命令行包：下一次发布之后再试`,
  downloadFailed: (url, detail) => `没能下载 ${url}：${detail}`,
  verifyFailed: (detail) => `下载的包没有通过检查，没有安装：${detail}`,
  unsignedBuild: '这个包没有签名，核对不了更新的签名。请改从 BaoCut 的发布页下载独立包',
  noPrevious: (dir) => `${dir} 里没有可以回去的上一版`,
  inProgress: (pid) => `另一个 baocut update（pid ${pid}）正在运行：等它结束`,
};
