import type { ProjectSettingsMessages } from './project-settings-copy.ts';

export const zhHans: ProjectSettingsMessages = {
  menuItem: '项目设置…',
  title: '项目设置',
  close: '关闭项目设置',
  done: '完成',
  loading: '正在检查 git',
  loadFailed: (message: string) => `没能检查 git：${message}`,

  gitHeading: 'git',
  gitLead: 'BaoCut 可以把视频的工作区快照提交进项目所在的 git 仓库。版本记录不需要 git，不在仓库里也照常可用。',
  branch: (name: string) => `分支 ${name}`,
  gitVersion: (version: string) => `git ${version}`,
  checkAgain: '重新检查',
  sentences: (first: string, second: string | null) => (second ? `${first}。${second}。` : `${first}。`),

  lightReady: '正常',
  lightPaused: (label: string) => `已暂停 · ${label}`,
  lightNotRepo: '不在 git 仓库里',
  lightUnavailable: '没有找到 git',
  lightError: 'git 运行失败',
  pauseLocked: '仓库正被占用',
  pauseMerge: '正在合并',
  pauseRebase: '正在变基',
  pauseCherryPick: '正在拣选',
  pauseRevert: '正在还原',
  pauseBisect: '正在二分查找',
  pauseDetached: 'HEAD 分离',
  pauseLocalConfig: '有本地过滤器',
  pauseLocalConfigChanged: '本地过滤器变了',

  pausedHeading: (label: string) => `提交已暂停：${label}`,
  pausedNote: '暂停期间自动提交与「提交到 git」都等着；打开、编辑与版本记录不受影响。',
  errorHeading: 'git 运行失败',
  unavailableHeading: '没有找到 git',

  lcEntry: '条目',
  lcValue: '要执行的命令或引入的文件',
  lcExplain:
    '允许后，BaoCut 运行 git 时照这些条目执行（例如 git-crypt 加密）。允许只记在这台电脑上，不写进项目；条目或引入的文件变了会再停下来。这不是信任这个文件夹：打开、编辑与智能体都不受影响。',
  lcWeb: '这些条目只在 BaoCut 桌面应用的项目设置里列出，也只能在那里允许（或用 baocut projects git-allow）。暂停期间，打开、编辑与版本记录都不受影响。',
  allow: '允许',
  allowedTitle: '已允许这些本地过滤器',
  allowedText: '允许记在这台电脑上，不写进项目。现在可以提交了。',
  allowFailed: '没有允许',

  commit: '提交到 git',
  committing: '正在提交',
  commitDesc: (maxMiB: number) =>
    `只提交 BaoCut 的文件：有改动的视频的工作区快照，和不超过 ${maxMiB} MiB 的素材。项目里的其他文件和你已经暂存的改动原样不动；BaoCut 不推送。`,
  lastCommit: (commit: string, auto: boolean, ago: string) => `上次提交 ${commit} · ${auto ? '自动' : '手动'} · ${ago}`,
  lastFailed: (message: string) => `上次失败：${message}`,
  committedTitle: '已提交到 git',
  committedText: (commit: string, files: number, videos: string[]) => `已提交 ${commit}：${files} 个文件${videos.length ? `，${videos.join('、')}` : ''}。`,
  committedVideo: (name: string, from: number | null, to: number | null) =>
    from === null || to === null ? `「${name}」` : from === to ? `「${name}」版本 ${to}` : `「${name}」版本 ${from}–${to}`,
  unnamedVideo: '一部视频',
  nothingTitle: '没有要提交的改动',
  nothingText: 'BaoCut 的文件和上次提交时一样。',
  commitFailed: '没有提交',

  autoCommit: '自动提交',
  autoCommitDesc: '项目安静满 5 分钟、关掉项目里最后一部打开的视频或退出 BaoCut 时提交一次。这台电脑上的所有项目共用这一项。',

  initTitle: '初始化 git',
  initDesc: '在项目文件夹里建一个 git 仓库，之后可以把快照提交进去。',
  initWebNote: '要在 Runtime 所在电脑的文件夹里建仓库，只能在 BaoCut 桌面应用或 CLI（baocut projects git-init）里做。',
  initRefused: (why: string) => `这里不提供初始化：${why}`,
  initRefusedNote: '需要的话，把视频放进一个单独的项目文件夹再初始化。',
  refusalHome: '项目就是你的主目录。在这里建仓库，主目录下的所有文件夹在别的工具看来都会算进这个仓库。',
  refusalUserFolder: '项目是系统的标准用户文件夹（例如桌面、文稿、下载、影片、音乐、图片）。在这里建仓库，里面所有文件夹都会算进这个仓库。',
  refusalVolumeRoot: '项目是磁盘的根目录。在这里建仓库，整块磁盘都会算进这个仓库。',
  refusalInsideRepo: '项目已经在一个 git 仓库里。',
  initConfirmTitle: '在项目文件夹里初始化 git？',
  initConfirmBody: (path: string) =>
    `在 ${path} 里建一个 git 仓库。BaoCut 的忽略规则写在仓库自己的 .git/info/ 里，不改项目里的文件。不做第一次提交，也不推送。`,
  cancel: '取消',
  initDoneTitle: '已初始化 git',
  initDoneText: '还没有提交。点「提交到 git」做第一次提交。',
  initFailed: '没有初始化',

  recheckSame: '状态没有变',
  recheckReadyTitle: '可以提交了',
  recheckReadyText: '仓库不再暂停。',

  outsideHeading: '项目外的素材',
  outsideLead:
    '素材在项目文件夹外时，工作区快照记的是它的路径（主目录下的写成 ~/ 开头，其余写完整路径）：提交或推送之后，别人拿到的只有路径，没有文件。要连素材一起交给别人，用便携包。',

  stripLabel: '项目的 git',
  projectSettings: '项目设置',
};
