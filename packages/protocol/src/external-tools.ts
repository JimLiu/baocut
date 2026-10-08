import type { Id } from './domain.ts';
import { localizeText, type MessageRef } from './message-ref.ts';
import type { LinkCookieBrowser } from './pipelines.ts';

/**
 * 受管外部工具（架构设计 §12.9）：BaoCut 用到、但不随应用发布的程序。登记表先只有下载工具 `yt-dlp`；ffmpeg 照旧从
 * `BAOCUT_FFMPEG` 或 PATH 找，只是它的探测结果也在同一个状态视图里。
 *
 * 规则：
 * - 下载工具不随应用打包，只在用户明确同意之后才安装或使用：同意按工具记录（何时、以何种方式），可以撤回；撤回后用它的
 *   流程一律拒绝执行。ffmpeg 不需要同意（它只处理本机文件）。
 * - BaoCut 自己下载的副本放在 Runtime Home 的 `tools/<工具>/<版本>/`，按清单核对 sha256 与大小之后才设可执行位、才执行。
 *   清单里摘要未知时拒绝安装（`TOOL_MANIFEST_INCOMPLETE`），不编造摘要。
 * - 探测只在本机执行 `<工具> --version`，不联网。
 * - 系统里自己装的那一份按原安装方式更新（Homebrew、pipx、pip、官方独立程序；Windows 上还有 winget、Scoop、Chocolatey）：
 *   探测时按可执行文件的真实位置判断办法，用户看过完整命令、确认之后才由 BaoCut 在本机执行（`externalTools.update`）；
 *   要管理员权限时只给命令，不提权。
 */

/** 工具此刻的状态：已安装（能运行、版本够）、未安装、需要更新（版本低于最低版本）、不可用（找到了但不能运行）。 */
export type ExternalToolState = 'installed' | 'missing' | 'outdated' | 'unavailable';

/** 此刻用的那一份从哪里来：系统 PATH 里的、用户指定的路径、BaoCut 下载的受管副本，或环境变量（`BAOCUT_FFMPEG`）指定的。 */
export type ExternalToolSource = 'system' | 'user' | 'managed' | 'env';

/** 同意的方式：桌面界面、CLI，或会话里用户批准了智能体的请求。 */
export type ExternalToolConsentVia = 'app' | 'cli' | 'agent-approval';

/** 用户对一个工具的同意：最近一次的决定。`revoked` 之后用它的流程拒绝执行，直到再次同意。 */
export interface ExternalToolConsent {
  state: 'granted' | 'revoked';
  /** 决定的时间（ISO 8601）。 */
  at: string;
  via: ExternalToolConsentVia;
}

/** 下载一个工具之前要告诉用户的事：来源、版本、大小与许可。 */
export interface ExternalToolOffer {
  version: string;
  /** 这台机器的平台要下载的文件；平台没有可用的文件时为 null。 */
  fileName: string | null;
  /** 下载地址（默认来源或镜像）；平台没有可用的文件时为 null。 */
  url: string | null;
  /** 清单里的字节数；未知时为 null。 */
  sizeBytes: number | null;
  /** 估计的字节数（大小未知时给人看）。 */
  estimatedBytes: number;
  /** 清单里的 sha256；未知时为 null（此时不能下载）。 */
  sha256: string | null;
  license: string;
  homepage: string;
  /** 不能下载的原因（清单不全、平台不支持）；能下载时为 null。 */
  blockedReason: string | null;
  blockedReasonRef?: MessageRef;
}

/**
 * 原安装方式：Homebrew、pipx、pip、官方独立程序自带的更新（`yt-dlp -U`），以及 Windows 上的 winget、Scoop、Chocolatey
 * （Chocolatey 要管理员权限，总是只给命令）。
 */
export type ExternalToolUpdateMethod = 'homebrew' | 'pipx' | 'pip' | 'standalone' | 'winget' | 'scoop' | 'chocolatey';

/**
 * 按原安装方式更新此刻用的那一份（`externalTools.update`）。探测时按可执行文件的真实位置判断，不联网；判断不了、
 * 或是 BaoCut 下载的受管副本（用 `externalTools.install` 换版本）时状态里为 null。
 */
