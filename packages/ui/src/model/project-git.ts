import {
  RpcError,
  localizeText,
  type Id,
  type ProjectGitCommitRecord,
  type ProjectGitCommitResult,
  type ProjectGitInitRefusal,
  type ProjectGitPause,
  type ProjectGitStatus,
} from '@baocut/protocol';
import { PROJECT_SETTINGS_COPY as C } from '../components/project-settings/project-settings-copy.ts';
import { remedyText } from './localized-text.ts';
import { agoLabel } from './format.ts';

/**
 * 项目的 git 桥在界面上的样子（版本记录设计 §5.3–§5.4、§6；原型 model-project-git.js）：状态灯、暂停原因的短名、
 * 能不能提交与重新检查、提交结果与上次提交那一句、错误。纯函数，对话框在 components/project-settings/。
 *
 * 状态从 `projects.git.status` 来，不推送；提交、初始化、允许的结果里都带新的状态。Runtime 给的原因与下一步（`reason` /
 * `remedy`）按界面语言重新生成后照用；不在仓库里时不能初始化的原因，状态里只有枚举（`init.refusal`），文字在这里配。
 */

export type GitTone = 'positive' | 'notice' | 'neutral' | 'negative';

/** 状态灯：S2 StatusLight 的 variant 与文字。 */
export function gitLight(status: ProjectGitStatus): { tone: GitTone; label: string } {
  switch (status.state) {
    case 'ready':
      return { tone: 'positive', label: C.lightReady };
    case 'paused':
      return { tone: 'notice', label: C.lightPaused(pauseLabel(status.pause)) };
    case 'not-repo':
      return { tone: 'neutral', label: C.lightNotRepo };
    case 'unavailable':
      return { tone: 'neutral', label: C.lightUnavailable };
    default:
      return { tone: 'negative', label: C.lightError };
  }
}

/** 暂停原因的短名（状态灯与提示的标题）。 */
export function pauseLabel(pause: ProjectGitPause | undefined): string {
  if (!pause) return '';
  if (pause.reason === 'locked') return C.pauseLocked;
  if (pause.reason === 'local-config') return pause.localConfig?.changed ? C.pauseLocalConfigChanged : C.pauseLocalConfig;
  switch (pause.repoState) {
    case 'rebase':
      return C.pauseRebase;
    case 'cherry-pick':
      return C.pauseCherryPick;
    case 'revert':
      return C.pauseRevert;
    case 'bisect':
      return C.pauseBisect;
    case 'detached':
      return C.pauseDetached;
    default:
      return C.pauseMerge;
  }
}

/** 项目在仓库里（能看到提交那一行与自动提交）：正常、暂停，或 git 在仓库里运行失败。 */
export const inRepo = (status: ProjectGitStatus): boolean => status.state === 'ready' || status.state === 'paused' || status.state === 'error';

export const canCommit = (status: ProjectGitStatus): boolean => status.state === 'ready';

/** 「重新检查」：等别的程序用完、在终端里处理完再看一次。本地过滤器要「允许」，不靠重新检查。 */
export const canRecheck = (status: ProjectGitStatus): boolean =>
  (status.state === 'paused' && status.pause?.reason !== 'local-config') || status.state === 'error';

/** 本地过滤器暂停时交回「允许」的摘要；不是这种暂停时 null。 */
export function localConfigOf(status: ProjectGitStatus): NonNullable<ProjectGitPause['localConfig']> | null {
  return status.state === 'paused' && status.pause?.reason === 'local-config' ? (status.pause.localConfig ?? null) : null;
}

const trimEnd = (text: string) => text.trim().replace(/[.。．!！]+$/u, '');

/** Runtime 给的原因与下一步连成一段（按界面语言）；没有原因时 null。`withRemedy` 为 false 时只要原因。 */
export function statusText(status: ProjectGitStatus, withRemedy = true): string | null {
  const reason = localizeText(status.reason, status.reasonRef);
  if (!reason) return null;
  const remedy = withRemedy ? localizeText(status.remedy, status.remedyRef) : null;
  return C.sentences(trimEnd(reason), remedy ? trimEnd(remedy) : null);
}

/** 只有补救的那一句（「重新检查」状态没变时，原因已经写在上面的提示里）；没有时 null。 */
export function statusRemedy(status: ProjectGitStatus): string | null {
  const remedy = localizeText(status.remedy, status.remedyRef);
  return remedy ? C.sentences(trimEnd(remedy), null) : null;
}

/** 不能初始化的原因；能初始化或没有说明时 null。 */
export function refusalText(refusal: ProjectGitInitRefusal | undefined): string | null {
  switch (refusal) {
    case 'home':
      return C.refusalHome;
    case 'user-folder':
      return C.refusalUserFolder;
    case 'volume-root':
      return C.refusalVolumeRoot;
    case 'inside-repo':
      return C.refusalInsideRepo;
    default:
      return null;
  }
}

/** 提交的短名：前 7 位。 */
export const shortCommit = (commit: string): string => commit.slice(0, 7);

/** 「上次提交 9c2e4a1 · 手动 · 42 分钟前」；还没有时 null。 */
export function lastCommitText(record: ProjectGitCommitRecord | null, now: number): string | null {
  if (!record) return null;
  return C.lastCommit(shortCommit(record.commit), record.trigger === 'auto', agoLabel(record.at, now));
}

/** 提交结果的一句话。`nameOf` 把视频 ID 换成名字（Space 目录里找不到时 null）。 */
export function commitText(result: Pick<ProjectGitCommitResult, 'committed' | 'commit' | 'files' | 'videos'>, nameOf: (videoId: Id) => string | null): string {
  if (!result.committed || !result.commit) return C.nothingText;
  const videos = result.videos.map((v) => C.committedVideo(nameOf(v.videoId) ?? C.unnamedVideo, v.from, v.to));
  return C.committedText(shortCommit(result.commit), result.files, videos);
}

export interface GitError {
  code: string | null;
  /** 原因与下一步，按界面语言。 */
  message: string;
  /** 拒绝时 Runtime 一并给的新状态（`GIT_PAUSED`）。 */
  status: ProjectGitStatus | null;
}

/** `projects.git.*` 的拒绝：`details.code`、补救与新状态。 */
export function gitError(error: unknown): GitError {
  if (!(error instanceof RpcError)) return { code: null, message: (error as Error)?.message ?? String(error), status: null };
  const details = (error.details ?? {}) as { code?: unknown; status?: unknown };
  const remedy = remedyText(error.details);
  const reason = localizeText(error.message, error.messageRef);
  const status = details.status && typeof details.status === 'object' && 'state' in details.status ? (details.status as ProjectGitStatus) : null;
  return {
    code: typeof details.code === 'string' ? details.code : null,
    message: remedy ? C.sentences(trimEnd(reason), trimEnd(remedy)) : reason,
    status,
  };
}
