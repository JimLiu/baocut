import {
  GRANT_DATA_KIND_LABELS,
  intlLocale,
  live,
  localizeText,
  MCP_SERVICE_TOOL_NAMES,
  type GrantRequestItem,
  type Id,
  type McpServiceTool,
  type PendingApproval,
  type ServiceApproval,
  type ServiceLevel,
  type ServicePolicy,
  type ServiceRequestRecord,
  type SpaceEntry,
} from '@baocut/protocol';
import { M } from './services-mcp-copy.ts';
import type { ServiceState } from './services.ts';

/**
 * MCP 服务页的纯模型（原型 designs/baocut/app/model-services.js 的 MCP 部分、model-mcp-tools.js；架构设计 §4.8、§12.8）：
 * 访问等级三档、开放范围的一句话、服务卡副行、工具目录与去向、最近请求的一行、服务审批的倒计时。
 */

/** 允许的操作三档（原型 `MCP_ACCESS`）；Runtime 的等级同名：`read` / `ask` / `auto`。 */
export const MCP_LEVELS: readonly { level: ServiceLevel; title: string; desc: string }[] = (['read', 'ask', 'auto'] as const).map((level) => ({
  level,
  get title() {
    return M.levels[level].title;
  },
  get desc() {
    return M.levels[level].desc;
  },
}));

export function levelTitle(level: ServiceLevel): string {
  return MCP_LEVELS.find((l) => l.level === level)?.title ?? level;
}

/** 范围里能选的视频：已登记项目里的视频（Space 的视频条目，不含回收站与不属于项目的）。服务的范围也只认这些（service-scope.ts）。 */
export interface ScopeVideo {
  videoId: Id;
  name: string;
}

export function scopeVideos(entries: readonly SpaceEntry[]): ScopeVideo[] {
  const seen = new Set<Id>();
  const out: ScopeVideo[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'video' || entry.user.trashedAt || !entry.source.projectId) continue;
    const ref = entry.ref;
    if (!ref || !('videoId' in ref) || seen.has(ref.videoId)) continue;
    seen.add(ref.videoId);
    out.push({ videoId: ref.videoId, name: entry.user.displayName ?? entry.name });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, intlLocale()));
}

/** 开放范围的一句话（原型 `mcpScope`）：「所有视频（N）」「「标题」」「其中 N 个视频」。 */
export function mcpScope(videos: ServicePolicy['videos'], total: number, nameOf: (id: Id) => string | undefined): string {
  if (videos === 'all') return M.scopeAll(total);
  const ids = videos.ids;
  if (ids.length === 0) return M.scopeNone;
  if (ids.length === 1) return M.scopeOne(nameOf(ids[0]!) ?? ids[0]!);
  return M.scopeSome(ids.length);
}

/**
 * 「只开放勾选的视频」菜单勾完之后的范围（原型 `mcpToggleProject`）：勾满了等于「所有视频」（以后新建的也算进去）；
 * 从「所有视频」点一个，就只剩那一个。取消到一个不剩时是空名单（范围里没有视频）——原型在这里回到「所有视频」，
 * 这里不悄悄放宽范围。
 */
export function pickedScope(picked: Iterable<Id>, all: readonly Id[]): ServicePolicy['videos'] {
  const ids = [...new Set(picked)].filter((id) => all.includes(id));
  if (all.length > 0 && all.every((x) => ids.includes(x))) return 'all';
  return { ids };
}

/** 服务卡副行（原型 `mcpSub`）：关着时说起了会开放什么；开着时说开放了哪些视频、什么权限。Runtime 总是要令牌。 */
export function mcpSub(state: ServiceState, scope: string, level: ServiceLevel): string {
  const access = M.access(levelTitle(level));
  if (state === 'on') return M.subOn(scope, access);
  if (state === 'starting' || state === 'stopping') return scope;
  return M.subOff(scope, access);
}

// ---- 工具目录 ----

export type McpToolGroup = 'read' | 'edit' | 'job' | 'generate';

export interface McpTool {
  name: string;
  title: string;
  group: McpToolGroup;
  /** `read` 任何等级都在目录里；`write` 只在 `ask` 与 `auto` 下出现。 */
  access: 'read' | 'write';
}

/** 工具分组（原型 model-mcp-tools.js `GROUPS`）。 */
export const MCP_TOOL_GROUPS: readonly { group: McpToolGroup; label: string; hint: string }[] = (['read', 'edit', 'job', 'generate'] as const).map(
  (group) => ({
    group,
    get label() {
      return M.groups[group].label;
    },
    get hint() {
      return M.groups[group].hint;
    },
  }),
);


/** 目录项的效果对应的分组：查询是读取，合成语音与出图是生成，其余后台任务（含取消任务）是任务，别的写入是编辑。 */
function toolGroup(tool: McpServiceTool): McpToolGroup {
  if (tool.effect === 'query') return 'read';
  if (tool.name === 'speak' || tool.name === 'image') return 'generate';
  if (tool.effect === 'job' || tool.name === 'jobs_cancel') return 'job';
  return 'edit';
}

