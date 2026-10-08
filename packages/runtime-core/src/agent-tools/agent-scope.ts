// i18n-ignore-file: 只有给模型的工具错误（ToolError）
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  RpcError,
  newId,
  type Conversation,
  type GeneratedOutput,
  type Id,
  type JobRecord,
  type JobSubmitter,
  type VideoChange,
  type VideoCreated,
  type VideoOpenResult,
} from '@baocut/protocol';
import { engineProtections, type Harness } from '@baocut/harness';
import { locateArtifact, type JobManager } from '@baocut/jobs';
import type { EngineProtection, VideoService } from '../videos/video-service.ts';
import { scanDirectory } from '../space-catalog.ts';
import type { AgentPrincipal } from './grants.ts';
import { ToolError } from './tool-catalog.ts';
import {
  toolRisk,
  type ToolAccess,
  type ToolApprovalNote,
  type ToolConfirmation,
  scopedProject,
  type ScopedProject,
  type ToolPrincipal,
  type ToolScope,
  type VideoRoot,
} from './tool-scope.ts';

/** 会话里一次调用的授权：会话与进行中的任务。 */
export interface AgentAccess extends ToolAccess {
  readonly principal: AgentPrincipal;
  readonly conversation: Conversation;
  readonly taskId: Id;
}

/**
 * 智能体工具的权限与范围（架构设计 §3.5、§4.2），视频工具与模型工具共用：
 *
 * - 工具只在会话有进行中的任务时可用；停止之后一律拒绝；规划模式只读；
 * - 有副作用的调用按会话此刻的访问模式与动作的风险查表（§3.12）：自动的直接执行，要问的在会话里放一张审批卡并等待
 *   （没有时限），用户拒绝、停止或打断时返回明确的错误；
 * - 智能体只能使用会话来源目录（所属项目的目录，或会话自己的工作目录）里的视频；
 * - 智能体只能看到本会话提交的任务与来源目录里已打开视频上的任务，产物也只能用这些任务的。
 */
export class AgentScope implements ToolScope<AgentAccess> {
  readonly #harness: Harness;
  readonly #videos: VideoService;
  readonly #jobs: JobManager;
  /** 按 videoId 找过的、没有打开的视频的目录：下次先核对它，不对再扫。 */
  readonly #located = new Map<Id, string>();

  constructor(deps: { harness: Harness; videos: VideoService; jobs: JobManager }) {
    this.#harness = deps.harness;
    this.#videos = deps.videos;
    this.#jobs = deps.jobs;
  }

  /** 工具只在任务里可用；停止屏障之后一律拒绝（D04）；规划模式只读。 */
  authorize(principal: ToolPrincipal, write: boolean): AgentAccess {
    if (principal.kind !== 'agent') throw new ToolError('FORBIDDEN', '这个工具通道只服务会话里的智能体');
    const run = this.#harness.agentRun(principal.conversationId);
    if (!run.taskId) throw new ToolError('NO_ACTIVE_TASK', '这个会话没有进行中的任务；工具只在回合里可用');
    if (run.stopRequested) throw new ToolError('TASK_STOPPED', '用户已经停止了这个任务：不要再读取或修改视频，结束这个回合');
    if (write && run.mode === 'plan') {
      throw new ToolError('PLAN_ONLY', '当前是规划模式（只读）：说明你打算怎么改，等用户切换到可以修改的模式后再改');
    }
    const submitter: JobSubmitter = { kind: 'agent', id: run.conversation.id, taskId: run.taskId };
    // 会话每次都取此刻的记录：调用中途绑定了项目（新建视频时，§3.10）之后，工作目录与来源目录跟着换。
    const harness = this.#harness;
    const captured = run.conversation;
    return {
      principal,
      get conversation(): Conversation {
        return harness.conversationOf(captured.id) ?? captured;
      },
      taskId: run.taskId,
      submitter,
    };
  }

