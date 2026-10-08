import { refOf } from '@baocut/protocol';
import type {
  AgentMode,
  ApprovalGrantChoice,
  GeneratedOutput,
  GrantRequestItem,
  Id,
  JobRecord,
  JobSubmitter,
  Localized,
  MessageRef,
  Project,
  RiskLevel,
  ServiceId,
  VideoChange,
  VideoCreated,
  VideoOpenResult,
} from '@baocut/protocol';
import type { TrustedPrincipal } from '../gateway.ts';
import type { EngineProtection } from '../videos/video-service.ts';
import type { AgentPrincipal } from './grants.ts';
import { ToolError } from './tool-catalog.ts';

/**
 * 工具的权限与范围（架构设计 §3.5、§4.8）。同一套工具实现（视频、模型）服务两种主体，区别只在这里：
 *
 * - 会话里的智能体（`AgentScope`）：工具只在任务里可用，规划模式只读，范围是会话的来源目录；有副作用的调用按会话此刻的
 *   访问模式与动作的风险查表（§3.12），要问的在会话里等用户；
 * - 对外服务的客户端（`ServiceScope`）：访问策略给出范围（全部视频或名单）与操作等级，`ask` 下逐次由用户确认；
 * - 终端里的用户本人（`LocalScope`，`catalog.call`）：用户能访问的一切，相对路径按 cwd 解析，不走 BaoCut 的审批。
 *
 * 一份目录同时服务会话里的智能体与终端时，工具组拿到的是 `ScopeRouter`：按主体的种类转给各自的范围。
 *
 * 工具先 `authorize`，有副作用的再 `confirm`，然后经范围打开视频、提交任务；看得到哪些任务与产物也由范围决定。
 */

/** 对外服务的主体（§4.8）：每个通过认证的外部请求一个，`name` 是服务 ID（操作者记为 `external:<serviceId>`）。 */
export interface ServicePrincipal extends TrustedPrincipal {
  kind: 'service';
  serviceId: ServiceId;
  clientId: string;
  clientName: string;
  /** 外部请求断开时中止：等待中的审批随之取消。 */
  signal: AbortSignal;
  /** 审计：这次请求解析到的目标视频（范围之内的）。 */
  audit: { videoId: Id | null };
}

/**
 * 终端里的用户本人（`catalog.call`，§3.5）：CLI 或桌面连接经网关按名调用目录里的工具。范围是用户能访问的一切，相对路径按
 * `cwd` 解析；写入的操作者是 `user_local`（与桌面界面共用撤销栈），任务的提交者是发起调用的连接；不走 BaoCut 的审批。
 */
export interface LocalPrincipal extends TrustedPrincipal {
  kind: 'local';
  /** 发起调用的网关连接：经它打开的视频在连接断开时随之放下（与界面打开的相同）。 */
  connectionId: string;
  /** 发起调用的连接种类（审计）。 */
  client: 'cli' | 'desktop';
  /** CLI 的工作目录（绝对的真实路径），相对路径按它解析。 */
  cwd: string;
  /** 显式指定或从 cwd 向上找到的项目目录（真实路径）；没有则 null。 */
  projectDir: string | null;
}

export type ToolPrincipal = AgentPrincipal | ServicePrincipal | LocalPrincipal;

/** 一次调用的授权结果：提交任务时的提交者，以及范围自己的上下文。 */
export interface ToolAccess {
  readonly principal: ToolPrincipal;
  readonly submitter: JobSubmitter;
}

/**
 * 有副作用的调用在执行之前的确认（§3.12）：显示给用户的内容与动作的风险等级。`video` 是调用方给的视频参数，
 * 确认之前先按范围解析；`targets` 是别的目标（文件）。`risk` 不给时按 `TOOL_RISK` 里工具的默认等级。
 */
