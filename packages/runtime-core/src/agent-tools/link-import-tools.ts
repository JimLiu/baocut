import { z } from 'zod';
import { LINK_IMPORT_PIPELINE, checkLink, isTerminal, type JobManager, type PipelineRunner } from '@baocut/jobs';
import { RpcError, type ExternalToolStatus, type Id, type JobRecord, type PipelineVideoTarget } from '@baocut/protocol';
import { RcAgentTools } from '@baocut/protocol/messages/runtime-core';
import type { ExternalToolService } from '../external-tools/external-tool-service.ts';
import { YT_DLP } from '../external-tools/tool-manifests.ts';
import { isGrantErrorDetails } from '../grants/grant-errors.ts';
import { formatBytes } from './model-install-tools.ts';
import { ToolError, type ToolInfo, type ToolSet } from './tool-catalog.ts';
import { approvalField, confirmSummary, type ToolAccess, type ToolPrincipal, type ToolScope } from './tool-scope.ts';
import { commandIdArg, videoArg } from './video-tools.ts';

/**
 * 从链接下载（架构设计 §7.9、§12.9；Agent 面设计 §4.2）：一个工具 `download`，按工具此刻的状态走三种确认之一。
 * `transcribe` 给 `url` 时走同一段（`startLinkImport`）。
 *
 * - yt-dlp 已安装、同意有效：按 `download`（`command`）确认，之后启动 `link-import` 流程。
 * - 没有安装（或版本过旧）：按 `external_tools_install`（`high`）确认，说明里写明来源、版本、大小与许可；用户同意即记下同意、
 *   提交安装任务，返回安装任务号。装好之后智能体再调用一次。
 * - 已安装但没有同意（或同意被撤回）：按 `external_tools_consent`（`high`）确认；同意之后直接启动流程，不再问第二次。
 *
 * 三个审批用不同的工具名：「本会话内都允许」按工具名记，允许过下载不等于允许过安装。严格离线、清单不全、用户指定的路径不能用时
 * 不弹确认，直接拒绝并说明补救。
 *
 * 落点三选一（都不给时只下载到下载目录）：
 *
 * - `video`：导入范围之内的一个已有视频（链接素材）；它的时间线还空着时同时放上主轨（对外服务先 `videos_create` 再下载进去）；
 * - `newVideo`：新建一个视频并放上时间线，与 `videos_create` 建在同一处（`project`，不给时会话所属的项目或会话的工作目录，
 *   终端里按 cwd 找到的项目），之后 `videos_list`、`videos_inspect` 看得到；新建视频不提高风险（`edit` 低于下载的 `command`）；
 * - `project`：只下载，文件放进这个项目。
 *
 * 有落点时文件放进归属项目的 `downloads/`（流程的 `saveTo: 'project'`）；归属是不属于项目的会话时仍进下载目录（会话的工作目录
 * 用户看不到）。不给落点时文件进下载目录（设置 `downloads.directory`，默认主机的下载文件夹），`transcribe` 为 true 时在旁边生成
 * TXT 与 SRT 文稿；之后可以用结果里媒体的 `artifactId` 经 `edits_apply` 的 `importAsset` 导入视频。
 *
 * 对外服务（MCP，§4.8、§12.8、§12.9）的落点只能是范围之内的 `video` 或已登记的 `project`：`newVideo` 要同时给 `project`（与
 * `videos_create` 相同），流程新建的视频一出现（父任务记下 `videoId`）就登记进服务的范围（`ToolScope.adoptCreatedVideo`，范围是
 * 全部视频时不变），之后 `videos_list`、`videos_inspect` 看得到；不给落点、或 `newVideo` 不给 `project` 以 `INVALID_ARGUMENTS`
 * 拒绝。yt-dlp 没有安装或用户没有同意使用时直接拒绝，不代为安装或同意（下载并执行第三方程序由用户在 BaoCut 里决定）。
 *
 * `transcribe` 给 `url` 时另带转写的参数（语言、服务与模型、提示、说话人）与 `captions`（转写之后建字幕层），原样交给流程；
 * `download` 不带它们，转写用默认值、不建字幕层。
 */

export interface LinkImportToolsDeps {
  tools: ExternalToolService;
  pipelines: PipelineRunner;
  /** 任务的变化：对外服务新建视频时等父任务记下 `videoId`，把它登记进服务的范围。 */
  jobs: Pick<JobManager, 'onChange' | 'inspect'>;
  offlineStrict: () => boolean;
  scope: ToolScope;
}

