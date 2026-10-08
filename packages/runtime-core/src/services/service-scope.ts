import fs from 'node:fs/promises';
import path from 'node:path';
import {
  RpcError,
  newId,
  type Id,
  type JobRecord,
  type JobSubmitter,
  type Project,
  type ServiceId,
  type ServicePolicy,
  type VideoCreated,
  type VideoOpenResult,
} from '@baocut/protocol';
import type { Harness } from '@baocut/harness';
import { locateArtifact, type JobManager } from '@baocut/jobs';
import type { VideoService } from '../videos/video-service.ts';
import { scanDirectory } from '../space-catalog.ts';
import { ToolError } from '../agent-tools/tool-catalog.ts';
import {
  scopedProject,
  toolRisk,
  type ScopedProject,
  type ServicePrincipal,
  type ToolApprovalNote,
  type ToolAccess,
  type ToolConfirmation,
  type ToolPrincipal,
  type ToolScope,
  type VisibleArtifact,
} from '../agent-tools/tool-scope.ts';
import type { ServiceApprovals } from './service-approvals.ts';
import { GRANT_NEXT, grantRequiredDetails } from '../grants/grant-errors.ts';

/**
 * 对外服务的权限与范围（架构设计 §4.8、§12.8）：外部请求没有会话、没有 TaskContract，访问策略取代它们的位置。
 *
 * - **范围**：已登记项目里的视频，全部或一份 videoId 名单。范围之外的视频对这个服务不存在：列表里没有，
 *   按 ID 或路径访问都回答 `VIDEO_NOT_FOUND`，也不会因此被打开或生成审批。判断用引擎的只读查看，不取写入锁。
 * - **等级**：`read` 只有查询（写工具不在目录里，这里再拒绝一次）；`ask` 的写入、任务与生成逐次生成服务审批，
 *   有时限，超时、拒绝与取消都以 `SERVICE_APPROVAL_DENIED` 回答；`auto` 直接执行。
 * - **任务**：提交者是 `{ kind: 'service', id: <serviceId>, clientId }`；客户端只看得到自己提交的任务与它们的产物。
 *   幂等键按客户端隔开，不会撞上别人的提交。
 * - **文件**：`importAsset.path` 相对视频所在的项目目录，不能指向项目目录之外；导出只写进项目的 `exports/`。
 * - **新建视频**：`videos_create` 必须给已登记项目的 id（或目录），建在那个项目里；新视频登记进服务的视频名单（`allowVideo`）。
 * - 写入以 `external:<serviceId>` 为操作者，走与界面相同的命令入口；不在任何会话里放变更卡（审计记在服务里）。
 */

export interface ServiceAccess extends ToolAccess {
  readonly principal: ServicePrincipal;
  readonly policy: ServicePolicy;
}

export interface ServiceScopeDeps {
  harness: Harness;
  videos: VideoService;
  jobs: JobManager;
  approvals: ServiceApprovals;
  /** 服务此刻的访问策略：改配置立即生效。 */
  policy: (serviceId: ServiceId) => ServicePolicy;
  /** 把服务自己新建的视频加进它的范围（策略是名单时写进名单并持久化）。 */
  allowVideo?: (serviceId: ServiceId, videoId: Id) => Promise<void>;
}

/** 一个范围之内的视频在哪里。 */
interface Located {
  project: Project;
  dir: string;
  videoId: Id;
  name: string;
}

export class ServiceScope implements ToolScope<ServiceAccess> {
  readonly #deps: ServiceScopeDeps;
  /** videoId → 视频目录：列表与按路径访问时记下，按 ID 访问时先查这里。 */
  readonly #index = new Map<Id, { projectId: Id; dir: string }>();

  constructor(deps: ServiceScopeDeps) {
    this.#deps = deps;
  }

