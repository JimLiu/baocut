import type { Id } from './domain.ts';
import type { MessageRef } from './message-ref.ts';

/**
 * 项目的 git 桥（版本记录设计 §5、架构设计 §5.12）：BaoCut 代为提交项目里的快照与素材、初始化仓库、写 `info/*` 的块。
 * 只运行用户机器上的 git 命令行，不内嵌 git 库，不碰网络；每次调用都带固定的安全参数（§5.4）。
 */

/** 代为提交暂停的原因：仓库正被占用（`index.lock`）、仓库在特殊状态里、本地配置要执行仓库带来的程序。 */
export type ProjectGitPauseReason = 'locked' | 'repo-state' | 'local-config';

/** 仓库的特殊状态：合并、变基、拣选、还原、二分中，或 HEAD 处于分离状态。 */
export type ProjectGitRepoState = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'bisect' | 'detached';

/** 不能在这里「初始化 git」的原因：用户主目录、系统的标准用户文件夹、卷或盘符的根、已经在仓库里。 */
export type ProjectGitInitRefusal = 'home' | 'user-folder' | 'volume-root' | 'inside-repo';

/**
 * - `ready`：项目在仓库里，能提交。
 * - `paused`：在仓库里，代为提交暂停（`pause`）。
 * - `not-repo`：项目不在仓库里（`init` 说明能不能初始化）。
 * - `unavailable`：这台电脑上没有能用的 git（没装、版本太低、macOS 上只有安装开发者工具的占位程序）。
 * - `error`：git 在这个仓库里运行失败（例如仓库属于别的用户，git 拒绝）。
 */
export type ProjectGitState = 'ready' | 'paused' | 'not-repo' | 'unavailable' | 'error';

/** 仓库本地配置里要执行程序或引入别的文件的一条（`filter.<name>.clean|smudge|process`、`include.path`、`includeIf.<条件>.path`）。 */
export interface ProjectGitConfigEntry {
  key: string;
  value: string;
  /** 这一条所在的配置文件（被包含的文件时是那个文件）。Web 不给。 */
  file?: string;
}

export interface ProjectGitPause {
  reason: ProjectGitPauseReason;
  /** `reason` 为 `repo-state` 时。 */
  repoState?: ProjectGitRepoState;
  /**
   * `reason` 为 `local-config` 时：条目（Web 不给）与它们的摘要。启用（`projects.git.allowLocalConfig`）时原样交回 `digest`。
   * `changed`：这台电脑之前启用过这个仓库，之后条目或被包含的文件变了。
   */
  localConfig?: { entries?: ProjectGitConfigEntry[]; digest: string; changed: boolean };
}

/** 一次提交里的一部视频：版本序号的范围（这段时间里更新过的版本）；读不出版本记录时为 null。 */
export interface ProjectGitCommitVideo {
  videoId: Id;
  from: number | null;
  to: number | null;
}

export interface ProjectGitCommitRecord {
  commit: string;
  at: string;
  trigger: 'manual' | 'auto';
  videos: ProjectGitCommitVideo[];
}

export interface ProjectGitStatus {
  projectId: Id;
  state: ProjectGitState;
  /** 用的 git 的版本；找不到时 null。 */
  gitVersion: string | null;
  /** 仓库的根目录（项目目录或它的上级）。Web 不给。 */
  repoRoot?: string;
  /** 当前分支；不在仓库里、HEAD 分离时 null。 */
  branch: string | null;
  pause?: ProjectGitPause;
  /** 不在仓库里时：能不能在项目目录「初始化 git」；不能时 `refusal` 是原因。 */
  init?: { allowed: boolean; refusal?: ProjectGitInitRefusal };
  /** 设置 `versions.git.autoCommit`。 */
  autoCommit: boolean;
  /** 这次 Runtime 运行期间最后一次代为提交。 */
  lastCommit: ProjectGitCommitRecord | null;
  /** 这次 Runtime 运行期间最后一次失败（之后成功了就清掉）。 */
  lastError: { message: string; messageRef?: MessageRef; at: string } | null;
  /** 状态不是 `ready` 时：给人看的原因与下一步。 */
  reason?: string;
  reasonRef?: MessageRef;
  remedy?: string;
  remedyRef?: MessageRef;
}

export interface ProjectGitCommitResult {
  /** 没有要提交的改动时 false。 */
  committed: boolean;
  commit: string | null;
  /** 提交的文件数。 */
  files: number;
  videos: ProjectGitCommitVideo[];
  status: ProjectGitStatus;
}