/**
 * MCP 服务开放的工具：由协议常量 `MCP_SERVICE_TOOL_NAMES` 推出（Runtime 按工具目录的 surfaces 推出同一份，测试保证两边一致；
 * 架构设计 §4.8）。名字与参数是对外合同，改了要升 `MCP_INTERFACE_VERSION`。标题在 services-mcp-copy.ts，没有条目的新工具用协议里的标题。
 */
export const MCP_TOOLS: readonly McpTool[] = MCP_SERVICE_TOOL_NAMES.map((tool) => ({
  name: tool.name,
  get title() {
    return (M.tools as Partial<Record<string, string>>)[tool.name] ?? tool.title;
  },
  group: toolGroup(tool),
  access: tool.effect === 'query' ? 'read' : 'write',
}));

export function mcpToolTitle(name: string): string {
  return MCP_TOOLS.find((t) => t.name === name)?.title ?? name;
}

/** 工具的去向（原型 `gate`，没有逐个工具的开关所以没有 `off`）：直接应答 / 直接执行 / 调用前询问 / 只读权限下不提供。 */
export type McpToolGate = 'answer' | 'auto' | 'ask' | 'hidden';

export function toolGate(tool: McpTool, level: ServiceLevel): McpToolGate {
  if (tool.access === 'read') return 'answer';
  if (level === 'read') return 'hidden';
  return level === 'auto' ? 'auto' : 'ask';
}

export const GATE_LABEL: Readonly<Record<McpToolGate, string>> = live(() => M.gates);

/** 工具段标题旁的一句（原型 `summary`）：「提供 N / N 个工具 · M 个调用前询问」。 */
export function toolsSummary(level: ServiceLevel): string {
  const exposed = MCP_TOOLS.filter((t) => toolGate(t, level) !== 'hidden');
  const ask = exposed.filter((t) => toolGate(t, level) === 'ask').length;
  const writes = exposed.filter((t) => t.access === 'write').length;
  return M.toolsSummary(exposed.length, MCP_TOOLS.length, ask, writes);
}

// ---- 最近请求与审批 ----

/** 结果的说法：`ok` 是成功；其余是错误码，常见的几种说人话。 */
export function outcomeLabel(outcome: string): string {
  if (outcome === 'ok') return M.outcomes.ok;
  if (outcome === 'SERVICE_APPROVAL_DENIED') return M.outcomes.denied;
  if (outcome === 'VIDEO_NOT_FOUND') return M.outcomes.videoNotFound;
  if (outcome === 'UNKNOWN_TOOL') return M.outcomes.unknownTool;
  return outcome;
}

/** 最近请求的一行：工具（中文名）与目标视频；视频不在列表里时写 ID。 */
export function requestLine(record: ServiceRequestRecord, nameOf: (id: Id) => string | undefined): string {
  const tool = record.tool;
  if (!record.videoId) return tool;
  return M.requestLine(tool, nameOf(record.videoId) ?? record.videoId);
}

/** 审批还剩几秒（服务审批 50 秒时限）；过了就是 0。 */
export function approvalSecondsLeft(approval: Pick<ServiceApproval, 'expiresAt'>, now: number): number {
  const at = Date.parse(approval.expiresAt);
  if (Number.isNaN(at)) return 0;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

/** 只给某个服务的、还没过时限的审批，旧的在前。 */
export function liveApprovals(approvals: readonly ServiceApproval[], serviceId: ServiceApproval['serviceId'], now: number): ServiceApproval[] {
  return approvals.filter((a) => a.serviceId === serviceId && approvalSecondsLeft(a, now) > 0);
}

/** 所有服务里还没过时限的审批数（rail 角标）。 */
export function liveApprovalCount(approvals: readonly ServiceApproval[], now: number): number {
  return approvals.filter((a) => approvalSecondsLeft(a, now) > 0).length;
}

/**
 * 服务审批要外发、还没有授权覆盖的数据：`services` 主题的审批不带 `grants`，同一条审批在 `tasks` 主题的统一列表里
 * （`PendingApproval.grants`），按 `approvalId` 找。
 */
export function approvalGrants(pending: readonly PendingApproval[], approvalId: Id): GrantRequestItem[] {
  return pending.find((a) => a.approvalId === approvalId)?.grants ?? [];
}

/** 外发授权的一句：「要把音频发给 openai（转录）· 约 0.02 USD」。 */
export function grantLine(item: GrantRequestItem): string {
  const kinds = M.joinKinds(item.dataKinds.map((k) => GRANT_DATA_KIND_LABELS[k]));
  return M.grantLine(kinds, item.recipient, localizeText(item.purpose, item.purposeRef), item.estimate);
}
