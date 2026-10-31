import path from 'node:path';
import { z } from 'zod';
import { COOKIE_BROWSER_LABELS, LINK_IMPORT_PIPELINE, checkLink, isTerminal, type JobManager, type PipelineRunner } from '@baocut/jobs';
import {
  LINK_COOKIE_BROWSERS,
  RpcError,
  type ExternalToolStatus,
  type Id,
  type JobRecord,
  type LinkCookieBrowser,
  type PipelineVideoTarget,
} from '@baocut/protocol';
import { RcAgentTools } from '@baocut/protocol/messages/runtime-core';
import type { ExternalToolService } from '../external-tools/external-tool-service.ts';
import { YT_DLP } from '../external-tools/tool-manifests.ts';
import { isGrantErrorDetails } from '../grants/grant-errors.ts';
import { inside, nearestReal } from './artifact-save.ts';
import { formatBytes } from './model-install-tools.ts';
import { assumePaid, type PaidProbe } from './paid-calls.ts';
import { ToolError, type ToolInfo, type ToolSet } from './tool-catalog.ts';
import {
  approvalField,
  bindingConfirmation,
  confirmSummary,
  type ProjectBinding,
  type ToolAccess,
  type ToolPrincipal,
  type ToolScope,
} from './tool-scope.ts';
import { resolveUserPath } from './video-digest.ts';
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
 *   终端里按 cwd 找到的项目），之后 `videos_list`、`videos_inspect` 看得到；新建视频不提高风险（`edit` 低于下载的 `command`）。
 *   不属于项目的会话给了别处的 `project`（已登记项目的 id 或任意目录）时，同一张确认卡写明会话放进那个项目（`bindingConfirmation`，
 *   `high`），确认之后会话连同工作目录里的视频与文件放过去（§3.10），视频建在那里；
 * - `project`：只下载，文件放进这个项目。不属于项目的会话不为只下载换项目：给了别处的 `project` 时拒绝，`next` 指向 `outDir`。
 *
 * 文件去哪：与界面、CLI 一样默认进下载目录（设置 `downloads.directory`，默认主机的下载文件夹），`video`、`newVideo` 导入的是
 * 链到那里的素材；只给 `project` 时放进那个项目的 `downloads/`（流程的 `saveTo: 'project'`）。对外服务只能写进项目，它的落点
 * 一律放进归属项目的 `downloads/`。归属是不属于项目的会话时仍进下载目录（会话的工作目录用户看不到）。给了 `outDir` 时文件
 * 放进那个目录（按 `ToolScope.fileBase` 解析：会话是工作目录，终端是 cwd；流程在提交时建好、确认能写），`video`、`newVideo`
 * 导入的素材链到那里；只给 `project` 时文件本来就进项目，不能再给 `outDir`；对外服务不能给（本机路径）。不给落点时
 * `transcribe` 为 true 在媒体旁边生成 TXT 与 SRT 文稿；之后可以用结果里媒体的 `artifactId` 经 `edits_apply` 的 `importAsset`
 * 导入视频。
 *
 * 对外服务（MCP，§4.8、§12.8、§12.9）的落点只能是范围之内的 `video` 或已登记的 `project`：`newVideo` 要同时给 `project`（与
 * `videos_create` 相同），流程新建的视频一出现（父任务记下 `videoId`）就登记进服务的范围（`ToolScope.adoptCreatedVideo`，范围是
 * 全部视频时不变），之后 `videos_list`、`videos_inspect` 看得到；不给落点、或 `newVideo` 不给 `project` 以 `INVALID_ARGUMENTS`
 * 拒绝。yt-dlp 没有安装或用户没有同意使用时直接拒绝，不代为安装或同意（下载并执行第三方程序由用户在 BaoCut 里决定）。
 *
 * `transcribe` 给 `url` 时另带转写的参数（语言、服务与模型、提示、说话人）与 `captions`（转写之后建字幕层），原样交给流程；
 * `download` 不带它们，转写用默认值、不建字幕层。
 *
 * 网站登录（`cookieBrowsers`，§7.9）：调用时给了就按给的浏览器（按尝试的顺序；空列表是匿名）；不给时按设置 › 视频下载的网站登录
 * （`downloads.cookieBrowsers`，与下载视频工具、从链接转录同一项），在提交时按此刻检测到的浏览器展开。用到的浏览器写进确认的摘要，
 * 用户同意即允许 yt-dlp 读取它们的 Cookie；冻结进流程参数，`jobs_retry` 沿用原来的（之后改设置不影响它，要换浏览器得重新提交）。
 * 对外服务不能给、也不用这项设置，一律匿名：读取本机浏览器的登录信息由用户在 BaoCut 里决定，`auto` 等级的服务不逐次确认。
 */