export interface ExternalToolUpdatePlan {
  method: ExternalToolUpdateMethod;
  /** 要执行的程序与参数：不经 shell，原样传给程序。 */
  argv: string[];
  /**
   * 给人看、可以复制到 Runtime 主机终端的一行：Windows 按 PowerShell 的引号规则（第一个词带引号时前面加 `&`），
   * 其他系统按 POSIX shell。要管理员权限的独立程序在 POSIX 上前面带 `sudo`（BaoCut 不执行它）。
   */
  command: string;
  /** BaoCut 能不能代为执行。不能时（要管理员权限、找不到 brew、pipx、winget 或 Scoop，解释器不在了）只给命令，`reason` 说明原因。 */
  runnable: boolean;
  reason: string | null;
  reasonRef?: MessageRef;
}

/** `externalTools.list` 的一项。 */
export interface ExternalToolStatus {
  name: string;
  label: string;
  purpose: string;
  purposeRef?: MessageRef;
  state: ExternalToolState;
  /** `outdated`、`unavailable`、`missing` 的原因；已安装时为 null。 */
  reason: string | null;
  reasonRef?: MessageRef;
  /** 此刻会用的那一份的绝对路径（`missing` 时为 null）。 */
  path: string | null;
  version: string | null;
  source: ExternalToolSource | null;
  minVersion: string | null;
  /** BaoCut 能不能替用户下载这个工具（有清单）；能下载不代表此刻的清单完整，见 `offer.blockedReason`。 */
  installable: boolean;
  /** 下载的说明；不可下载的工具为 null。 */
  offer: ExternalToolOffer | null;
  /** 用它之前要不要先得到用户同意。 */
  consentRequired: boolean;
  /** 最近一次的同意或撤回；从没决定过时为 null。 */
  consent: ExternalToolConsent | null;
  /** 已经下载好的受管副本（与此刻用的不一定是同一份）。 */
  managed: { version: string; path: string; installedAt: string } | null;
  /** 用户用 `externalTools.setPath` 指定的路径。 */
  userPath: string | null;
  /** 正在进行的安装任务（`kind: 'toolInstall'`）。 */
  installJobId: Id | null;
  /** 按原安装方式更新的办法；判断不了、受管副本、没有找到时为 null。 */
  update: ExternalToolUpdatePlan | null;
  /** 正在进行的更新任务（`kind: 'toolUpdate'`）：输出在任务记录的 `command` 里。 */
  updateJobId: Id | null;
  /**
   * Runtime 所在主机的平台（`process.platform` 的取值：darwin、win32、linux…）。工具在那台主机上运行，界面判断不了安装方式时
   * 按它列常用命令。
   */
  platform: string;
  /** 不能用时的补救（给人看的一句话）。 */
  remedy: string | null;
  remedyRef?: MessageRef;
}

/** `externalTools.install` 的结果：提交的安装任务（进度经 `jobs` 主题），与提交时的工具状态。 */
export interface ExternalToolInstallResult {
  tool: ExternalToolStatus;
  jobId: Id;
}

/** `externalTools.update` 的结果：提交的更新任务（输出经 `jobs` 主题），与提交时的工具状态。 */
export interface ExternalToolUpdateResult {
  tool: ExternalToolStatus;
  jobId: Id;
}

/**
 * `externalTools.cookieBrowsers` 的一项：这台机器上找得到 Cookie 库的浏览器。只按下载工具自己的查找规则看文件在不在、
 * 什么时候改过，不读 Cookie 内容；最近用过的排在前面，下载视频按这个顺序逐个尝试。
 */
export interface CookieBrowserInfo {
  /** `cookieBrowsers` 的取值。 */
  id: LinkCookieBrowser;
  /** 给人看的名字。 */
  label: string;
  /** Cookie 库最近一次改动的时间（ISO 8601）；读不到（例如没有权限）时 null，排在最后。 */
  lastUsedAt: string | null;
}

/**
 * 外部工具状态里给人看的几句（用途、原因、补救、不能下载的原因、不能代为更新的原因）按读者当前的语言重新生成：Runtime 按它的
 * 语言写，可能与界面不同，或在切换语言之前读的。界面与 CLI 显示前过一遍。
 */
export function localizeToolStatus(status: ExternalToolStatus): ExternalToolStatus {
  return {
    ...status,
    purpose: localizeText(status.purpose, status.purposeRef),
    reason: localizeText(status.reason, status.reasonRef) ?? null,
    remedy: localizeText(status.remedy, status.remedyRef) ?? null,
    offer: status.offer ? { ...status.offer, blockedReason: localizeText(status.offer.blockedReason, status.offer.blockedReasonRef) ?? null } : null,
    update: status.update ? { ...status.update, reason: localizeText(status.update.reason, status.update.reasonRef) ?? null } : null,
  };
}