  /** 按会话此刻的访问模式与风险决定（§3.12）：自动、等用户，或拒绝。结果里的模式记进工具结果。 */
  async confirm(access: AgentAccess, request: ToolConfirmation): Promise<ToolApprovalNote> {
    const targets = [...(request.video !== undefined ? [request.video] : []), ...(request.targets ?? [])];
    const risk = toolRisk(request);
    const result = await this.#harness.approveToolCall(access.conversation.id, {
      tool: request.tool,
      targets,
      summary: request.summary,
      risk,
      // 「总是允许」按工具名存；高风险的这一次（不可撤销的覆盖、外发、付费）不提供，每次都问。
      rule: risk === 'high' ? null : request.tool,
      ...(request.grants?.length ? { grants: request.grants } : {}),
    });
    switch (result.status) {
      case 'allowed':
        return {
          mode: result.mode,
          risk: result.risk,
          decidedBy: result.decidedBy,
          // 带外发授权的调用：用户的选择；自动通过（完全访问）的按只这一次。
          ...(request.grants?.length ? { grant: result.grant ?? { persist: false } } : {}),
        };
      case 'no-task':
        throw new ToolError('NO_ACTIVE_TASK', '这个会话没有进行中的任务；工具只在回合里可用');
      case 'cancelled':
        throw new ToolError('APPROVAL_CANCELLED', '这次调用在用户确认之前被取消了（任务被停止或回复被打断）：不要重试，结束这个回合', {
          mode: result.mode,
          risk: result.risk,
        });
      case 'denied':
        if (result.mode === 'plan') {
          throw new ToolError('PLAN_ONLY', '当前是规划模式（只读）：说明你打算怎么改，等用户切换到可以修改的模式后再改');
        }
        throw new ToolError(
          'APPROVAL_DENIED',
          result.decidedBy === 'user'
            ? '用户在 BaoCut 里拒绝了这次调用：不要重试同样的调用，先问问用户'
            : '当前的访问模式不允许这次调用：说明你打算做什么，请用户切换模式',
          { mode: result.mode, risk: result.risk },
        );
    }
  }

  /** 来源目录里的视频，以及其中已经打开的视频的 videoId 和名字。 */
  async listVideos(access: AgentAccess): Promise<Record<string, unknown>> {
    const { root } = this.source(access.conversation);
    const rootReal = await fs.realpath(root).catch(() => root);
    const scan = await scanDirectory(rootReal);
    const open = new Map(this.#videos.openRefs().map((ref) => [ref.path, ref]));
    return {
      workspace: rootReal,
      videos: scan.files
        .filter((file) => file.kind === 'video')
        .map((file) => {
          const ref = open.get(path.join(rootReal, file.relPath));
          return { path: file.relPath, ...(ref ? { videoId: ref.videoId, name: ref.name, open: true } : { open: false }) };
        }),
      ...(scan.issue ? { issue: scan.issue.detail } : {}),
    };
  }

  /**
   * 新建视频的位置：会话所属的项目。给了 `project` 时只能是会话所属的项目（按 id 或目录），别的与不存在的一样回答。
   * 不属于项目的会话第一次新建视频时，先建项目并把会话绑定到它（§3.10，`Harness.ensureConversationProject`），视频建在项目里；
   * `locate` 时只找位置（确认之前、删除视频时），不绑定，会话还没有项目时回答会话的工作目录。
   */
  async createRoot(access: AgentAccess, project?: string, options: { locate?: boolean } = {}): Promise<VideoRoot> {
    const source = this.source(access.conversation);
    if (
      project !== undefined &&
      !('projectId' in source.scope && (project === source.scope.projectId || path.resolve(project) === path.resolve(source.root)))
    ) {
      throw new ToolError('PROJECT_NOT_FOUND', `找不到项目「${project}」：只能在会话所属的项目里新建；不给 project 时建在会话的项目里`);
    }
    if (options.locate || 'projectId' in source.scope) return source;
    const bound = await this.#harness.ensureConversationProject(access.conversation.id);
    return { root: bound.path, scope: { projectId: bound.id } };
  }

  /** `importAsset.path` 相对会话的工作目录；绝对路径与 `~/` 照常接受（用户给的素材常在别处）。 */
  importBase(access: AgentAccess): { cwd: string; confine: string | null } {
    return { cwd: access.conversation.cwd, confine: null };
  }

  /** 本机文件相对会话的工作目录；绝对路径与 `~/` 照常接受。 */
  fileBase(access: AgentAccess): string {
    return access.conversation.cwd;
  }

  commandId(_access: AgentAccess, given: string | undefined): string {
    return given ?? newId('cmd');
  }

  owns(record: JobRecord, access: AgentAccess): boolean {
    return ownedBy(record, access.conversation);
  }

  /** 回执在会话里放一张变更卡（产品设计 §6.5）。 */
  recordChange(access: AgentAccess, change: VideoChange): void {
    const target =
      'conversationId' in change.target && !change.target.conversationId
        ? { ...change.target, conversationId: access.conversation.id }
        : change.target;
    this.#harness.recordVideoChange(access.conversation.id, access.taskId, { ...change, target });
  }

  /** `videos_create` 新建的视频在会话里记一条，界面的视频卡从它出现（架构设计 §11.3）。 */
  recordCreated(access: AgentAccess, created: VideoCreated): void {
    const target =
      'conversationId' in created.target && !created.target.conversationId
        ? { ...created.target, conversationId: access.conversation.id }
        : created.target;
    this.#harness.recordVideoCreated(access.conversation.id, access.taskId, { ...created, target });
  }

  /** 任务合同此刻的保护范围：合同修改之后，之后的提交按新范围检查。 */
  protections(access: AgentAccess, videoId: Id): EngineProtection[] {
    return engineProtections(this.#harness.currentContract(access.conversation.id, access.taskId), videoId);
  }

  saveRoot(access: AgentAccess): string {
    return access.conversation.cwd;
  }

  /** 导出的目录相对会话的来源目录；不给时由导出服务放到视频来源目录的 `exports/`。 */
  exportBase(access: AgentAccess): { base: string; within: string; ownDefault: boolean } {
    const { root } = this.source(access.conversation);
    return { base: root, within: root, ownDefault: false };
  }

  /** 会话的来源目录：所属项目的目录，或会话自己的工作目录。 */
  source(conversation: Conversation): { root: string; scope: { projectId: Id } | { conversationId: Id } } {
    if (conversation.projectId) {
      const project = this.#harness.listProjects().find((p) => p.id === conversation.projectId);
      if (project) return { root: project.path, scope: { projectId: project.id } };
    }
    return { root: conversation.cwd, scope: { conversationId: conversation.id } };
  }

  /**
   * 打开（或接上已经打开的）视频，并把这个会话记为它的打开者。`video` 是相对来源目录的路径或 videoId；视频必须在来源目录里。
   * videoId 不限于开着的视频：关掉了的（流程新建、放下租约之后）按来源目录里的视频目录找（只读地看身份，不取写入锁）；
   * 来源目录之外的与不存在的一样回答 `VIDEO_NOT_FOUND`。
   */
  async open(video: string, access: AgentAccess): Promise<VideoOpenResult> {
    const { conversation, principal } = access;
    const { root, scope } = this.source(conversation);
    const known = this.#videos.ref(video) ?? (VIDEO_ID.test(video) ? await this.#locate(video, root) : null);
    try {
      return await this.#videos.open({ root, file: known ? known.path : video, scope }, principal);
    } catch (error) {
      if (error instanceof RpcError && error.code === 'not-found') {
        throw new ToolError('VIDEO_NOT_FOUND', `找不到视频「${video}」：用 videos_list 给出的 path，或这个会话工作目录里的视频的 videoId`);
      }
      if (error instanceof RpcError && error.code === 'forbidden') {
        throw new ToolError('VIDEO_OUTSIDE_WORKSPACE', '只能使用这个会话工作目录里的视频');
      }
      throw error;
    }
  }

  /**
   * 来源目录里某个 videoId 的视频目录（没有打开的）：先核对上次找到的位置，不对了再扫一遍来源目录，逐个只读地看身份
   * （`peek`）。被别的进程锁着、读不了的目录跳过。找不到时 null。
   */
  async #locate(videoId: Id, root: string): Promise<{ path: string } | null> {
    const rootReal = await fs.realpath(root).catch(() => null);
    if (!rootReal) return null;
    const prefix = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
    const peek = async (dir: string): Promise<{ path: string } | null> => {
      if (!dir.startsWith(prefix)) return null;
      const open = this.#videos.openRefs().find((ref) => ref.path === dir);
      const seen = open ?? (await this.#videos.peek(dir).catch(() => null));
      if (!seen) return null;
      this.#located.set(seen.videoId, dir);
      return seen.videoId === videoId ? { path: dir } : null;
    };
    const remembered = this.#located.get(videoId);
    if (remembered) {
      const hit = await peek(remembered);
      if (hit) return hit;
      this.#located.delete(videoId);
    }
    const scan = await scanDirectory(rootReal);
    for (const file of scan.files) {
      if (file.kind !== 'video') continue;
      const hit = await peek(path.join(rootReal, ...file.relPath.split('/')));
      if (hit) return hit;
    }
    return null;
  }

  /** 一个已经打开的视频是否在会话的来源目录里。没有打开时无从判断，为 false。 */
  async contains(videoId: Id, conversation: Conversation): Promise<boolean> {
    const ref = this.#videos.ref(videoId);
    if (!ref) return false;
    const { root } = this.source(conversation);
    const rootReal = await fs.realpath(root).catch(() => null);
    if (!rootReal) return false;
    const prefix = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
    return ref.path === rootReal || ref.path.startsWith(prefix);
  }

  /** 这个会话能看到的任务：自己提交的，或来源目录里已打开的视频上的。看不到的与不存在的一样回答。 */
  async visibleJob(jobId: Id, access: AgentAccess): Promise<JobRecord> {
    const { conversation } = access;
    let record: JobRecord;
    try {
      record = this.#jobs.inspect(jobId);
    } catch {
      throw jobNotFound(jobId);
    }
    if (await this.#sees(record, conversation)) return record;
    throw jobNotFound(jobId);
  }

  /** `jobs_list`：本会话提交的与来源目录里已打开视频上的任务（与 `visibleJob` 相同），新的在前。 */
  async visibleJobs(access: AgentAccess): Promise<JobRecord[]> {
    const { root } = this.source(access.conversation);
    const rootReal = await fs.realpath(root).catch(() => null);
    const prefix = rootReal && (rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep);
    const inSource = (videoId: Id): boolean => {
      const ref = prefix ? this.#videos.ref(videoId) : undefined;
      return !!ref && (ref.path === rootReal || ref.path.startsWith(prefix!));
    };
    return this.#jobs
      .list()
      .filter((record) => ownedBy(record, access.conversation) || (record.videoId !== null && inSource(record.videoId)));
  }

  /** `projects_list`：只有会话所属的项目；不属于项目的会话（工作目录不是项目）没有。 */
  async listProjects(access: AgentAccess): Promise<ScopedProject[]> {
    const { root, scope } = this.source(access.conversation);
    if (!('projectId' in scope)) return [];
    const project = this.#harness.listProjects().find((p) => p.id === scope.projectId);
    if (!project) return [];
    const scan = await scanDirectory(await fs.realpath(root).catch(() => root)).catch(() => null);
    return [scopedProject(project, { videoCount: scan && !scan.issue ? scan.files.filter((f) => f.kind === 'video').length : undefined })];
  }

  /**
   * 这个会话能用的产物：它看得到的任务的结果（生成的输出，或转写的结果）与产物库里的文件。同样的 bytes 可能出自几个任务，
   * 优先取本会话自己提交的。失败但保留了结果的任务（导入视频失败）也算。看不到的与不存在的一样回答。
   */
  async visibleArtifact(
    artifactId: string,
    access: AgentAccess,
  ): Promise<{ record: JobRecord; output: GeneratedOutput | null; file: string }> {
    const { conversation } = access;
    const candidates = this.#jobs
      .list()
      .filter((record) => record.result?.artifactId === artifactId || record.result?.outputs?.some((o) => o.artifactId === artifactId))
      .sort((a, b) => Number(ownedBy(b, conversation)) - Number(ownedBy(a, conversation)));
    for (const record of candidates) {
      if (!(await this.#sees(record, conversation))) continue;
      const output = record.result?.outputs?.find((o) => o.artifactId === artifactId) ?? null;
      // 发布到用户目录的输出（从链接导入下载的媒体）不进产物库：按登记的路径找，内容要对得上。
      const file = await locateArtifact(this.#jobs.artifacts, artifactId, output);
      if (!file) throw new ToolError('ARTIFACT_NOT_FOUND', `产物 ${artifactId} 的文件已经不在了`);
      return { record, output, file };
    }
    throw new ToolError(
      'ARTIFACT_NOT_FOUND',
      `找不到产物 ${artifactId}，或它不属于这个会话能看到的任务（jobs_inspect 的 outputs 里的 artifactId）`,
    );
  }

  async #sees(record: JobRecord, conversation: Conversation): Promise<boolean> {
    if (ownedBy(record, conversation)) return true;
    return record.videoId !== null && (await this.contains(record.videoId, conversation));
  }
}

/** videoId 的样子：`video_` 加十六进制（引擎分配 16 位；`newId` 是 32 位）。路径里有 `/` 或 `.`，对不上。 */
const VIDEO_ID = /^video_[0-9a-f]{8,32}$/;

/** 这个会话提交的任务。 */
export function ownedBy(record: JobRecord, conversation: Conversation): boolean {
  return record.submitter.kind === 'agent' && record.submitter.id === conversation.id;
}

function jobNotFound(jobId: Id): ToolError {
  return new ToolError('JOB_NOT_FOUND', `找不到任务 ${jobId}，或它不属于这个会话的工作目录`);
}