export interface LinkImportToolsDeps {
  tools: ExternalToolService;
  pipelines: PipelineRunner;
  /** 任务的变化：对外服务新建视频时等父任务记下 `videoId`，把它登记进服务的范围。 */
  jobs: Pick<JobManager, 'onChange' | 'inspect'>;
  offlineStrict: () => boolean;
  /** 设置 › 视频下载的网站登录按此刻检测到的浏览器展开的列表（空的是匿名）；不给 `cookieBrowsers` 时用。 */
  settingCookieBrowsers: () => Promise<LinkCookieBrowser[]>;
  scope: ToolScope;
  /** 转写会不会交给在线 Provider（Bot 技术方案 §14.2）；不给时按付费处理。 */
  paid?: PaidProbe;
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
  /** 只下载原片的这几段（秒）；`download` 才有。 */
  sections?: Array<{ start: number; end: number }> | undefined;
  transcribe?: boolean | undefined;
  /** 转写的参数（`transcribe` 给 `url` 时）；`download` 不带。 */
  language?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  hint?: string | undefined;
  diarize?: boolean | undefined;
  /** 转写之后建字幕层（`transcribe` 给 `url` 且新建视频时）。 */
  captions?: boolean | undefined;
  /** 读取哪些浏览器的登录 Cookie（按尝试的顺序）；空的是匿名，不给时按设置 › 视频下载。 */
  cookieBrowsers?: LinkCookieBrowser[] | undefined;
  /** 文件放进这个目录（相对路径按 `ToolScope.fileBase` 解析）；不给时按落点进下载目录或项目的 `downloads/`。 */
  outDir?: string | undefined;
  commandId?: string | undefined;
}

// i18n-ignore-start: 给模型的工具说明、错误与下一步
/** `download` 与 `transcribe` 共用的 `cookieBrowsers` 参数。 */
export const cookieBrowsersArg = z
  .array(z.enum(LINK_COOKIE_BROWSERS))
  .max(LINK_COOKIE_BROWSERS.length)
  .refine((list) => new Set(list).size === list.length, { message: '浏览器不能重复' })
  .describe(
    `可选。网站登录：按顺序尝试读取这些浏览器的登录 Cookie（${LINK_COOKIE_BROWSERS.join('、')}），读不到或网站仍要求登录时换下一个；[] 是匿名下载。不给时按用户在设置 › 视频下载里选的网站登录（默认所有检测到的浏览器），一般不用给；只在用户这一次指定了浏览器或要求匿名时给。确认时会列出用到的浏览器。对外服务不能给，一律匿名`,
  );
