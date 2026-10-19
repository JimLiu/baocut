import type { RcGitMessages } from './rc-git.ts';

export const zhHans: RcGitMessages = {
  gitPurpose: '把项目里 BaoCut 的文件提交到 git（可选）',
  gitMissingRemedyMac: '安装 git：在终端里运行 xcode-select --install 安装命令行工具，或者用 Homebrew 安装（brew install git）',
  gitMissingRemedyWin: '从 https://git-scm.com/download/win 安装 Git for Windows',
  gitMissingRemedyLinux: '用系统的包管理器安装 git',
  xcodeStub: '命令行工具装好之前，/usr/bin/git 只会弹出安装它们的提示',

  notRepo: '这个项目不在 git 仓库里',
  initRemedy: '在项目目录里运行 baocut projects git-init，或者在你想要仓库的位置自己运行 git init',
  initHome: 'BaoCut 不在用户主目录里建 git 仓库：那样它下面的所有文件夹在其他工具看来都处在同一个仓库里',
  initUserFolder: (p) => `BaoCut 不在系统的标准用户文件夹（${p.path}）里建 git 仓库：那样它下面的所有文件夹在其他工具看来都处在同一个仓库里`,
  initVolumeRoot: 'BaoCut 不在卷或盘符的根目录建 git 仓库',
  initInsideRepo: '这个项目已经在一个 git 仓库里',
  initElsewhere: '先把项目放进单独的文件夹，或者在你想要仓库的位置自己运行 git init',
  pausedLocked: '仓库正被另一个 git 命令占用（存在 index.lock）',
  lockedRemedy: '等另一个 git 命令结束。BaoCut 下次提交时再试，从不删除锁文件；没有 git 命令在运行时，请自己删掉锁文件',
  pausedMerge: '仓库正在合并中',
  pausedRebase: '仓库正在变基中',
  pausedCherryPick: '仓库正在拣选中',
  pausedRevert: '仓库正在还原中',
  pausedBisect: '仓库正在二分查找中',
  pausedDetached: 'HEAD 处于分离状态（仓库不在任何分支上）',
  repoStateRemedy: '在 git 里完成或放弃这个操作，之后 BaoCut 恢复提交',
  detachedRemedy: '在 git 里切换到一个分支，之后 BaoCut 恢复提交',
  pausedLocalConfig: '仓库的本地配置会运行程序或引入别的文件（过滤器或 include），所以 BaoCut 不运行会读你文件的 git 命令',
  pausedLocalConfigChanged: '仓库的本地过滤器或 include 在你允许之后改过了，所以 BaoCut 重新暂停了代为提交',
  localConfigRemedy: '查看这些条目和它们要运行的命令，然后用 baocut projects git-allow 允许',
  gitFailed: (p) => `git 在这个仓库里运行失败：${p.detail}`,

  manageOnlyInAppOrCli: '只有桌面应用或 CLI 能初始化 git、允许本地过滤器',
  digestChanged: '查看之后本地配置又改了，请重新查看这些条目',
  commitFailed: (p) => `提交到 git 失败：${p.detail}`,
  initFailed: (p) => `初始化 git 失败：${p.detail}`,

  commitSummary: (p) => `把项目「${p.name}」里 BaoCut 的文件提交到 git`,
  commitTitle: (p) => `BaoCut：更新 ${p.names}`,
};
