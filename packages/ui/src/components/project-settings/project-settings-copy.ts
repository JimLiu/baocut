import { defineMessages } from '@baocut/protocol';
import { zhHans } from './project-settings-copy.zh-Hans.ts';
import { zhHant } from './project-settings-copy.zh-Hant.ts';
import { ja } from './project-settings-copy.ja.ts';
import { ko } from './project-settings-copy.ko.ts';
import { es } from './project-settings-copy.es.ts';
import { fr } from './project-settings-copy.fr.ts';
import { de } from './project-settings-copy.de.ts';
import { nl } from './project-settings-copy.nl.ts';
import { ptBR } from './project-settings-copy.pt-BR.ts';
import { it } from './project-settings-copy.it.ts';
import { ru } from './project-settings-copy.ru.ts';
import { pl } from './project-settings-copy.pl.ts';
import { tr } from './project-settings-copy.tr.ts';
import { vi } from './project-settings-copy.vi.ts';

/**
 * 项目设置（版本记录设计 §5.3–§5.4、§6）：对话框、git 一节、项目外的素材，和版本记录对话框底部的 git 状态条。
 * git 小写，用词见 docs/glossary.md「提交到 git / 自动提交 / 初始化 git / 允许本地过滤器」。译文在 `project-settings-copy.zh-Hans.ts`。
 */
const en = {
  menuItem: 'Project Settings…',
  title: 'Project settings',
  close: 'Close project settings',
  done: 'Done',
  loading: 'Checking git',
  loadFailed: (message: string) => `Couldn’t check git: ${message}`,

  gitHeading: 'git',
  gitLead: 'BaoCut can commit the workspace snapshots of your videos to the git repository the project is in. Version history doesn’t need git and works the same outside a repository.',
  branch: (name: string) => `Branch ${name}`,
  gitVersion: (version: string) => `git ${version}`,
  checkAgain: 'Check again',
  /** Runtime 给的原因与下一步连成一段；两句都去掉了句末标点。 */
  sentences: (first: string, second: string | null) => (second ? `${first}. ${second}.` : `${first}.`),

  lightReady: 'Ready',
  lightPaused: (label: string) => `Paused · ${label}`,
  lightNotRepo: 'Not in a git repository',
  lightUnavailable: 'git not found',
  lightError: 'git failed',
  pauseLocked: 'Repository in use',
  pauseMerge: 'Merge in progress',
  pauseRebase: 'Rebase in progress',
  pauseCherryPick: 'Cherry-pick in progress',
  pauseRevert: 'Revert in progress',
  pauseBisect: 'Bisect in progress',
  pauseDetached: 'HEAD detached',
  pauseLocalConfig: 'Local filters',
  pauseLocalConfigChanged: 'Local filters changed',

  pausedHeading: (label: string) => `Commits paused: ${label}`,
  pausedNote: 'While commits are paused, auto-commit and Commit to git wait. Opening, editing, and version history aren’t affected.',
  errorHeading: 'git failed',
  unavailableHeading: 'git not found',

  lcEntry: 'Entry',
  lcValue: 'Command or included file',
  lcExplain:
    'After you allow them, BaoCut follows these entries when it runs git (for example, git-crypt encryption). The permission is saved only on this computer, not in the project, and BaoCut pauses again if the entries or the included files change. This isn’t trusting the folder: opening, editing, and agents aren’t affected.',
  lcWeb:
    'These entries are listed, and can be allowed, only in the project settings of the BaoCut desktop app (or with baocut projects git-allow). While commits are paused, opening, editing, and version history aren’t affected.',
  allow: 'Allow',
  allowedTitle: 'Local filters allowed',
  allowedText: 'The permission is saved on this computer, not in the project. You can commit now.',
  allowFailed: 'Not allowed',

  commit: 'Commit to git',
  committing: 'Committing',
  commitDesc: (maxMiB: number) =>
    `Commits only BaoCut’s files: the workspace snapshots of changed videos, and media up to ${maxMiB} MiB. Other files in the project and changes you’ve already staged stay as they are. BaoCut doesn’t push.`,
  lastCommit: (commit: string, auto: boolean, ago: string) => `Last commit ${commit} · ${auto ? 'auto' : 'manual'} · ${ago}`,
  lastFailed: (message: string) => `Last attempt failed: ${message}`,
  committedTitle: 'Committed to git',
  /** `videos` 是已经写好的每部视频（`committedVideo`）。 */
  committedText: (commit: string, files: number, videos: string[]) =>
    `Committed ${commit}: ${files === 1 ? '1 file' : `${files} files`}${videos.length ? `, ${videos.join(', ')}` : ''}.`,
  committedVideo: (name: string, from: number | null, to: number | null) =>
    from === null || to === null ? `“${name}”` : from === to ? `“${name}” version ${to}` : `“${name}” versions ${from}–${to}`,
  unnamedVideo: 'a video',
  nothingTitle: 'Nothing to commit',
  nothingText: 'BaoCut’s files are the same as at the last commit.',
  commitFailed: 'Not committed',

  autoCommit: 'Auto-commit',
  autoCommitDesc:
    'Commits once after the project has been quiet for 5 minutes, when you close the project’s last open video, or when you quit BaoCut. All projects on this computer share this setting.',

  initTitle: 'Initialize git',
  initDesc: 'Create a git repository in the project folder so you can commit snapshots to it.',
  initWebNote: 'Only the BaoCut desktop app or the CLI (baocut projects git-init) can create a repository in a folder on the Runtime’s computer.',
  initRefused: (why: string) => `Not available here: ${why}`,
  initRefusedNote: 'If you need one, move the videos into a project folder of their own and initialize git there.',
  refusalHome: 'the project is your home folder. A repository here would make every folder in your home folder look like part of it to other tools.',
  refusalUserFolder:
    'the project is a standard user folder (such as Desktop, Documents, Downloads, Movies, Music, or Pictures). A repository here would make every folder in it look like part of it to other tools.',
  refusalVolumeRoot: 'the project is the root of a disk. A repository here would make the whole disk look like part of it.',
  refusalInsideRepo: 'the project is already in a git repository.',
  initConfirmTitle: 'Initialize git in the project folder?',
  initConfirmBody: (path: string) =>
    `Creates a git repository in ${path}. BaoCut’s ignore rules go in the repository’s own .git/info/, so no files in the project change. Nothing is committed or pushed.`,
  cancel: 'Cancel',
  initDoneTitle: 'git initialized',
  initDoneText: 'Nothing is committed yet. Use Commit to git to make the first commit.',
  initFailed: 'Not initialized',

  recheckSame: 'Nothing has changed',
  recheckReadyTitle: 'Ready to commit',
  recheckReadyText: 'The repository isn’t paused anymore.',

  outsideHeading: 'Media outside the project',
  outsideLead:
    'When a video uses media outside the project folder, its workspace snapshot records the media’s path (starting with ~/ under your home folder, a full path otherwise). After you commit or push, others get only the path, not the file. To hand over the media too, use a portable package.',

  stripLabel: 'Project git',
  projectSettings: 'Project settings',
};

export type ProjectSettingsMessages = typeof en;
export const PROJECT_SETTINGS_COPY = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