export interface ToolConfirmation {
  tool: string;
  video?: string;
  targets?: string[];
  summary: string;
  /** `summary` 的消息引用（文案目录 rcAgentTools）；审批动作还没有引用字段时只用 `summary`。 */
  summaryRef?: MessageRef;
  risk?: RiskLevel;
  /**
   * 这次调用要外发、还没有授权覆盖的数据（§12.5）。给了时确认通过就是授权了这次外发：说明里带回用户的选择（`grant`）；
   * 对外服务的 `auto` 等级不是外发授权，直接以 `GRANT_REQUIRED` 拒绝。
   */
  grants?: GrantRequestItem[];
}

/** 审批里给人看的一句话：当前语言的文字与它的引用。 */
export function confirmSummary(summary: Localized): { summary: string; summaryRef: MessageRef } {
  return { summary: summary.text, summaryRef: refOf(summary) };
}

/** 确认的结果，记进工具结果（§3.12）：当时生效的模式（对外服务没有模式）、风险等级与谁做的决定。 */
export interface ToolApprovalNote {
  mode: AgentMode | null;
  risk: RiskLevel;
  /** `rule`：用户之前选了「总是允许」，按存下的规则自动答应。 */
  decidedBy: 'auto' | 'user' | 'rule';
  /** 带外发授权的确认通过时：用户对授权的选择（自动通过的是只这一次）。不进工具结果。 */
  grant?: ApprovalGrantChoice;
}

/**
 * 工具的默认风险等级（§3.12）。取决于参数的工具（模型工具、`artifacts_save`、`export`）在确认时给出 `risk`；
 * 这里没有、调用时也没给的按 `command` 处理。
 */
export const TOOL_RISK: Readonly<Record<string, RiskLevel>> = {
  videos_create: 'edit',
  edits_apply: 'edit',
  edits_undo: 'edit',
  // 建字幕层（§7.9）：一笔可撤销的修改，与 edits_apply 同级。
  captions_create: 'edit',
  // 写文档与导入素材（§3.5）：编译成 edits_apply 的操作，一笔可撤销的修改，同级。
  documents_put: 'edit',
  assets_import: 'edit',
  // 清理没有引用的素材：只列出时只读；apply 时编译成 removeAssets，一笔可撤销的修改，同级。
  assets_prune: 'edit',
  // 采用来源章节：dryRun 时只读；否则编译成一个 setChapters，一笔可撤销的修改，同级。
  chapters_adopt: 'edit',
  // 导入代码画面（架构设计 §8）：验证、烘焙后编译成导入素材与放置片段两笔可撤销的修改，与 assets_import 同级。
  compositions_import: 'edit',
  // 打开便携包：新建一个视频目录，与 videos_create 同级。
  videos_import_package: 'edit',
  // 取帧（Agent 面设计 §4.3）：不改视频，只把帧写进写文件目录下的 .baocut-out/frames/，规划模式也能用。
  videos_frames: 'read',
  // 预览代码画面：不改视频，只在离屏宿主里取帧，写进 .baocut-out/frames/，与 videos_frames 同级。
  compositions_preview: 'read',
  videos_history: 'read',
  edits_ops: 'read',
  export: 'edit',
  artifacts_save: 'edit',
  jobs_cancel: 'command',
  // 一级动词（Agent 面设计 §4.2）：启动固定流程；外发授权由流程检查，不在确认里代发。
  transcribe: 'command',
  translate: 'command',
  dub: 'command',
  transcode: 'command',
  speak: 'command',
  image: 'command',
  // 下载模型（§6.3）：先给出大小，按访问模式决定要不要问。
  models_install: 'command',
  space_list: 'read',
  space_search: 'read',
  // skill 的正文（§3.8）：只读 skill 目录里登记的文件。
  skills_read: 'read',
  grants_request: 'high',
  // 从链接下载（§7.9、§12.9）：下载按 `command`；要先下载 yt-dlp 或第一次同意用它时是 `high`，用各自的审批名，「本会话内都允许」不互相沿用。
  download: 'command',
  external_tools_install: 'high',
  external_tools_consent: 'high',
  // 把工作目录里的文件复制到下载目录（§3.5、§7.9）：工作目录以外的新文件，只进下载目录、不覆盖，与下载同级。
  downloads_save: 'command',
  // 删除视频（§5.5、§5.7）：移进回收站，可以恢复，但视频会从编辑器里消失；不在 MCP 面（`surfaces` 没有 `mcp`）。
  videos_delete: 'high',
  // 任务（Agent 面设计 §4.3）：等待与列表只读；重跑失败的固定流程与取消同级。
  jobs_wait: 'read',
  jobs_list: 'read',
  jobs_retry: 'command',
  // 本地模型包的状态只读；样本检查占用本机算力，与提交任务同级。
  models_list: 'read',
  models_test: 'command',
  // 新建项目：在会话的来源目录里是 `edit`，别处是写项目目录之外（`high`），调用时按路径给出；这里是默认值。
  projects_list: 'read',
  projects_create: 'high',
  skills_list: 'read',
  // 用户库（§5.9）：只读。
  library_list: 'read',
  library_show: 'read',
};