// i18n-ignore-end

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
        '可选。项目（项目 id 或已登记项目目录的路径）：只给它时只下载，文件放进这个项目的 downloads/；与 newVideo 一起给时是新视频所在的项目。属于项目的会话只能是它所属的项目；不属于项目的会话与 newVideo 一起给时可以是已登记项目的 projectId 或任意文件夹（绝对路径或 ~/，例如外置盘上的 /Volumes/T7/访谈，不存在时新建并登记），确认之后会话连同工作目录里的视频与文件放进那里',
      ),
    video: videoArg
      .optional()
      .describe(
        '可选。下载后导入到这个已有视频（videos_list 给出的 path 或 videoId），时间线还空着时同时放上主轨；文件在下载目录（对外服务放进它所属项目的 downloads/）；与 project、newVideo 不能同时给',
      ),
    newVideo: z
      .boolean()
      .optional()
      .describe(
        '可选。新建一个视频：导入下载的媒体并放上时间线（主轨、从 0 开始、整段），与 videos_create 建在同一处；文件在下载目录（对外服务放进那个项目的 downloads/）',
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
    sections: z
      .array(z.strictObject({ start: z.number().min(0), end: z.number().positive() }).refine((s) => s.start < s.end, { message: 'start 要小于 end' }))
      .min(1)
      .max(20)
      .optional()
      .describe(
        '可选。只下载原片的这几段（秒，例如 [{"start":754,"end":781.5}]；命令行可写 754:781.5）：每段单独下载、存成一个文件、作为独立素材导入（来源 section 记原片区间），newVideo 时按顺序首尾相接放上时间线；切点重新编码出关键帧。end 不能超过视频时长。长视频只要几句时用它，不必整条下载。不能与 transcribe、subs 同时给',
      ),
    outDir: z
      .string()
      .min(1)
      .max(4000)
      .optional()
      .describe(
        '可选。文件保存到这个目录（任意位置，例如外置盘上的文件夹；不存在时创建），代替下载目录；相对路径按工作目录（终端里是当前目录），~/ 是主目录。可以与 video、newVideo 一起给（导入的素材链到这里）；只给 project 时文件进项目，不能再给。对外服务不能给',
      ),
    cookieBrowsers: cookieBrowsersArg.optional(),
    commandId: commandIdArg.optional().describe('可选。重试同一次提交时带上同一个值，不会重复创建任务'),
  }),
};

type Args = z.infer<(typeof schemas)['download']>;

