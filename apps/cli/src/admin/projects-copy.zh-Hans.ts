import type { ProjectsMessages } from './projects-copy.ts';

export const zhHans: ProjectsMessages = {
  help: `用法：
  baocut projects git-status [<项目>]
                                   项目的 git 状态：仓库、分支、BaoCut 能不能代为提交、为什么暂停
                                   （提交用 baocut projects git-commit）
  baocut projects git-init [<项目>]
                                   在项目目录初始化 git（不在用户主目录、系统的标准用户文件夹、卷的根目录，
                                   也不在别的仓库里面）
  baocut projects git-allow [<项目>] [--yes]
                                   列出仓库本地配置里的过滤器与 include，再允许它们：之后 BaoCut 才运行会执行它们的 git 命令
  <项目> 是项目 ID、名字或目录；不给时用包含当前目录的项目`,
  noProject: (cwd) => `没有包含 ${cwd} 的项目。请给出项目 ID、名字或目录（baocut projects list）`,
  unknownProject: (text) => `没有这个项目：${text}（baocut projects list）`,
  ambiguousProject: (text) => `有不止一个项目叫 ${text}，请改用它的 ID`,
  states: {
    ready: '就绪',
    paused: '已暂停',
    'not-repo': '不在 git 仓库里',
    unavailable: 'git 不可用',
    error: '出错',
  },
  head: (name, id) => `项目 ${name}（${id}）`,
  state: (state) => `Git：${state}`,
  branch: (branch) => `分支：${branch}`,
  detached: '分支：（HEAD 分离）',
  version: (version) => `git 版本：${version}`,
  repo: (root) => `仓库：${root}`,
  autoCommit: (on) => `自动提交：${on ? '开' : '关'}`,
  lastCommit: (commit, auto, at) => `最近一次提交：${commit.slice(0, 12)}（${auto ? '自动' : '手动'}，${at}）`,
  lastError: (message) => `最近一次失败：${message}`,
  entriesHead: '本地过滤器与 include：',
  entry: (key, value, file) => `  ${key} = ${value}${file ? `  （${file}）` : ''}`,
  allowHint: '查看之后，运行 baocut projects git-allow 允许它们',
  initDone: (root) => `已在 ${root} 初始化 git`,
  nothingToAllow: '这个仓库没有等待允许的本地过滤器或 include',
  allowPrompt: '允许这些条目吗？之后 BaoCut 会运行执行它们的 git 命令 [y/N] ',
  notTtyAllow: '不在终端里：先用 baocut projects git-status 查看条目，再加 --yes 重新运行',
  notAllowed: '没有允许：BaoCut 在这个仓库的代为提交保持暂停',
  allowed: '已允许：BaoCut 恢复在这个仓库代为提交',
};