export function toolRisk(request: ToolConfirmation): RiskLevel {
  return request.risk ?? TOOL_RISK[request.tool] ?? 'command';
}

/** 工具的默认风险等级（目录列表用）：没有登记的按 `command`。 */
export function defaultToolRisk(tool: string): RiskLevel {
  return TOOL_RISK[tool] ?? 'command';
}

/** 工具结果里的 `approval` 字段：确认给了说明时带上（会话里的调用），否则不带。 */
export function approvalField(note: ToolApprovalNote | void): { approval?: ToolApprovalNote } {
  if (!note) return {};
  const { grant: _, ...approval } = note;
  return { approval };
}

export interface VisibleArtifact {
  record: JobRecord;
  output: GeneratedOutput | null;
  file: string;
}

/** 新建视频的位置：来源目录与来源。 */
export interface VideoRoot {
  root: string;
  scope: { projectId: Id } | { conversationId: Id };
  note?: string;
}

/** 导出目标目录的约束（见 `ToolScope.exportBase`）。 */
export interface ExportBase {
  base: string;
  within: string | null;
  ownDefault: boolean;
}

/**
 * `projects_list` 的一项：范围之内的已登记项目，与其中（范围之内的）视频数，数不出来时不给。`path` 是项目目录的绝对路径，
 * 对外服务不给（它的客户端只用项目 id）。
 */
export interface ScopedProject {
  projectId: Id;
  name: string;
  path?: string;
  videoCount?: number;
}

/** 已登记项目 → `projects_list` 的一项。 */
export function scopedProject(project: Project, extra: { path?: boolean; videoCount?: number | undefined } = {}): ScopedProject {
  return {
    projectId: project.id,
    name: project.name,
    ...(extra.path === false ? {} : { path: project.path }),
    ...(extra.videoCount !== undefined ? { videoCount: extra.videoCount } : {}),
  };
}