const DEFINITIONS: Record<'download', ToolInfo> = {
  download: {
    title: '从链接下载',
    description: [
      '用 yt-dlp 从视频页面的链接下载媒体，可以导入视频或新建视频并转写。',
      '落点三选一：video 导入已有视频；newVideo 新建视频并放上时间线（可给 project、name）；project 只下载到项目的 downloads/。文件默认存进下载目录（设置 downloads.directory，默认系统的下载文件夹），video、newVideo 导入的素材链到那里；用户要放到别处（外置盘、某个文件夹）时给 outDir，不用请用户去改设置；都不给时只下载、不建视频，只在用户明确说只要文件、不要视频时这样用。',
      '不属于项目的会话要把新视频建在指定的文件夹或别的项目里（例如「下载到外置盘 T7 的访谈文件夹」）：newVideo 同时给 project（文件夹的绝对路径，或 projects_list 的 projectId），按高风险确认，确认之后会话连同工作目录里的视频与文件放进那里，不用请用户换项目、新开会话；用户只说了盘没说文件夹时在盘上取一个文件夹。文件也要放在那里时同时给 outDir（例如 <文件夹>/downloads）。会话只能放进项目一次，属于项目的会话不能换。',
      '要转写、加字幕、翻译的默认给 newVideo（或直接用 transcribe 给 url）：它新建视频、导入、放上时间线，transcribe 为 true 时再转写；之后 videos_list、videos_inspect 看得到它。新建的视频在之后的步骤失败时保留，不要再新建一次。',
      '只在用户明确要从网页链接取视频时用。会按访问模式向用户确认；yt-dlp 没有安装时会请用户同意下载它（显示来源、版本、大小与许可），这次只提交安装并返回 installJobId：用 jobs_wait 等它 completed，再调用一次本工具。',
      '长视频（播客、直播回放、发布会）只要其中几句时给 sections（秒）只下这几段，每段是独立的文件与素材；不知道在哪几秒时先看平台字幕或简介里的章节，再下。',
      '立即返回 jobId。用 jobs_wait 等它结束（看进度用 jobs_inspect，progress.unit 为 bytes），state 为 completed 时 outputs 里有下载的文件与文稿（path）和导入的素材（assetId）；只下载时媒体的 artifactId 可以给 edits_apply 的 importAsset（文件要还在原处、没有改过）。失败时 error.code 是 LINK_LOGIN_REQUIRED、LINK_UNSUPPORTED、LINK_NETWORK_ERROR、LINK_DISK_FULL 等，error.details.remedy 说明怎么补救；不要用别的方式绕过（不要自己运行下载程序）。',
      '网站登录：不给 cookieBrowsers 时按设置 › 视频下载里选的浏览器（默认所有检测到的），提交时冻结。要登录才能看的视频（LINK_LOGIN_REQUIRED）：请用户先在浏览器里登录这个网站，再到设置 › 视频下载确认勾选了那个浏览器（用 error.details.settingsHref 写成 Markdown 设置链接），弄好后重新提交；用户说了用哪个浏览器时也可以用 cookieBrowsers 给上它重新提交。jobs_retry 沿用原来的浏览器，改了设置也不变。',
      '对外服务的落点只能是范围之内的 video 或已登记的 project；newVideo 要同时给 project（新视频建在那个项目里，之后在服务的范围之内）；文件一律放进所属项目的 downloads/。',
    ].join('\n'),
    annotations: { destructiveHint: false, idempotentHint: true },
    effect: 'job',
    examples: [
      { title: '从链接新建视频并转写', args: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', newVideo: true, transcribe: true } },
      { title: '下载到已有视频，文件存到外置盘的文件夹', args: { url: 'https://example.com/talk', video: 'demo', outDir: '/Volumes/Media/clips' } },
      { title: '只下载长视频里的两段，导入已有视频', args: { url: 'https://example.com/podcast', video: 'demo', sections: [{ start: 754, end: 781.5 }, { start: 2410, end: 2433 }] } },
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
  if (args.sections && (args.transcribe || args.subtitleLanguages?.length)) {
    throw new ToolError('INVALID_ARGUMENTS', 'sections 不能与 transcribe、subs 同时给：每段是独立的素材，字幕是整条的', {
      next: '先只用 sections 下载，完成后对需要的那段素材用 transcribe 转写。',
    });
  }
  if (args.outDir !== undefined && args.project !== undefined && !args.newVideo) {
    throw new ToolError('INVALID_ARGUMENTS', '只给 project 时文件进项目的 downloads/：与 outDir 只能给一个', {
      next: '要放进别的目录就去掉 project，只给 outDir。',
    });
  }
  const service = access.principal.kind === 'service';
  if (service && args.cookieBrowsers?.length) {
    throw new ToolError('INVALID_ARGUMENTS', '对外服务不能读取本机浏览器的登录信息（cookieBrowsers）', {
      next: '去掉 cookieBrowsers 匿名下载；视频要登录才能看时，请用户在 BaoCut 里用下载视频工具下载。',
    });
  }
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
  // 本机目录：对外服务在这里以 INVALID_ARGUMENTS 拒绝（`fileBase`）；能不能写由流程在提交时检查。
  let outDir = args.outDir !== undefined ? resolveUserPath(args.outDir, scope.fileBase(access)) : undefined;
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
  // 落点先只找位置（范围之外、看不到的项目不弹确认）；新建视频的确认之后再取一次（终端那时才登记项目，无项目会话那时放进项目）。
  const located = await targetOf(deps, args, access, { locate: true });
  let target = located.params;
  const { binding } = located;
  if (binding && !args.newVideo) {
    // i18n-ignore-start: 给模型的工具说明、错误与下一步
    throw new ToolError('PROJECT_NOT_FOUND', `这个会话不属于项目：只下载时 project 只能是会话所属的项目，不能是 ${binding.path}`, {
      next: '只要文件时去掉 project，用 download 的 outDir 放到任意文件夹（例如外置盘上的）；要在那里新建视频时带上 newVideo（transcribe 去掉 noVideo），确认之后会话放进那个项目。',
    });
    // i18n-ignore-end
  }
  // 会话要放进别的项目：工作目录里的 `outDir` 跟着搬过去，确认卡上写搬过去之后的位置。
  if (binding && outDir !== undefined) {
    const cwd = scope.fileBase(access);
    if (inside(outDir, cwd)) outDir = path.join(binding.path, path.relative(cwd, outDir));
  }
  const placed = args.video !== undefined || args.newVideo === true || args.project !== undefined;
  // 文件进项目的 downloads/：对外服务只能写进项目（§12.8），有落点就进；智能体只在只给 project（只下载到项目）时进，
  // 导入视频的与界面、CLI 一样留在下载目录。
  const intoProject = outDir === undefined && (service ? placed : args.project !== undefined && !args.newVideo);
  // 网站登录：给了用给的；不给时按设置展开（此刻检测到的浏览器）；对外服务一律匿名。空列表不进流程参数（匿名）。
  const browsers = service ? [] : (args.cookieBrowsers ?? (await deps.settingCookieBrowsers()));
  const cookieBrowsers = browsers.length ? browsers : undefined;
  // 说清楚文件去哪、视频怎么变。
  const about = {
    tool: status.label,
    version: status.version ?? '',
    host: link.host,
    url: link.canonical,
    target: args.newVideo ? 'create' : args.video !== undefined ? 'video' : args.project !== undefined ? 'project' : outDir !== undefined ? 'folder' : 'download',
    name: args.name ?? null,
    transcribe: args.transcribe ?? false,
    language: args.language ?? null,
    provider: args.provider ?? null,
    model: args.model ?? null,
    captions: args.captions ?? false,
    cookies: cookieBrowsers ? cookieBrowsers.map((id) => COOKIE_BROWSER_LABELS[id]).join(RcAgentTools.listSeparator().text) : null,
    dir: outDir ?? null,
  };
  // 只有转写可能花钱（§14.2）；下载本身用本机的 yt-dlp。
  const paid = args.transcribe
    ? await (deps.paid ?? assumePaid)([{ capability: 'transcribe', provider: args.provider, model: args.model }])
    : false;
  // 会话要放进别的项目时同一张卡写明落点，按 `high`（`bindingConfirmation`）。
  const approval = await scope.confirm(
    access,
    bindingConfirmation(
      status.consent?.state === 'granted'
        ? {
            tool: 'download',
            paid,
            ...confirmSummary(RcAgentTools.linkImportSummary(about)),
            // 新建视频（`edit`）不提高风险：仍按下载的 `command`。
            risk: 'command',
          }
        : {
            tool: 'external_tools_consent',
            paid,
            ...confirmSummary(RcAgentTools.linkImportConsentSummary({ ...about, path: status.path ?? '' })),
            risk: 'high',
          },
      located,
    ),
  );
  if (status.consent?.state !== 'granted') await tools.consent({ name: status.name, grant: true, via: 'agent-approval' });
  if (args.newVideo) target = (await targetOf(deps, args, access)).params;
  // 会话刚放进项目：工作目录搬走了，旧路径只在这个回合里经链接指向项目。下载在回合之后还在写，`outDir` 用真实路径。
  if (binding && outDir !== undefined) outDir = await nearestReal(outDir);
  const { jobId } = await pipelines.start(
    {
      pipeline: LINK_IMPORT_PIPELINE,
      params: {
        url: args.url,
        ...target,
        ...(intoProject ? { saveTo: 'project' } : {}),
        ...(outDir !== undefined ? { outDir } : {}),
        ...(args.audioOnly !== undefined ? { audioOnly: args.audioOnly } : {}),
        ...(args.subtitleLanguages ? { subtitleLanguages: args.subtitleLanguages } : {}),
        ...(args.sections ? { sections: args.sections } : {}),
        ...(args.transcribe !== undefined ? { transcribe: args.transcribe } : {}),
        ...(args.language !== undefined ? { language: args.language } : {}),
        ...(args.provider !== undefined ? { provider: args.provider } : {}),
        ...(args.model !== undefined ? { model: args.model } : {}),
        ...(args.hint !== undefined ? { hint: args.hint } : {}),
        ...(args.diarize !== undefined ? { diarize: args.diarize } : {}),
        ...(args.captions !== undefined ? { captions: args.captions } : {}),
        ...(cookieBrowsers ? { cookieBrowsers } : {}),
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
  const where = outDir !== undefined ? outDir : intoProject ? '所属项目的 downloads/（不属于项目的会话是下载目录）' : '下载目录';
  const moved = binding
    ? `会话已经放进项目（${binding.path}），工作目录里原有的视频与文件一起搬了过去，之后新视频不给 project 就建在那里。`
    : '';
  const perSection = args.sections
    ? `分段下载：outputs 按 sections 的顺序每段一条（各有 path、artifactId${args.video !== undefined || args.newVideo ? '、assetId' : ''}），pipeline.summary.sections 列出每段的原片区间与文件。`
    : '';
  return {
    jobId,
    installJobId: null,
    url: link.canonical,
    ...approvalField(approval),
    next: perSection + (args.newVideo
      ? `${moved}下载已提交${outDir !== undefined ? `，文件保存到 ${outDir}` : ''}，完成后新建视频并放上时间线${args.transcribe ? `、转写${args.captions ? '、建立字幕层' : ''}` : ''}。用 jobs_wait 等它结束（看进度用 jobs_inspect）；state 为 completed 时 videoId 是新建的视频（可以直接给 videos_inspect），outputs[0].assetId 是导入的素材${
          args.transcribe
            ? args.captions
              ? '，pipeline.summary.documentId 是新转写（可以给 documents_read），summary.captions 是字幕层'
              : '，pipeline.summary.documentId 是新转写（文稿在视频的 speech 文档里，要字幕层时再 captions_create）'
            : ''
        }。新建的视频在之后的步骤失败时保留，不要再新建一次。`
      : args.video !== undefined
        ? `下载已提交。用 jobs_wait 等它结束（看进度用 jobs_inspect）；state 为 completed 时 outputs[0].path 是下载的文件（在${where}），outputs[0].assetId 是导入的素材。`
        : `下载已提交，文件保存到${where}，不导入视频。用 jobs_wait 等它结束（看进度用 jobs_inspect）；state 为 completed 时 outputs[0].path 是下载的媒体，要放进视频时把 outputs[0].artifactId 给 edits_apply 的 importAsset${args.transcribe ? '；其后 mediaType 为 text/plain 的是 TXT 文稿、application/x-subrip 的是 SRT 字幕（path 在媒体旁边，artifactId 可用于 artifacts_save）' : ''}。把文件位置告诉用户。`),
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
): Promise<{
  params: { videoId: Id } | { target: PipelineVideoTarget } | { projectId: Id } | { conversationId: Id };
  binding?: ProjectBinding;
}> {
  const { scope } = deps;
  if (args.video !== undefined) return { params: { videoId: (await scope.open(args.video, access)).ref.videoId } };
  // 新建的位置只在要用时才取：终端的范围取它时会登记项目（或建默认项目），无项目会话取它时放进给的项目；看不到的项目与不存在的
  // 一样回答。只下载（不新建视频）时只找位置。
  const root = await scope.createRoot(access, args.project, { locate: options.locate || !args.newVideo });
  const binding = root.binding ? { binding: root.binding } : {};
  if (args.newVideo) return { params: { target: { create: { ...root.scope, ...(args.name ? { name: args.name } : {}) } } }, ...binding };
  return { params: root.scope, ...binding };
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
