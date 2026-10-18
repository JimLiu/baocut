import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './rc-git.zh-Hans.ts';
import { zhHant } from './rc-git.zh-Hant.ts';
import { ja } from './rc-git.ja.ts';
import { ko } from './rc-git.ko.ts';
import { es } from './rc-git.es.ts';
import { fr } from './rc-git.fr.ts';
import { de } from './rc-git.de.ts';
import { nl } from './rc-git.nl.ts';
import { ptBR } from './rc-git.pt-BR.ts';
import { it } from './rc-git.it.ts';
import { ru } from './rc-git.ru.ts';
import { pl } from './rc-git.pl.ts';
import { tr } from './rc-git.tr.ts';
import { vi } from './rc-git.vi.ts';

/** 项目的 git 桥（git/）的状态说明、错误与补救。英文是键与类型的来源，译文在 `rc-git.<语言>.ts`。 */
const en = {
  // 受管外部工具登记表里的 git（tool-manifests）
  gitPurpose: "Commits a project's BaoCut files to git (optional)",
  gitMissingRemedyMac: 'Install git: run xcode-select --install in Terminal to get the Command Line Tools, or install it with Homebrew (brew install git)',
  gitMissingRemedyWin: 'Install Git for Windows from https://git-scm.com/download/win',
  gitMissingRemedyLinux: 'Install git with your package manager',
  xcodeStub: "/usr/bin/git only offers to install the Command Line Tools until they're installed",

  // 状态
  notRepo: "This project isn't in a git repository",
  initRemedy: 'Run baocut projects git-init in the project folder, or run git init yourself where you want the repository',
  initHome: "BaoCut doesn't create a git repository in your home folder: every folder in it would look like part of one repository to other tools",
  initUserFolder: (p: { path: string }) =>
    `BaoCut doesn't create a git repository in a standard user folder (${p.path}): every folder in it would look like part of one repository to other tools`,
  initVolumeRoot: "BaoCut doesn't create a git repository at the root of a volume or drive",
  initInsideRepo: 'This project is already in a git repository',
  initElsewhere: 'Move the project into its own folder first, or run git init yourself where you want the repository',
  pausedLocked: 'The repository is in use by another git command (index.lock exists)',
  lockedRemedy: "Let the other git command finish. BaoCut tries again at the next commit and never deletes the lock file; if no git command is running, remove the lock yourself",
  pausedMerge: 'The repository is in the middle of a merge',
  pausedRebase: 'The repository is in the middle of a rebase',
  pausedCherryPick: 'The repository is in the middle of a cherry-pick',
  pausedRevert: 'The repository is in the middle of a revert',
  pausedBisect: 'The repository is in the middle of a bisect',
  pausedDetached: "HEAD is detached (the repository isn't on a branch)",
  repoStateRemedy: 'Finish or abort it in git; BaoCut commits again after that',
  detachedRemedy: 'Switch to a branch in git; BaoCut commits again after that',
  pausedLocalConfig:
    "The repository's local config runs programs or includes other files (filters or include), so BaoCut doesn't run git commands that read your files",
  pausedLocalConfigChanged: "The repository's local filters or includes changed after you allowed them, so BaoCut paused its git commits again",
  localConfigRemedy: 'Review the entries and the commands they run, then allow them with baocut projects git-allow',
  gitFailed: (p: { detail: string }) => `Git failed in this repository: ${p.detail}`,

  // 错误
  manageOnlyInAppOrCli: 'Only the desktop app or the CLI can initialize git or allow local filters',
  digestChanged: 'The local config changed after it was reviewed; review the entries again',
  commitFailed: (p: { detail: string }) => `Committing to git failed: ${p.detail}`,
  initFailed: (p: { detail: string }) => `Initializing git failed: ${p.detail}`,

  // 智能体工具的确认
  commitSummary: (p: { name: string }) => `Commit BaoCut's files in project "${p.name}" to git`,
  /** 版本里没有名字与摘要时的提交说明标题（`names` 是视频名，逗号分隔）。 */
  commitTitle: (p: { names: string }) => `BaoCut: update ${p.names}`,
};

export type RcGitMessages = typeof en;

export const RcGit = defineCatalog('rcGit', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