export interface ToolScope<A extends ToolAccess = ToolAccess> {
  /** 能不能调用（`write`：会改视频、提交或取消任务、写文件）。不能时抛出 `ToolError`。 */
  authorize(principal: ToolPrincipal, write: boolean): A;
  /**
   * 有副作用的调用在执行之前确认：按范围的模式（或等级）与风险查表，自动的立即通过，要问的等用户，拒绝时抛出 `ToolError`。
   * 返回的说明可以放进工具结果；没有时为 undefined。
   */
  confirm(access: A, request: ToolConfirmation): Promise<ToolApprovalNote | void>;
  /** `videos_list` 的结果：范围里的视频。 */
  listVideos(access: A): Promise<Record<string, unknown>>;
  /**
   * 新建视频的位置。`project` 是调用方给的项目（项目 id 或已登记项目目录的路径）：会话里不给时用会话的来源目录，
   * 给了只能是会话所属的项目；对外服务必须给（缺了 `INVALID_ARGUMENTS`），看不到的项目与不存在的一样回答 `PROJECT_NOT_FOUND`；
   * 终端里按 cwd 解析成项目目录。`note` 是给调用方的说明（例如落到了默认项目），`videos_create` 带进结果。
   */
  createRoot(access: A, project?: string): VideoRoot | Promise<VideoRoot>;
  /** 打开（或接上已经打开的）范围里的视频。范围之外的与不存在的一样回答 `VIDEO_NOT_FOUND`。 */
  open(video: string, access: A): Promise<VideoOpenResult>;
  /** `importAsset.path` 相对的目录；`confine` 不为空时路径（按真实路径）必须在它里面。 */
  importBase(access: A, opened: VideoOpenResult): { cwd: string; confine: string | null };
  /**
   * 调用方给的本机文件（`transcribe` 的 `file`、`translate` 的 `file`、`transcode` 的 `files` 与 `outDir`）相对的目录：
   * 会话的工作目录、终端的 cwd。对外服务没有本机路径的入口，以 `INVALID_ARGUMENTS` 拒绝（`next` 指向 `video` / `url`）。
   */
  fileBase(access: A): string;
  /** 调用方给的幂等键换成提交用的；没给时新生成。 */
  commandId(access: A, given: string | undefined): string;
  /** 看得到的任务；看不到的与不存在的一样回答。 */
  visibleJob(jobId: Id, access: A): Promise<JobRecord>;
  /** 看得到的全部任务（`jobs_list`），新的在前；范围与 `visibleJob` 相同。 */
  visibleJobs(access: A): Promise<JobRecord[]>;
  /** 范围之内的已登记项目（`projects_list`）。 */
  listProjects(access: A): Promise<ScopedProject[]>;
  /** 看得到的任务的产物。 */
  visibleArtifact(artifactId: string, access: A): Promise<VisibleArtifact>;
  /** 这次调用的主体自己提交的任务（能取消的）。 */
  owns(record: JobRecord, access: A): boolean;
  /** 修改提交之后：会话放一张变更卡；对外服务不做（审计在服务里记）。 */
  recordChange(access: A, change: VideoChange): void;
  /** `videos_create` 新建视频之后：会话记一条 `video-created`；对外服务把它登记进自己的视频范围（之后看得见）。 */
  recordCreated?(access: A, created: VideoCreated): void | Promise<void>;
  /**
   * 固定流程替调用方新建的视频（`download` / `transcribe` 给链接时的 `newVideo`）：对外服务把它登记进自己的视频范围；会话不做
   * （视频卡来自流程的任务卡片）。
   */
  adoptCreatedVideo?(access: A, videoId: Id): void | Promise<void>;
  /**
   * 写文件的目录：`artifacts_save` 的目标，`videos_frames` 在它下面的 `.baocut-out/frames/` 里写帧，`videos_import_package` 的
   * 相对路径也按它解析。给了 `opened` 时是为这个视频写（对外服务只在这时提供：视频所属项目的 `exports/`）。
   */
  saveRoot(access: A, opened?: VideoOpenResult): string;
  /**
   * `export` 的目标目录：`dir` 相对 `base`，按真实路径不能出 `base`。`ownDefault` 时不给 `dir` 也导出到 `base`
   * （不存在时在 `within` 里建）；否则不给 `dir` 时用导出服务的默认位置（视频来源目录的 `exports/`）。
   * `within` 为 null 时没有目录约束：`dir` 可以是绝对路径，相对的按 `base` 解析（终端里的用户本人）。
   */
  exportBase(access: A, opened: VideoOpenResult): ExportBase;
  /** 这次调用所在任务的合同对这个视频的保护范围（§3.2），随修改交给引擎。没有任务合同的范围（对外服务）不实现。 */
  protections?(access: A, videoId: Id): EngineProtection[];
}

