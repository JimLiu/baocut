// i18n-ignore-file: 工具通道（CLI 的本机范围）的错误、下一步与说明，给终端里的智能体与用户，与工具说明用同一种语言
import fs from 'node:fs/promises';
import path from 'node:path';
import { RpcError, newId, type Id, type JobRecord, type JobSubmitter, type Project, type VideoOpenResult } from '@baocut/protocol';
import type { Harness } from '@baocut/harness';
import { locateArtifact, type JobManager } from '@baocut/jobs';
import type { TrustedPrincipal } from '../gateway.ts';
import type { VideoService } from '../videos/video-service.ts';
import { scanDirectory, type SpaceCatalog } from '../space-catalog.ts';
import { grantRequiredDetails, GRANT_NEXT } from '../grants/grant-errors.ts';
import { ToolError } from './tool-catalog.ts';
import {
  scopedProject,
  type ExportBase,
  type LocalPrincipal,
  type ScopedProject,
  type ToolAccess,
  type ToolApprovalNote,
  type ToolConfirmation,
  type ToolPrincipal,
  type ToolScope,
  type VideoRoot,
  type VisibleArtifact,
} from './tool-scope.ts';

/**
 * 终端里的用户本人的权限与范围（架构设计 §3.5；Agent 面设计 §3）：CLI（或桌面连接）经网关 `catalog.call` 按名调用目录里的工具。
 *
 * - **范围**：用户能访问的一切。视频用 videoId、视频目录（绝对或相对 cwd）或 Space 条目 id 指明，解析顺序是目录 → videoId → 条目；
 *   没打开的由 Runtime 打开，挂在发起调用的连接上，调用完不强制关闭（连接断开时随之放下，与界面打开的相同）。
 * - **确认**：不走 BaoCut 的审批，确认由 Agent 宿主（或终端里的用户自己）负责。外发数据与桌面界面相同：启用了的在线 Provider
 *   已有默认授权；没有授权覆盖的（用户撤销了）以 `GRANT_REQUIRED` 拒绝，不在这里替用户发放授权。
 * - **写入**：操作者 `user_local`（`actorOf` 按非智能体、非对外服务处理），与桌面界面共用撤销栈；任务的提交者是发起调用的连接
 *   （`{ kind: 'connection', id }`），与桌面端连接提交的相同。任务与产物全部可见、都能取消（与任务中心相同）。
 * - **路径**：素材导入、导出目标与产物保存按 cwd 解析相对路径，绝对路径照收，没有目录约束；视频目录与 `.bcut` 不可写是引擎与
 *   导出的保护，不在这里做。
 * - **项目**：`projectDir`（显式给，或从 cwd 向上找到的）里新建视频；没有时新建到默认项目目录下的 `CLI` 项目，并在结果里说明。
 */

export interface LocalAccess extends ToolAccess {
  readonly principal: LocalPrincipal;
}

export interface LocalScopeDeps {
  harness: Harness;
  videos: VideoService;
  jobs: JobManager;
  /** Space 目录在工具目录之后才建好：调用时再取。 */
  space: () => SpaceCatalog;
  /** 默认项目目录（`BAOCUT_PROJECTS_DIR`，见 `RuntimeHome.projectsDir`）。 */
  projectsDir: string;
}

/** 当前目录不在任何项目里时，新建视频所在的项目（默认项目目录下）。 */
export const LOCAL_DEFAULT_PROJECT_DIR = 'CLI';

const PROJECT_MARKER = path.join('.bcut', 'project.json');

/**
 * 网关连接 + `catalog.call` 的参数 → 这次调用的主体。`cwd` 与 `project` 是绝对路径（协议的 schema 已经检查；`--project` 的相对路径
 * 由 CLI 按 cwd 解析好）；不存在或不是目录时以 `INVALID_ARGUMENTS` 拒绝。不给 `project` 时从 cwd 向上找 `.bcut/project.json`。
 * 这里只找、不登记：登记项目（写标记）留到真要用项目的时候（新建视频、按目录打开视频）。
 */
export async function resolveLocalPrincipal(
  connection: TrustedPrincipal,
  params: { cwd: string; project?: string | null },
): Promise<LocalPrincipal> {
  const cwd = await realDirectory(params.cwd, 'cwd');
  const projectDir = params.project ? await realDirectory(params.project, 'project') : await findProjectDir(cwd);
  return {
    kind: 'local',
    connectionId: connection.connectionId,
    name: connection.name,
    client: connection.kind === 'desktop' ? 'desktop' : 'cli',
    cwd,
    projectDir,
  };
}