  authorize(principal: ToolPrincipal, write: boolean): ServiceAccess {
    // i18n-ignore: ToolError 的消息只给外部智能体（模型）看
    if (principal.kind !== 'service') throw new ToolError('FORBIDDEN', '这个端点只服务对外服务的客户端');
    const policy = this.#deps.policy(principal.serviceId);
    // i18n-ignore: ToolError 的消息只给外部智能体（模型）看
    if (write && policy.level === 'read') throw new ToolError('UNKNOWN_TOOL', '这个服务只开放查询');
    const submitter: JobSubmitter = { kind: 'service', id: principal.serviceId, clientId: principal.clientId };
    return { principal, policy, submitter };
  }

  /**
   * `ask` 等级下生成一条服务审批并等待；目标视频先按范围解析，范围之外的直接回答不存在。审批由统一的 ApprovalService
   * 产生（§3.12），带上动作的风险等级，同一条也出现在 `tasks` 主题的待处理列表里。
   */
  async confirm(access: ServiceAccess, request: ToolConfirmation): Promise<ToolApprovalNote | void> {
    const located = request.video !== undefined ? await this.#locate(request.video, access) : null;
    const policy = this.#deps.policy(access.principal.serviceId);
    const outbound = request.grants?.length ? request.grants : null;
    // `auto` 等级免的是逐次确认，不是数据外发的授权（§4.8、§12.5）：没有授权覆盖的外发直接拒绝。
    if (policy.level === 'auto' && outbound) {
      const { message, details } = grantRequiredDetails(outbound);
      const { code, ...extra } = details;
      throw new ToolError(code, message.text, { ...extra, next: GRANT_NEXT[code] });
    }
    if (policy.level === 'auto') return;
    // i18n-ignore: ToolError 的消息只给外部智能体（模型）看
    if (policy.level === 'read') throw new ToolError('UNKNOWN_TOOL', '这个服务只开放查询');
    const { principal } = access;
    const risk = toolRisk(request);
    const { outcome, grant } = await this.#deps.approvals.resolve(
      {
        serviceId: principal.serviceId,
        clientId: principal.clientId,
        clientName: principal.clientName,
        tool: request.tool,
        video: located ? { videoId: located.videoId, name: located.name } : null,
        summary: request.summary,
      },
      principal.signal,
      { risk, level: policy.level, ...(outbound ? { grants: outbound } : {}) },
    );
    if (outcome === 'allowed') return outbound ? { mode: null, risk, decidedBy: 'user', grant: grant ?? { persist: false } } : undefined;
    // i18n-ignore-start: ToolError 的消息只给外部智能体（模型）看
    const message =
      outcome === 'denied'
        ? '用户在 BaoCut 里拒绝了这次请求：不要重试同样的请求，先问问用户'
        : outcome === 'timeout'
          ? '用户没有在时限内确认这次请求，按拒绝处理：请用户在 BaoCut 里留意确认后再试'
          : '这次请求在确认之前被取消了（服务停止或连接断开）';
    // i18n-ignore-end
    throw new ToolError('SERVICE_APPROVAL_DENIED', message, { serviceId: principal.serviceId, reason: outcome });
  }

  /** 范围之内的视频：已登记项目里的视频目录，各带 videoId（不打开视频）。 */
  async listVideos(access: ServiceAccess): Promise<Record<string, unknown>> {
    const videos: Record<string, unknown>[] = [];
    let skipped = 0;
    const open = new Map(this.#deps.videos.openRefs().map((ref) => [ref.path, ref]));
    for (const project of (await this.#projects()).values()) {
      const found = await this.#scanProject(project).catch(() => null);
      if (!found) {
        skipped++;
        continue;
      }
      skipped += found.skipped;
      for (const video of found.videos) {
        if (!inPolicy(video.videoId, access.policy)) continue;
        videos.push({
          videoId: video.videoId,
          name: video.name,
          projectId: project.id,
          project: project.name,
          path: `${project.id}/${video.relPath}`,
          open: open.has(video.dir),
        });
      }
    }
    // i18n-ignore-start: 工具结果（issue、next）只给外部智能体（模型）看
    return {
      videos,
      ...(skipped > 0 ? { issue: `有 ${skipped} 个目录没能读取，没有列出` } : {}),
      next: '用 videoId 调用 videos_inspect 读取视频；修改之前先读，拿到 revision 与对象 ID。',
    };
    // i18n-ignore-end
  }

  /** 新建视频的位置：调用方给的已登记项目（id，或项目目录的路径）。不给时 `INVALID_ARGUMENTS`，没有这个项目时 `PROJECT_NOT_FOUND`。 */
  createRoot(_access: ServiceAccess, project?: string): { root: string; scope: { projectId: Id } } {
    const projects = this.#deps.harness.listProjects();
    if (project === undefined) {
      // i18n-ignore-start: ToolError 的消息只给外部智能体（模型）看
      throw new ToolError('INVALID_ARGUMENTS', '对外服务新建视频要给 project：建在哪个已登记的项目里', {
        next: '给 project：项目 id（videos_list 结果里的 projectId），视频建在那个项目里',
      });
      // i18n-ignore-end
    }
    const found =
      projects.find((p) => p.id === project) ??
      (path.isAbsolute(project) ? projects.find((p) => path.resolve(p.path) === path.resolve(project)) : undefined);
    // i18n-ignore: ToolError 的消息只给外部智能体（模型）看
    if (!found) throw new ToolError('PROJECT_NOT_FOUND', `找不到项目「${project}」：用 videos_list 结果里的 projectId`);
    return { root: found.path, scope: { projectId: found.id } };
  }

  /** 服务新建的视频：加进它的范围，之后列表与按 ID 访问都看得见。 */
  async recordCreated(access: ServiceAccess, created: VideoCreated): Promise<void> {
    access.principal.audit.videoId = created.videoId;
    if (access.policy.videos !== 'all') await this.#deps.allowVideo?.(access.principal.serviceId, created.videoId);
  }

  /** 服务启动的流程新建的视频（从链接下载）：同样加进范围；调用早已返回，不改审计。 */
  async adoptCreatedVideo(access: ServiceAccess, videoId: Id): Promise<void> {
    if (access.policy.videos !== 'all') await this.#deps.allowVideo?.(access.principal.serviceId, videoId);
  }

  async open(video: string, access: ServiceAccess): Promise<VideoOpenResult> {
    const located = await this.#locate(video, access);
    let opened: VideoOpenResult;
    try {
      opened = await this.#deps.videos.open(
        { root: located.project.path, file: located.dir, scope: { projectId: located.project.id } },
        access.principal,
      );
    } catch (error) {
      if (error instanceof RpcError && (error.code === 'not-found' || error.code === 'forbidden')) throw videoNotFound(video);
      throw error;
    }
    // 副本在打开时换了标识：换过之后的视频也要在范围里。
    if (!inPolicy(opened.ref.videoId, access.policy)) {
      await this.#deps.videos.close(opened.ref.videoId, access.principal);
      throw videoNotFound(video);
    }
    access.principal.audit.videoId = opened.ref.videoId;
    return opened;
  }

  /** `importAsset.path` 相对视频所在的项目目录，且只能是项目目录里的文件（§12.8）。 */
  importBase(_access: ServiceAccess, opened: VideoOpenResult): { cwd: string; confine: string | null } {
    const project = this.#deps.harness.listProjects().find((p) => p.id === opened.ref.source.projectId);
    if (!project) throw videoNotFound(opened.ref.videoId);
    return { cwd: project.path, confine: project.path };
  }

  /** 对外服务没有本机路径的入口（§4.8）：文件只能经范围之内的视频或链接进来。 */
  fileBase(): never {
    // i18n-ignore-start: ToolError 的消息只给外部智能体（模型）看
    throw new ToolError('INVALID_ARGUMENTS', '对外服务不能给本机文件路径（file、files、outDir）', {
      next: '给 video（范围之内的视频，videos_list 列出的 videoId）或 url（链接，落点是 video 或 project）；文件只能写进视频所属项目的 exports/（export）。',
    });
    // i18n-ignore-end
  }

  commandId(access: ServiceAccess, given: string | undefined): string {
    return given === undefined ? newId('cmd') : `svc-${access.principal.clientId}-${given}`;
  }

  async visibleJob(jobId: Id, access: ServiceAccess): Promise<JobRecord> {
    let record: JobRecord;
    try {
      record = this.#deps.jobs.inspect(jobId);
    } catch {
      throw jobNotFound(jobId);
    }
    if (!this.owns(record, access)) throw jobNotFound(jobId);
    return record;
  }

  /** `jobs_list`：这个客户端自己提交的任务。 */
  async visibleJobs(access: ServiceAccess): Promise<JobRecord[]> {
    return this.#deps.jobs.list().filter((record) => this.owns(record, access));
  }

  /**
   * `projects_list`：范围之内的视频所属的项目，带范围之内的视频数；访问策略是全部视频时列出全部已登记项目（没有视频的也列，
   * `videos_create` 要用它的 id）。不给项目目录的路径。读不了的项目在全部视频时照列、不带视频数。
   */
  async listProjects(access: ServiceAccess): Promise<ScopedProject[]> {
    const listed: ScopedProject[] = [];
    for (const project of (await this.#projects()).values()) {
      const found = await this.#scanProject(project).catch(() => null);
      const count = found?.videos.filter((v) => inPolicy(v.videoId, access.policy)).length;
      if (access.policy.videos !== 'all' && !count) continue;
      listed.push(scopedProject(project, { path: false, videoCount: count }));
    }
    return listed;
  }

  async visibleArtifact(artifactId: string, access: ServiceAccess): Promise<VisibleArtifact> {
    const record = this.#deps.jobs
      .list()
      .find(
        (r) => this.owns(r, access) && (r.result?.artifactId === artifactId || r.result?.outputs?.some((o) => o.artifactId === artifactId)),
      );
    if (record) {
      const output = record.result?.outputs?.find((o) => o.artifactId === artifactId) ?? null;
      const file = await locateArtifact(this.#deps.jobs.artifacts, artifactId, output);
      // i18n-ignore: ToolError 的消息只给外部智能体（模型）看
      if (!file) throw new ToolError('ARTIFACT_NOT_FOUND', `产物 ${artifactId} 的文件已经不在了`);
      return { record, output, file };
    }
    throw new ToolError(
      'ARTIFACT_NOT_FOUND',
      // i18n-ignore: ToolError 的消息只给外部智能体（模型）看
      `找不到产物 ${artifactId}，或它不属于你提交的任务（jobs_inspect 的 outputs 里的 artifactId）`,
    );
  }

  /** 这个客户端自己提交的任务。 */
  owns(record: JobRecord, access: ServiceAccess): boolean {
    const { submitter } = record;
    return submitter.kind === 'service' && submitter.id === access.principal.serviceId && submitter.clientId === access.principal.clientId;
  }

  recordChange(): void {}

  /** 只为范围里的视频写文件（`videos_frames`）：视频所属项目的 `exports/`。不针对视频的（把产物写成文件）不提供。 */
  saveRoot(_access: ServiceAccess, opened?: VideoOpenResult): string {
    // i18n-ignore: ToolError 的消息只给外部智能体（模型）看
    if (!opened) throw new ToolError('UNKNOWN_TOOL', '这个服务不能把产物写成文件');
    const project = this.#deps.harness.listProjects().find((p) => p.id === opened.ref.source.projectId);
    if (!project) throw videoNotFound(opened.ref.videoId);
    return path.join(project.path, 'exports');
  }

  /** 导出只能写进视频所属项目的 `exports/`（及其中已有的子目录）。 */
  exportBase(_access: ServiceAccess, opened: VideoOpenResult): { base: string; within: string; ownDefault: boolean } {
    const project = this.#deps.harness.listProjects().find((p) => p.id === opened.ref.source.projectId);
    if (!project) throw videoNotFound(opened.ref.videoId);
    return { base: path.join(project.path, 'exports'), within: project.path, ownDefault: true };
  }

  // ---- 定位 ----

  /** 视频参数 → 范围之内的视频。按 videoId（打开的或之前列出过的，找不到时重新扫一遍）或 `<projectId>/<相对路径>`。 */
  async #locate(video: string, access: ServiceAccess): Promise<Located> {
    const projects = await this.#projects();
    let located: Located | null = null;
    const ref = this.#deps.videos.ref(video);
    if (ref) {
      const project = ref.source.projectId ? projects.get(ref.source.projectId) : undefined;
      if (project && inside(ref.path, project.path)) located = { project, dir: ref.path, videoId: ref.videoId, name: ref.name };
    } else {
      const slash = video.indexOf('/');
      const project = slash > 0 ? projects.get(video.slice(0, slash)) : undefined;
      if (project) {
        located = await this.#peek(project, path.resolve(project.path, video.slice(slash + 1)));
      } else {
        located = await this.#byId(video, projects);
      }
    }
    if (!located || !inPolicy(located.videoId, access.policy)) throw videoNotFound(video);
    return located;
  }

  async #byId(videoId: Id, projects: Map<Id, Project>): Promise<Located | null> {
    const known = this.#index.get(videoId);
    const project = known ? projects.get(known.projectId) : undefined;
    if (known && project) {
      const located = await this.#peek(project, known.dir);
      if (located?.videoId === videoId) return located;
    }
    for (const candidate of projects.values()) {
      const found = await this.#scanProject(candidate).catch(() => null);
      const hit = found?.videos.find((v) => v.videoId === videoId);
      if (hit) return { project: candidate, dir: hit.dir, videoId: hit.videoId, name: hit.name };
    }
    return null;
  }

  /** 已登记的项目，路径换成真实路径（视频的位置都是真实路径）。 */
  async #projects(): Promise<Map<Id, Project>> {
    const projects = new Map<Id, Project>();
    for (const project of this.#deps.harness.listProjects()) {
      const real = await fs.realpath(project.path).catch(() => null);
      if (real) projects.set(project.id, { ...project, path: real });
    }
    return projects;
  }

  /** 只读地看一个视频目录（按真实路径）。不是项目里的视频目录时为空。 */
  async #peek(project: Project, target: string): Promise<Located | null> {
    const dir = await fs.realpath(target).catch(() => null);
    if (!dir || !inside(dir, project.path) || dir === project.path) return null;
    const open = this.#deps.videos.openRefs().find((ref) => ref.path === dir);
    if (open) return { project, dir, videoId: open.videoId, name: open.name };
    try {
      const seen = await this.#deps.videos.peek(dir);
      this.#index.set(seen.videoId, { projectId: project.id, dir });
      return { project, dir, videoId: seen.videoId, name: seen.name };
    } catch {
      return null;
    }
  }

  async #scanProject(project: Project): Promise<{ videos: (Located & { relPath: string })[]; skipped: number }> {
    const scan = await scanDirectory(project.path);
    const videos: (Located & { relPath: string })[] = [];
    let skipped = scan.issue ? 1 : 0;
    for (const file of scan.files) {
      if (file.kind !== 'video') continue;
      const located = await this.#peek(project, path.join(project.path, ...file.relPath.split('/')));
      if (located) videos.push({ ...located, relPath: file.relPath });
      else skipped++;
    }
    return { videos, skipped };
  }
}

function inPolicy(videoId: Id, policy: ServicePolicy): boolean {
  return policy.videos === 'all' || policy.videos.ids.includes(videoId);
}

function inside(candidate: string, root: string): boolean {
  const base = path.resolve(root);
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  return candidate === base || candidate.startsWith(prefix);
}

function videoNotFound(video: string): ToolError {
  // i18n-ignore: ToolError 的消息只给外部智能体（模型）看
  return new ToolError('VIDEO_NOT_FOUND', `找不到视频「${video}」：用 videos_list 给出的 videoId`);
}

function jobNotFound(jobId: Id): ToolError {
  // i18n-ignore: ToolError 的消息只给外部智能体（模型）看
  return new ToolError('JOB_NOT_FOUND', `找不到任务 ${jobId}，或它不是你提交的`);
}