/**
 * 按主体的种类把调用转给各自的范围（§3.5）：同一份目录同时服务会话里的智能体（工具桥）与终端里的用户本人（`catalog.call`）。
 * 授权之后的调用按 `access.principal` 转发，访问对象始终是那个范围自己给出的。没有登记的种类一律 `FORBIDDEN`。
 */
export class ScopeRouter implements ToolScope<ToolAccess> {
  readonly #scopes: Partial<Record<ToolPrincipal['kind'], ToolScope>>;

  constructor(scopes: Partial<Record<ToolPrincipal['kind'], ToolScope>>) {
    this.#scopes = scopes;
  }

  #of(principal: ToolPrincipal): ToolScope {
    const scope = this.#scopes[principal.kind];
    // i18n-ignore: 给模型的工具说明、错误与下一步
    if (!scope) throw new ToolError('FORBIDDEN', '这个工具通道不服务这类调用方');
    return scope;
  }

  authorize(principal: ToolPrincipal, write: boolean): ToolAccess {
    return this.#of(principal).authorize(principal, write);
  }
  confirm(access: ToolAccess, request: ToolConfirmation): Promise<ToolApprovalNote | void> {
    return this.#of(access.principal).confirm(access, request);
  }
  listVideos(access: ToolAccess): Promise<Record<string, unknown>> {
    return this.#of(access.principal).listVideos(access);
  }
  createRoot(access: ToolAccess, project?: string): VideoRoot | Promise<VideoRoot> {
    return this.#of(access.principal).createRoot(access, project);
  }
  open(video: string, access: ToolAccess): Promise<VideoOpenResult> {
    return this.#of(access.principal).open(video, access);
  }
  importBase(access: ToolAccess, opened: VideoOpenResult): { cwd: string; confine: string | null } {
    return this.#of(access.principal).importBase(access, opened);
  }
  fileBase(access: ToolAccess): string {
    return this.#of(access.principal).fileBase(access);
  }
  commandId(access: ToolAccess, given: string | undefined): string {
    return this.#of(access.principal).commandId(access, given);
  }
  visibleJob(jobId: Id, access: ToolAccess): Promise<JobRecord> {
    return this.#of(access.principal).visibleJob(jobId, access);
  }
  visibleJobs(access: ToolAccess): Promise<JobRecord[]> {
    return this.#of(access.principal).visibleJobs(access);
  }
  listProjects(access: ToolAccess): Promise<ScopedProject[]> {
    return this.#of(access.principal).listProjects(access);
  }
  visibleArtifact(artifactId: string, access: ToolAccess): Promise<VisibleArtifact> {
    return this.#of(access.principal).visibleArtifact(artifactId, access);
  }
  owns(record: JobRecord, access: ToolAccess): boolean {
    return this.#of(access.principal).owns(record, access);
  }
  recordChange(access: ToolAccess, change: VideoChange): void {
    this.#of(access.principal).recordChange(access, change);
  }
  recordCreated(access: ToolAccess, created: VideoCreated): void | Promise<void> {
    return this.#of(access.principal).recordCreated?.(access, created);
  }
  adoptCreatedVideo(access: ToolAccess, videoId: Id): void | Promise<void> {
    return this.#of(access.principal).adoptCreatedVideo?.(access, videoId);
  }
  saveRoot(access: ToolAccess, opened?: VideoOpenResult): string {
    return this.#of(access.principal).saveRoot(access, opened);
  }
  exportBase(access: ToolAccess, opened: VideoOpenResult): ExportBase {
    return this.#of(access.principal).exportBase(access, opened);
  }
  protections(access: ToolAccess, videoId: Id): EngineProtection[] {
    return this.#of(access.principal).protections?.(access, videoId) ?? [];
  }
}