export class LocalScope implements ToolScope<LocalAccess> {
  readonly #deps: LocalScopeDeps;

  constructor(deps: LocalScopeDeps) {
    this.#deps = deps;
  }

  /** 一律允许：CLI 是用户本人在终端里操作，或用户授权的终端 Agent。 */
  authorize(principal: ToolPrincipal, _write: boolean): LocalAccess {
    if (principal.kind !== 'local') throw new ToolError('FORBIDDEN', '这个范围只服务终端里的调用');
    const submitter: JobSubmitter = { kind: 'connection', id: principal.connectionId };
    return { principal, submitter };
  }

  /**
   * 不生成审批：确认由 Agent 宿主负责（Agent 面设计 §3.1）。没有授权覆盖的外发直接拒绝：Provider 的启用就是持续授权，
   * 用户撤销了的不在这里替用户补发。
   */
  async confirm(_access: LocalAccess, request: ToolConfirmation): Promise<ToolApprovalNote | void> {
    if (!request.grants?.length) return;
    const { message, details } = grantRequiredDetails(request.grants);
    const { code, remedy, ...extra } = details;
    throw new ToolError(code, message.text, {
      ...extra,
      remedy: {
        ...remedy,
        // i18n-ignore: ToolError 的补救只给 Agent 宿主里的模型看
        hint: '把数据交给这个服务商需要授权：在 BaoCut 的设置里重新启用这个服务商，或为它发放授权（数据种类、范围与预算），然后再试。',
      },
      next: GRANT_NEXT[code],
    });
  }

