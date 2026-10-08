import type { ServiceLevel } from '@baocut/protocol';
import type { ToolInfo } from '../agent-tools/tool-catalog.ts';

/**
 * MCP 服务开放的工具（架构设计 §4.8）：工具目录里 `surfaces` 含 `mcp` 的那些，不另外维护一张表。工具名与参数是对外合同：
 * 改名或改参数是破坏性变更，要升 `MCP_INTERFACE_VERSION`，并同步协议常量 `MCP_SERVICE_TOOL_NAMES`（测试断言两者一致）。
 * 实现与工具桥共用，只是主体与范围不同（`ServiceScope`）。
 *
 * - `read` 等级只露 `annotations.readOnlyHint` 的工具；`ask` 与 `auto` 露出全部 `mcp` 面的工具。看不到的工具不出现在目录里，
 *   调用时与不存在的一样回答 `UNKNOWN_TOOL`。
 * - 不开放：`surfaces` 没有 `mcp` 的（任务合同、外发授权申请、交到下载目录、删除视频、本地模型包、把产物写成文件），
 *   以及目录之外的一切（设置、凭据、服务管理、任意文件与命令）。
 */
export function serviceToolExposed(info: ToolInfo, level: ServiceLevel): boolean {
  if (!info.surfaces.includes('mcp')) return false;
  return level !== 'read' || info.annotations?.readOnlyHint === true;
}

/** 对外的说明：不提会话与工作目录，不提这里没有的工具。 */
export function describeServiceTool(name: string, info: ToolInfo): ToolInfo {
  // i18n-ignore-start: 对外 MCP 工具的说明给外部智能体（模型）看
  switch (name) {
    case 'videos_list':
      return {
        ...info,
        description:
          '列出这个服务能访问的视频。BaoCut 里已登记项目中的视频，各带 videoId、名字、所属项目（projectId）与 path。之后用 videoId 指明视频。',
      };
    case 'videos_create':
      return {
        ...info,
        description: [
          '在 BaoCut 已登记的一个项目里新建一个空视频（一条视觉轨、一条音频轨）。',
          'project 必须给：项目 id（videos_list 的 projectId）。新建的视频加进这个服务能访问的视频；返回与 videos_inspect 相同的摘要。',
        ].join('\n'),
      };
    case 'jobs_inspect':
      return { ...info, description: info.description.replace(/可以看你在这个会话里提交的任务.*$/s, '只能看你（这个客户端）提交的任务。') };
    case 'jobs_cancel':
      return {
        ...info,
        description: '取消你（这个客户端）提交的一个任务。排队中的立即取消；运行中的等 Provider 停下。返回最终状态。',
      };
    case 'edits_apply':
      return {
        ...info,
        description: info.description.replace(
          '素材文件（相对工作目录或绝对路径）',
          '素材文件（相对视频所在的项目目录；只能是项目目录里的文件）',
        ),
      };
    case 'assets_import':
      return { ...info, description: `${info.description}\npath 相对视频所在的项目目录，只能是项目目录里的文件。` };
    case 'compositions_import':
      return { ...info, description: `${info.description}\npath 相对视频所在的项目目录，只能是项目目录里的目录。` };
    case 'compositions_preview':
      return {
        ...info,
        description: `${info.description.replace('写文件目录（会话与终端是工作目录）下的', '视频所属项目的 exports/ 下的')}\npath 相对视频所在的项目目录，只能是项目目录里的目录。`,
      };
    case 'videos_frames':
      return {
        ...info,
        description: info.description.replace(
          '写文件目录（会话与终端是工作目录，对外服务是项目的 exports）下的',
          '视频所属项目的 exports/ 下的',
        ),
      };
    case 'export':
      return {
        ...info,
        description: `${info.description}\n文件写到视频所属项目的 exports/ 里（dir 只能是其中已有的子目录）；jobs_inspect 的 outputs 给出每个文件的 path。`,
      };
    case 'speak':
    case 'image':
      return { ...info, description: info.description.replace('；需要文件本身时用 artifacts_save 复制到工作目录', '') };
    case 'download':
      return {
        ...info,
        description: [
          '用 yt-dlp 从视频页面的链接下载媒体，导入这个服务能访问的一个视频。',
          '必须给 video（videos_list 的 videoId；要新视频先用 videos_create）：下载的媒体导入为那个视频的素材，transcribe 为 true 时再提交转写。只取单个视频，不取播放列表。',
          'yt-dlp 要用户已经在 BaoCut 里安装并同意使用，否则以 TOOL_UNAVAILABLE 拒绝（remedy 说明请用户做什么）。会按访问等级请用户确认。',
          '立即返回 jobId：用 jobs_wait 等它结束（看进度用 jobs_inspect，progress.unit 为 bytes），state 为 completed 时 outputs[0].assetId 是导入的素材。失败时 error.code 是 LINK_LOGIN_REQUIRED、LINK_UNSUPPORTED、LINK_NETWORK_ERROR、LINK_DISK_FULL 等，error.details.remedy 说明怎么补救。',
        ].join('\n'),
      };
    default:
      return info;
  }
  // i18n-ignore-end
}