/** 一次从链接下载的请求（`download` 的参数，`transcribe` 给 `url` 时由它拼出）。 */
export interface LinkImportRequest {
  url: string;
  video?: string | undefined;
  newVideo?: boolean | undefined;
  project?: string | undefined;
  name?: string | undefined;
  audioOnly?: boolean | undefined;
  subtitleLanguages?: string[] | undefined;
  transcribe?: boolean | undefined;
  /** 转写的参数（`transcribe` 给 `url` 时）；`download` 不带。 */
  language?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  hint?: string | undefined;
  diarize?: boolean | undefined;
  /** 转写之后建字幕层（`transcribe` 给 `url` 且新建视频时）。 */
  captions?: boolean | undefined;
  commandId?: string | undefined;
}

// i18n-ignore-start: 给模型的工具说明、错误与下一步
const schemas = {
  download: z.strictObject({
    url: z.string().min(1).max(4000).describe('视频页面的链接（http 或 https）。只取单个视频，不取播放列表'),
    project: z
      .string()
      .min(1)
      .max(1000)
      .optional()
      .describe(
        '可选。项目（项目 id 或已登记项目目录的路径）：只给它时只下载，文件放进这个项目的 downloads/；与 newVideo 一起给时是新视频所在的项目。会话里只能是会话所属的项目',
      ),
    video: videoArg
      .optional()
      .describe(
        '可选。下载后导入到这个已有视频（videos_list 给出的 path 或 videoId），时间线还空着时同时放上主轨；文件放进它所属项目的 downloads/；与 project、newVideo 不能同时给',
      ),
    newVideo: z
      .boolean()
      .optional()
      .describe(
        '可选。新建一个视频：导入下载的媒体并放上时间线（主轨、从 0 开始、整段），与 videos_create 建在同一处；文件放进那个项目的 downloads/',
      ),
    name: z.string().min(1).max(200).optional().describe('可选。新视频的名字，默认取页面标题；只与 newVideo 一起给'),
    transcribe: z
      .boolean()
      .optional()
      .describe('可选。给了 video 或 newVideo 时导入之后转写那份素材；否则把下载的文件转写为 TXT 与 SRT 文稿，放在媒体旁边'),
    subs: z
      .array(z.string().regex(/^[A-Za-z0-9-]{1,20}$/))
      .max(10)
      .optional()
      .describe('可选。同时下载这些语言的字幕文件（例如 ["en","zh-Hans"]），放在媒体旁边、不导入视频；平台没有时跳过'),
    audioOnly: z.boolean().optional().describe('可选。只下载音频'),
    commandId: commandIdArg.optional().describe('可选。重试同一次提交时带上同一个值，不会重复创建任务'),
  }),
};

type Args = z.infer<(typeof schemas)['download']>;