  /**
   * 在项目里（`projectDir`）时列出这个项目里的视频（相对项目目录的 path 与绝对的 dir）；不在项目里时列出 Space 里的全部视频
   * 与已经打开的视频。videoId 读不出来（被别处锁着）的照样列出，只是不带 videoId。
   */
  async listVideos(access: LocalAccess): Promise<Record<string, unknown>> {
    const { projectDir } = access.principal;
    const open = new Map(this.#deps.videos.openRefs().map((ref) => [ref.path, ref]));
    const next = '用 videoId 或视频目录调用 videos_inspect 读取视频；修改之前先读，拿到 revision 与对象 ID。';
    if (projectDir) {
      const scan = await scanDirectory(projectDir);
      const videos: Record<string, unknown>[] = [];
      for (const file of scan.files) {
        if (file.kind !== 'video') continue;
        const dir = path.join(projectDir, ...file.relPath.split('/'));
        const ref = open.get(dir);
        const seen = ref ?? (await this.#deps.videos.peek(dir).catch(() => null));
        videos.push({ path: file.relPath, dir, ...(seen ? { videoId: seen.videoId, name: seen.name } : {}), open: ref !== undefined });
      }
      return { project: projectDir, videos, ...(scan.issue ? { issue: scan.issue.detail } : {}), next };
    }
    const space = this.#deps.space();
    const listed = new Set<string>();
    const videos: Record<string, unknown>[] = [];
    for (const video of space.videos()) {
      listed.add(video.dir);
      const ref = open.get(video.dir);
      videos.push({
        dir: video.dir,
        ...(video.videoId ? { videoId: video.videoId } : {}),
        name: ref?.name ?? space.get(video.entryId).name,
        projectId: video.projectId,
        entryId: video.entryId,
        open: ref !== undefined,
      });
    }
    for (const ref of open.values()) {
      if (listed.has(ref.path)) continue;
      videos.push({ dir: ref.path, videoId: ref.videoId, name: ref.name, projectId: ref.source.projectId, open: true });
    }
    return { project: null, videos, next };
  }

  /**
   * 新建视频：调用方给了 `project`（项目目录，绝对或相对 cwd）就用它；否则在 `projectDir` 里（登记它）；都没有时在默认项目
   * 目录下的 `CLI` 项目里，并说明。
   */
  async createRoot(access: LocalAccess, project?: string): Promise<VideoRoot> {
    const { cwd, projectDir } = access.principal;
    const chosen = project !== undefined ? await realDirectory(path.resolve(cwd, project), 'project') : projectDir;
    if (chosen) {
      const registered = await this.#register(chosen);
      return { root: registered.path, scope: { projectId: registered.id } };
    }
    const dir = path.join(this.#deps.projectsDir, LOCAL_DEFAULT_PROJECT_DIR);
    await fs.mkdir(dir, { recursive: true });
    const fallback = await this.#register(dir);
    return {
      root: fallback.path,
      scope: { projectId: fallback.id },
      note: `当前目录不在 BaoCut 项目里：视频建在默认项目目录的 ${fallback.path}。要放进别的项目，在那个项目目录里运行，或用 --project 指定。`,
    };
  }

  async open(video: string, access: LocalAccess): Promise<VideoOpenResult> {
    const location = await this.#locate(video, access.principal);
    try {
      return await this.#deps.videos.open(location, access.principal);
    } catch (error) {
      if (error instanceof RpcError && (error.code === 'not-found' || error.code === 'forbidden')) throw videoNotFound(video);
      throw error;
    }
  }

  /** `importAsset.path` 相对 cwd；绝对路径照收，没有目录约束。 */
  importBase(access: LocalAccess): { cwd: string; confine: string | null } {
    return { cwd: access.principal.cwd, confine: null };
  }

  /** 本机文件按 cwd 解析，绝对路径照收。 */
  fileBase(access: LocalAccess): string {
    return access.principal.cwd;
  }

  commandId(_access: LocalAccess, given: string | undefined): string {
    return given ?? newId('cmd');
  }

  /** 全部任务都看得到（与任务中心相同）。 */
  async visibleJob(jobId: Id): Promise<JobRecord> {
    try {
      return this.#deps.jobs.inspect(jobId);
    } catch {
      throw new ToolError('JOB_NOT_FOUND', `找不到任务 ${jobId}`);
    }
  }

  /** `jobs_list`：全部任务（与任务中心相同）。 */
  async visibleJobs(): Promise<JobRecord[]> {
    return this.#deps.jobs.list();
  }

  /** `projects_list`：全部已登记项目，视频数按 Space 里登记的视频（首次扫描完成之后）。 */
  async listProjects(): Promise<ScopedProject[]> {
    const space = this.#deps.space();
    await space.ready;
    const counts = new Map<Id, number>();
    for (const video of space.videos()) {
      if (video.projectId) counts.set(video.projectId, (counts.get(video.projectId) ?? 0) + 1);
    }
    return this.#deps.harness.listProjects().map((project) => scopedProject(project, { videoCount: counts.get(project.id) ?? 0 }));
  }

  async visibleArtifact(artifactId: string): Promise<VisibleArtifact> {
    const record = this.#deps.jobs
      .list()
      .find((r) => r.result?.artifactId === artifactId || r.result?.outputs?.some((o) => o.artifactId === artifactId));
    if (!record) throw new ToolError('ARTIFACT_NOT_FOUND', `找不到产物 ${artifactId}（jobs_inspect 的 outputs 里的 artifactId）`);
    const output = record.result?.outputs?.find((o) => o.artifactId === artifactId) ?? null;
    const file = await locateArtifact(this.#deps.jobs.artifacts, artifactId, output);
    if (!file) throw new ToolError('ARTIFACT_NOT_FOUND', `产物 ${artifactId} 的文件已经不在了`);
    return { record, output, file };
  }

  /** 用户本人：哪个任务都能取消（与任务中心相同）。 */
  owns(): boolean {
    return true;
  }

  /** 变更卡只在会话里放；终端的修改在视频历史里（操作者 `user_local`）。 */
  recordChange(): void {}

  /** `artifacts_save` 写到 cwd。 */
  saveRoot(access: LocalAccess): string {
    return access.principal.cwd;
  }

  /** 导出目标按 cwd 解析，绝对路径照收；不给时由导出服务放到视频来源目录（所属项目）的 `exports/`。 */
  exportBase(access: LocalAccess): ExportBase {
    return { base: access.principal.cwd, within: null, ownDefault: false };
  }

  // ---- 定位 ----

  /** 视频参数 → 打开的位置。解析顺序：目录（绝对或相对 cwd）→ videoId → Space 条目 id。 */
  async #locate(video: string, principal: LocalPrincipal): Promise<{ root: string; file: string; scope: VideoRoot['scope'] }> {
    const asDir = await realDirectoryOrNull(path.resolve(principal.cwd, video));
    if (asDir) return this.#locateDir(asDir, principal, video);
    const dir = await this.#dirOfVideoId(video, principal);
    if (dir) return this.#locateDir(dir, principal, video);
    const space = this.#deps.space();
    let entryExists = true;
    try {
      space.get(video);
    } catch {
      entryExists = false;
    }
    if (entryExists) {
      try {
        return space.locate(video);
      } catch (error) {
        const code = error instanceof RpcError && isRecord(error.details) ? error.details.code : undefined;
        if (typeof code === 'string') throw new ToolError(code, (error as RpcError).message);
        throw videoNotFound(video);
      }
    }
    throw videoNotFound(video);
  }

  /** 视频目录 → 来源：已登记的项目（最深的那个）、向上找到的项目标记（登记它），或会话的工作目录（Space 里的条目）。 */
  async #locateDir(dir: string, principal: LocalPrincipal, video: string) {
    let best: Project | null = null;
    for (const project of this.#deps.harness.listProjects()) {
      const root = await fs.realpath(project.path).catch(() => null);
      if (root && dir !== root && inside(dir, root) && (!best || root.length > best.path.length)) best = { ...project, path: root };
    }
    if (!best) {
      const marked =
        principal.projectDir && dir !== principal.projectDir && inside(dir, principal.projectDir)
          ? principal.projectDir
          : await findProjectDir(path.dirname(dir));
      if (marked) best = await this.#register(marked);
    }
    if (best) return { root: best.path, file: dir, scope: { projectId: best.id } };
    const info = await this.#deps.space().videoEntryAt(dir);
    if (info) return { root: info.root, file: info.dir, scope: info.scope };
    throw new ToolError('VIDEO_NOT_FOUND', `视频目录「${video}」不在任何项目里：用 --project 指定它所属的项目`);
  }

  /** videoId → 视频目录：打开着的、Space 里登记的，或当前项目里的（逐个只读地看身份）。找不到时 null。 */
  async #dirOfVideoId(videoId: string, principal: LocalPrincipal): Promise<string | null> {
    const ref = this.#deps.videos.ref(videoId);
    if (ref) return ref.path;
    if (!VIDEO_ID.test(videoId)) return null;
    const known = this.#deps
      .space()
      .videos()
      .find((v) => v.videoId === videoId);
    if (known) return known.dir;
    if (!principal.projectDir) return null;
    const scan = await scanDirectory(principal.projectDir);
    for (const file of scan.files) {
      if (file.kind !== 'video') continue;
      const dir = path.join(principal.projectDir, ...file.relPath.split('/'));
      const seen = await this.#deps.videos.peek(dir).catch(() => null);
      if (seen?.videoId === videoId) return dir;
    }
    return null;
  }

  /** 登记（或接上已登记的）项目，与 `projects.open` 相同：副本里的视频在后台换标识。 */
  async #register(dir: string): Promise<Project> {
    const project = await this.#deps.harness.openProject(dir);
    void this.#deps.videos.claimProjectVideos(project).catch(() => {});
    return project;
  }
}