const DEFINITIONS: Record<'download', ToolInfo> = {
  download: {
    title: '从链接下载',
    description: [
      '用 yt-dlp 从视频页面的链接下载媒体，可以导入视频或新建视频并转写。',
      '落点三选一：video 导入已有视频；newVideo 新建视频并放上时间线（可给 project、name）；project 只下载到项目。有落点时文件放进所属项目的 downloads/（不属于项目的会话仍进下载目录）；都不给时只下载到下载目录（设置 downloads.directory，默认系统的下载文件夹），只在用户明确说只要文件、不要视频时这样用。',
      '要转写、加字幕、翻译的默认给 newVideo（或直接用 transcribe 给 url）：它新建视频、导入、放上时间线，transcribe 为 true 时再转写；之后 videos_list、videos_inspect 看得到它。新建的视频在之后的步骤失败时保留，不要再新建一次。',
      '只在用户明确要从网页链接取视频时用。会按访问模式向用户确认；yt-dlp 没有安装时会请用户同意下载它（显示来源、版本、大小与许可），这次只提交安装并返回 installJobId：用 jobs_wait 等它 completed，再调用一次本工具。',
      '立即返回 jobId。用 jobs_wait 等它结束（看进度用 jobs_inspect，progress.unit 为 bytes），state 为 completed 时 outputs 里有下载的文件与文稿（path）和导入的素材（assetId）；只下载时媒体的 artifactId 可以给 edits_apply 的 importAsset（文件要还在原处、没有改过）。失败时 error.code 是 LINK_LOGIN_REQUIRED、LINK_UNSUPPORTED、LINK_NETWORK_ERROR、LINK_DISK_FULL 等，error.details.remedy 说明怎么补救；不要用别的方式绕过（不要自己运行下载程序）。',
      '对外服务的落点只能是范围之内的 video 或已登记的 project；newVideo 要同时给 project（新视频建在那个项目里，之后在服务的范围之内）。',
    ].join('\n'),
    annotations: { destructiveHint: false, idempotentHint: true },
    effect: 'job',
    examples: [
      { title: '从链接新建视频并转写', args: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', newVideo: true, transcribe: true } },
      { title: '下载到已有视频', args: { url: 'https://example.com/talk', video: 'demo' } },
      { title: '只下载到项目，带英文字幕', args: { url: 'https://example.com/talk', project: 'prj_1', subs: ['en'] } },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'url',
  },
};
// i18n-ignore-end

export class LinkImportTools implements ToolSet {
  readonly schemas = schemas;
  readonly definitions = DEFINITIONS;
  readonly #deps: LinkImportToolsDeps;

  constructor(deps: LinkImportToolsDeps) {
    this.#deps = deps;
  }

  dispatch(name: string, args: unknown, principal: ToolPrincipal): Promise<unknown> {
    // i18n-ignore: 给模型的工具说明、错误与下一步
    if (name !== 'download') return Promise.reject(new ToolError('UNKNOWN_TOOL', `没有这个工具：${name}`));
    const { subs, ...rest } = args as Args;
    return startLinkImport(this.#deps, { ...rest, subtitleLanguages: subs }, principal);
  }
}

/** 从链接下载：检查落点与工具的状态、按状态确认、启动 `link-import` 流程（见文件头）。`download` 与 `transcribe` 共用。 */
export function startLinkImport(deps: LinkImportToolsDeps, request: LinkImportRequest, principal: ToolPrincipal): Promise<unknown> {
  return start(deps, request, principal).catch((error: unknown) => {
    throw toolErrorOf(error);
  });
}

async function start(deps: LinkImportToolsDeps, args: LinkImportRequest, principal: ToolPrincipal) {
  const { tools, pipelines, scope } = deps;
  const access = scope.authorize(principal, true);
  // i18n-ignore-start: 给模型的工具说明、错误与下一步
  if (args.video !== undefined && (args.newVideo || args.project !== undefined)) {
    throw new ToolError('INVALID_ARGUMENTS', 'video 与 project、newVideo 只能给一个落点');
  }
  if (args.name !== undefined && !args.newVideo) throw new ToolError('INVALID_ARGUMENTS', 'name 只与 newVideo 一起给');
  const service = access.principal.kind === 'service';
  if (service && args.video === undefined && args.project === undefined) {
    throw new ToolError(
      'INVALID_ARGUMENTS',
      args.newVideo ? '对外服务新建视频要给 project：建在哪个已登记的项目里' : '对外服务的落点只能是范围之内的 video 或已登记的 project',
      {
        next: '给 project（projects_list 结果里的 projectId）：带 newVideo 时新视频建在那个项目里，不带时只下载到项目；或给 video（范围之内的视频）导入它。',
      },
    );
  }
  // i18n-ignore-end
  // 链接先在本地检查（协议、私有地址、以 - 开头），不合格的不弹确认。
  const link = checkLink(args.url);
  if (deps.offlineStrict()) {
    // i18n-ignore: 给模型的工具说明、错误与下一步
    throw new ToolError('OFFLINE_STRICT', '严格离线模式下不从链接下载：请用户在设置里关掉严格离线，或把文件放进来源目录后导入');
  }
  const status = await tools.status(YT_DLP);
  if (service && (status.state !== 'installed' || status.consent?.state !== 'granted')) {
    // i18n-ignore-start: 给模型的工具说明、错误与下一步
    throw new ToolError('TOOL_UNAVAILABLE', `${status.label} 还没有安装，或用户还没有同意用它从网站下载`, {
      tool: status.name,
      state: status.state,
      remedy: `请用户在 BaoCut 的外部工具设置里安装 ${status.label} 并同意使用它；对外服务不能代为安装或同意`,
    });
    // i18n-ignore-end
  }
  if (status.installJobId) {
    return { jobId: null, installJobId: status.installJobId, tool: toolView(status), next: installNext };
  }
  if (status.state === 'unavailable' || (status.state !== 'installed' && !status.installable)) {
    // i18n-ignore-start: 给模型的工具说明、错误与下一步
    throw new ToolError('TOOL_UNAVAILABLE', `${status.label} 现在不能用：${status.reason ?? '没有可用的版本'}`, {
      tool: status.name,
      state: status.state,
      remedy: status.remedy ?? '请用户在 BaoCut 的外部工具设置里安装或指定 yt-dlp 的路径',
    });
    // i18n-ignore-end
  }
  if (status.state !== 'installed') {
    const offer = status.offer;
    if (!offer || offer.blockedReason || !offer.url) {
      // i18n-ignore-start: 给模型的工具说明、错误与下一步
      throw new ToolError('TOOL_MANIFEST_INCOMPLETE', `不能下载 ${status.label}：${offer?.blockedReason ?? '这个平台没有可用的版本'}`, {
        tool: status.name,
        remedy: `请用户自己安装 ${status.label}，再在 BaoCut 的外部工具设置里指定路径`,
      });
      // i18n-ignore-end
    }
    const approval = await scope.confirm(access, {
      tool: 'external_tools_install',
      ...confirmSummary(
        RcAgentTools.installToolSummary({
          tool: status.label,
          version: offer.version,
          size: formatBytes(offer.sizeBytes ?? offer.estimatedBytes),
          estimated: offer.sizeBytes === null,
          license: offer.license,
          url: offer.url,
          host: link.host,
        }),
      ),
      risk: 'high',
    });
    const installed = await tools.install(
      {
        name: status.name,
        consent: true,
        via: 'agent-approval',
        ...(args.commandId ? { commandId: scope.commandId(access, `${args.commandId}-install`) } : {}),
      },
      access.submitter,
    );
    return { jobId: null, installJobId: installed.jobId, tool: toolView(installed.tool), ...approvalField(approval), next: installNext };
  }
  // 落点先解析（范围之外的不弹确认）。
  // 落点先只找位置（看不到的项目不弹确认）；新建视频的确认之后再取一次，无项目会话那时才建项目并绑定（§3.10）。
  let target = await targetOf(deps, args, access, { locate: true });
  const placed = args.video !== undefined || args.newVideo === true || args.project !== undefined;
  // 说清楚文件去哪、视频怎么变。
  const about = {
    tool: status.label,
    version: status.version ?? '',
    host: link.host,
    url: link.canonical,
    target: args.newVideo ? 'create' : args.video !== undefined ? 'video' : args.project !== undefined ? 'project' : 'download',
    name: args.name ?? null,
    transcribe: args.transcribe ?? false,
    language: args.language ?? null,
    provider: args.provider ?? null,
    model: args.model ?? null,
    captions: args.captions ?? false,
  };
  const approval =
    status.consent?.state === 'granted'
      ? await scope.confirm(access, {
          tool: 'download',
          ...confirmSummary(RcAgentTools.linkImportSummary(about)),
          // 新建视频（`edit`）不提高风险：仍按下载的 `command`。
          risk: 'command',
        })
      : await scope.confirm(access, {
          tool: 'external_tools_consent',
          ...confirmSummary(RcAgentTools.linkImportConsentSummary({ ...about, path: status.path ?? '' })),
          risk: 'high',
        });
  if (status.consent?.state !== 'granted') await tools.consent({ name: status.name, grant: true, via: 'agent-approval' });
  if (args.newVideo) target = await targetOf(deps, args, access);
  const { jobId } = await pipelines.start(
    {
      pipeline: LINK_IMPORT_PIPELINE,
      params: {
        url: args.url,
        ...target,
        ...(placed ? { saveTo: 'project' } : {}),
        ...(args.audioOnly !== undefined ? { audioOnly: args.audioOnly } : {}),
        ...(args.subtitleLanguages ? { subtitleLanguages: args.subtitleLanguages } : {}),
        ...(args.transcribe !== undefined ? { transcribe: args.transcribe } : {}),
        ...(args.language !== undefined ? { language: args.language } : {}),
        ...(args.provider !== undefined ? { provider: args.provider } : {}),
        ...(args.model !== undefined ? { model: args.model } : {}),
        ...(args.hint !== undefined ? { hint: args.hint } : {}),
        ...(args.diarize !== undefined ? { diarize: args.diarize } : {}),
        ...(args.captions !== undefined ? { captions: args.captions } : {}),
      },
      ...(args.commandId ? { commandId: scope.commandId(access, args.commandId) } : {}),
    },
    access.submitter,
  );
  // 对外服务新建的视频：父任务一记下 videoId 就登记进服务的范围（不等任务结束）。
  if (service && args.newVideo && scope.adoptCreatedVideo) {
    const adopt = scope.adoptCreatedVideo.bind(scope);
    adoptWhenCreated(deps.jobs, jobId, (videoId) => adopt(access, videoId));
  }
  // i18n-ignore-start: 给模型的工具说明、错误与下一步
  const where = placed ? '所属项目的 downloads/（不属于项目的会话是下载目录）' : '下载目录';
  return {
    jobId,
    installJobId: null,
    url: link.canonical,
    ...approvalField(approval),
    next: args.newVideo
      ? `下载已提交，完成后新建视频并放上时间线${args.transcribe ? `、转写${args.captions ? '、建立字幕层' : ''}` : ''}。用 jobs_wait 等它结束（看进度用 jobs_inspect）；state 为 completed 时 videoId 是新建的视频（可以直接给 videos_inspect），outputs[0].assetId 是导入的素材${
          args.transcribe
            ? args.captions
              ? '，pipeline.summary.documentId 是新转写（可以给 documents_read），summary.captions 是字幕层'
              : '，pipeline.summary.documentId 是新转写（文稿在视频的 speech 文档里，要字幕层时再 captions_create）'
            : ''
        }。新建的视频在之后的步骤失败时保留，不要再新建一次。`
      : args.video !== undefined
        ? `下载已提交。用 jobs_wait 等它结束（看进度用 jobs_inspect）；state 为 completed 时 outputs[0].path 是下载的文件（在${where}），outputs[0].assetId 是导入的素材。`
        : `下载已提交，文件保存到${where}，不导入视频。用 jobs_wait 等它结束（看进度用 jobs_inspect）；state 为 completed 时 outputs[0].path 是下载的媒体，要放进视频时把 outputs[0].artifactId 给 edits_apply 的 importAsset${args.transcribe ? '；其后 mediaType 为 text/plain 的是 TXT 文稿、application/x-subrip 的是 SRT 字幕（path 在媒体旁边，artifactId 可用于 artifacts_save）' : ''}。把文件位置告诉用户。`,
  };
  // i18n-ignore-end
}

/**
 * 流程参数里的落点：已有的视频（范围里的）、新建（与 `videos_create` 同一处），项目（只下载），或不给落点时调用方的来源
 * （会话的项目或会话、终端的项目；文件仍进下载目录）。
 */
async function targetOf(
  deps: LinkImportToolsDeps,
  args: LinkImportRequest,
  access: ToolAccess,
  options: { locate?: boolean } = {},
): Promise<{ videoId: Id } | { target: PipelineVideoTarget } | { projectId: Id } | { conversationId: Id }> {
  const { scope } = deps;
  if (args.video !== undefined) return { videoId: (await scope.open(args.video, access)).ref.videoId };
  // 新建的位置只在要用时才取：终端的范围取它时会登记项目（或建默认项目）；看不到的项目与不存在的一样回答。
  // 只下载（不新建视频）时只找位置：会话不因此绑定项目。
  const source = (await scope.createRoot(access, args.project, { locate: options.locate || !args.newVideo })).scope;
  if (args.newVideo) return { target: { create: { ...source, ...(args.name ? { name: args.name } : {}) } } };
  return source;
}

/** 等父任务记下 `videoId`（新建视频的那一步拿到租约时）再调用 `adopt`；任务先结束了就不再等。只调一次，失败不影响任务。 */
function adoptWhenCreated(jobs: LinkImportToolsDeps['jobs'], jobId: Id, adopt: (videoId: Id) => void | Promise<void>): void {
  let done = false;
  const check = (record: JobRecord) => {
    if (done || record.jobId !== jobId) return;
    if (record.videoId !== null) {
      done = true;
      stop();
      void Promise.resolve()
        .then(() => adopt(record.videoId!))
        .catch(() => {});
    } else if (isTerminal(record.state)) {
      done = true;
      stop();
    }
  };
  const stop = jobs.onChange(check);
  // 同一个命令重复提交时拿回的是已有的任务：它可能已经记下了。
  try {
    check(jobs.inspect(jobId));
  } catch {
    // 任务不在了：不再等。
    stop();
  }
}

// i18n-ignore-start: 给模型的工具说明、错误与下一步
const installNext =
  'yt-dlp 正在安装：用 jobs_wait 等 installJobId 对应的任务，state 为 completed 之后再调用一次 download；失败时 error.details.remedy 说明怎么补救。';
// i18n-ignore-end

function toolView(status: ExternalToolStatus) {
  return { name: status.name, state: status.state, version: status.version, source: status.source };
}

/**
 * 服务与流程的拒绝换成工具的错误：`details.code`（`TOOL_*`、`LINK_*`、`OFFLINE_STRICT`……）作为工具错误码。
 * 能力没有配置与授权、预算的拒绝留给工具目录按统一的格式说明补救（`errorBody` 补上 `remedy` 与 `next`）。
 */
export function toolErrorOf(error: unknown): unknown {
  if (error instanceof RpcError && typeof error.details === 'object' && error.details !== null) {
    if (isGrantErrorDetails(error.details)) return error;
    const { code, ...rest } = error.details as Record<string, unknown>;
    if (typeof code === 'string' && code !== 'CAPABILITY_NOT_CONFIGURED') return new ToolError(code, error.message, rest);
  }
  return error;
}