/** videoId 的样子：`video_` 加十六进制（与 AgentScope 相同）。 */
const VIDEO_ID = /^video_[0-9a-f]{8,32}$/;

/** 从 `start` 向上找 `.bcut/project.json` 所在的目录；到根目录都没有时 null。 */
async function findProjectDir(start: string): Promise<string | null> {
  for (let dir = start; ; dir = path.dirname(dir)) {
    const marked = await fs.stat(path.join(dir, PROJECT_MARKER)).then(
      (stat) => stat.isFile(),
      () => false,
    );
    if (marked) return dir;
    if (path.dirname(dir) === dir) return null;
  }
}

async function realDirectory(dir: string, field: string): Promise<string> {
  const real = await realDirectoryOrNull(dir);
  if (!real)
    throw new ToolError('INVALID_ARGUMENTS', `${field} 不存在或不是目录：${dir}`, { issues: [{ path: field, message: '不是目录' }] });
  return real;
}

async function realDirectoryOrNull(dir: string): Promise<string | null> {
  try {
    const real = await fs.realpath(dir);
    return (await fs.stat(real)).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

function inside(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function videoNotFound(video: string): ToolError {
  return new ToolError(
    'VIDEO_NOT_FOUND',
    `找不到视频「${video}」：给视频目录（绝对或相对当前目录）、videos_list 给出的 videoId，或 Space 条目 id`,
  );
}
