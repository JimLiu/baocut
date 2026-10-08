/*
 * 部分机制移植自 paseo（Apache-2.0，Copyright (c) 2025-present Mohamed Boudra），modified：
 * packages/server/src/server/agent/providers/acp-agent.ts 的 mergeToolSnapshot / coalesceDefined（工具调用的增量合并）、
 * mapToolStatus、extractToolText / contentBlockToText、buildShellCommand、mapPermissionRequest / selectPermissionOption
 * （审批选项）、deriveModesFromACP / deriveModelDefinitionsFromACP / findSelectConfigOption / flattenSelectOptions
 * （模式与模型表）、normalizeMcpServers（只留 Streamable HTTP）、mapPlanToTimeline。
 * 改成 BaoCut 的 AgentItem / ApprovalRequest / DriverModel，审批种类、「本会话放行」的分类键与 `diff` 内容块转 unified diff 是新加的。
 */
import type { ApprovalRequest, DriverModel, ToolCallKind, ToolCallStatus } from '@baocut/protocol';
import type { AgentItem, McpServerSpec } from '@baocut/harness';
import type {
  ContentBlock,
  McpServer,
  PermissionOption,
  Plan,
  SessionConfigOption,
  SessionConfigSelectOption,
  SessionModeState,
  ToolCall,
  ToolCallContent,
  ToolCallLocation,
  ToolCallUpdate,
  ToolKind,
  ToolCallStatus as AcpToolStatus,
} from '@agentclientprotocol/sdk';
import { commandRule } from '../approval-rule.ts';
import { diffPath, textDiff } from '../unified-diff.ts';

/** 一次工具调用到目前为止的样子：`tool_call` 与之后的 `tool_call_update` 合并。 */
export interface ToolSnapshot {
  toolCallId: string;
  title: string;
  kind: ToolKind | null;
  status: AcpToolStatus | null;
  content: ToolCallContent[] | null;
  locations: ToolCallLocation[] | null;
  rawInput: unknown;
  rawOutput: unknown;
}

export function mergeToolSnapshot(toolCallId: string, update: ToolCall | ToolCallUpdate, previous?: ToolSnapshot): ToolSnapshot {
  return {
    toolCallId,
    title: update.title ?? previous?.title ?? toolCallId,
    kind: update.kind ?? previous?.kind ?? null,
    status: update.status ?? previous?.status ?? null,
    content: update.content !== undefined ? (update.content ?? null) : (previous?.content ?? null),
    locations: update.locations !== undefined ? (update.locations ?? null) : (previous?.locations ?? null),
    rawInput: update.rawInput !== undefined ? update.rawInput : previous?.rawInput,
    rawOutput: update.rawOutput !== undefined ? update.rawOutput : previous?.rawOutput,
  };
}

export function mapToolStatus(status: AcpToolStatus | null | undefined): ToolCallStatus {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    default:
      return 'running';
  }
}

/** ACP 的工具种类 → BaoCut 的步骤种类。读、搜、想之类没有专门的图标，算 `other`。 */
export function toolCallKind(kind: ToolKind | null): ToolCallKind {
  switch (kind) {
    case 'execute':
      return 'command';
    case 'edit':
    case 'delete':
    case 'move':
      return 'file-change';
    case 'fetch':
      return 'web-search';
    default:
      return 'other';
  }
}

/**
 * 时间线上的一步。`status` 给了就用它（回合结束时还没终态的记成 `interrupted`，被拒的记成 `declined`）。
 * 改文件的步骤成功时 `output` 是 unified diff（架构设计 §3.1）：由 ACP 的 `diff` 内容块（`oldText` → `newText`）生成，
 * 文件头的路径相对 `cwd`；没有 `diff` 块时退回文字内容。
 */
export function toolItem(
  snapshot: ToolSnapshot,
  status?: ToolCallStatus,
  cwd: string | null = null,
): Extract<AgentItem, { kind: 'tool-call' }> {
  const raw = record(snapshot.rawInput);
  const out = record(snapshot.rawOutput);
  const command = snapshot.kind === 'execute' ? shellCommand(snapshot) : null;
  const exit = out?.exitCode ?? out?.exit_code;
  const tool = toolCallKind(snapshot.kind);
  const finalStatus = status ?? mapToolStatus(snapshot.status);
  const diff = tool === 'file-change' && finalStatus === 'completed' ? toolDiff(snapshot.content, cwd) : null;
  return {
    kind: 'tool-call',
    id: snapshot.toolCallId,
    tool,
    title: snapshot.title,
    detail: command ?? snapshot.locations?.[0]?.path ?? readString(raw, ['path', 'file_path', 'url', 'query']) ?? null,
    output: diff ?? toolText(snapshot.content) ?? (typeof snapshot.rawOutput === 'string' ? snapshot.rawOutput : null),
    status: finalStatus,
    exitCode: typeof exit === 'number' ? exit : null,
    durationMs: null,
  };
}

/** 计划（`plan`）写成一段清单文字，作为一条智能体消息显示。 */
export function planText(plan: Plan): string {
  return plan.entries.map((entry) => `${entry.status === 'completed' ? '- [x]' : '- [ ]'} ${entry.content}`).join('\n');
}

export function contentText(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
      return block.text;
    case 'resource_link':
      return block.uri;
    case 'resource':
      return 'text' in block.resource ? block.resource.text : '';
    default:
      return '';
  }
}

/** 内容里的 `diff` 块，每个文件一段 unified diff，连起来。没有（或都没有变化）时为 null。 */
function toolDiff(content: ToolCallContent[] | null, cwd: string | null): string | null {
  const parts: string[] = [];
  for (const item of content ?? []) {
    if (item.type !== 'diff') continue;
    const diff = textDiff(diffPath(item.path, cwd), item.oldText ?? null, item.newText);
    if (diff) parts.push(diff);
  }
  return parts.length > 0 ? parts.join('\n') : null;
}

function toolText(content: ToolCallContent[] | null): string | null {
  if (!content) return null;
  const parts: string[] = [];
  for (const item of content) {
    if (item.type === 'content') {
      const text = contentText(item.content);
      if (text) parts.push(text);
    }
  }
  return parts.length > 0 ? parts.join('\n') : null;
}

function shellCommand(snapshot: ToolSnapshot): string | null {
  const raw = record(snapshot.rawInput);
  const command = raw?.command;
  if (Array.isArray(command)) {
    const parts = command.filter((p): p is string => typeof p === 'string');
    if (parts.length > 0) return parts.join(' ');
  }
  if (typeof command === 'string' && command) {
    const args = Array.isArray(raw?.args) ? (raw.args as unknown[]).filter((a): a is string => typeof a === 'string') : [];
    return args.length > 0 ? `${command} ${args.join(' ')}` : command;
  }
  return null;
}

/**
 * 一次 `session/request_permission` → BaoCut 的审批内容，加上「本会话放行」用的分类键：
 * 命令按 `commandRule`（`bcut <子命令>` 或第一个词），文件修改一类，别的工具按种类或标题。
 */
export function approvalOf(snapshot: ToolSnapshot, cwd: string): { request: ApprovalRequest; grantKey: string } {
  const raw = record(snapshot.rawInput);
  const files = [
    ...(snapshot.locations ?? []).map((l) => l.path),
    ...['path', 'file_path', 'filePath'].map((k) => raw?.[k]).filter((v): v is string => typeof v === 'string'),
  ].filter((v, i, all) => all.indexOf(v) === i);
  switch (snapshot.kind) {
    case 'execute': {
      const command = shellCommand(snapshot) ?? snapshot.title;
      const rule = commandRule(command);
      return {
        request: { kind: 'command', command, cwd: readString(raw, ['cwd', 'dir_path', 'directory']) ?? cwd, reason: null, rule },
        grantKey: `command:${rule ?? command}`,
      };
    }
    case 'edit':
    case 'delete':
    case 'move':
      // 文件修改按访问模式放行，不存规则。
      return { request: { kind: 'file-change', reason: snapshot.title, files, rule: null }, grantKey: 'file-change' };
    default: {
      const title = snapshot.title || snapshot.kind || 'tool';
      // 读、搜、取网页这几类的标题常带参数（「Fetching https://…」），规则按种类记才稳定；别的（MCP 工具）标题就是工具名。
      const rule = snapshot.kind && STABLE_KINDS.has(snapshot.kind) ? snapshot.kind : title;
      const mcp = mcpToolOf(title);
      return {
        request: { kind: 'tool', tool: mcp?.tool ?? title, reason: summarizeInput(raw), files, server: mcp?.server ?? null, rule },
        grantKey: `tool:${rule}`,
      };
    }
  }
}

const STABLE_KINDS = new Set<ToolKind>(['read', 'search', 'fetch', 'think', 'switch_mode']);

/**
 * 标题里认出的 MCP 工具：`mcp__<服务>__<工具>`（claude-code-acp 等沿用 Claude Code 的命名）或
 * `<工具> (<服务> MCP Server)`（Gemini CLI 的显示名；未验证：按 Gemini CLI 0.46.0 的源码推断，没跑真实回合核对）。认不出时为 null。
 */
export function mcpToolOf(title: string): { server: string; tool: string } | null {
  const claude = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(title);
  if (claude) return { server: claude[1]!, tool: claude[2]! };
  const gemini = /^(.+) \((.+) MCP Server\)$/.exec(title);
  if (gemini) return { server: gemini[2]!, tool: gemini[1]! };
  return null;
}

/**
 * 这次审批是不是 BaoCut 自己的工具（经工具通道交给智能体的 MCP 服务，`servers` 是开会话时传过去的服务名）。
 * 这些工具在 Runtime 里按访问模式与风险另行把关（架构设计 §3.12），原生侧直接放行，免得同一个动作问两次、只读的也来问
 * （Claude 的 Driver 同样在 canUseTool 里放行 `mcp__baocut__*`）。只认种类为 other / 没给的：命令与改文件不算。
 */
export function isOwnMcpTool(snapshot: ToolSnapshot, servers: ReadonlySet<string>): boolean {
  if (servers.size === 0 || (snapshot.kind !== null && snapshot.kind !== 'other')) return false;
  const mcp = mcpToolOf(snapshot.title);
  return mcp !== null && servers.has(mcp.server);
}

function summarizeInput(raw: Record<string, unknown> | null): string | null {
  if (!raw) return null;
  const text = JSON.stringify(raw);
  return text === '{}' ? null : text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

/**
 * 按 BaoCut 的答复挑原生选项。允许一律挑「只这一次」：「本会话」由 Driver 自己记，「总是允许」的规则归 Harness 存，
 * 不能选原生的 `allow_always`（它会写进智能体自己的持久设置）。没有「只这一次」的选项时为 null，按取消处理。
 */
export function selectPermissionOption(options: PermissionOption[], behavior: 'allow' | 'reject'): PermissionOption | null {
  if (behavior === 'allow') return options.find((o) => o.kind === 'allow_once') ?? null;
  return options.find((o) => o.kind === 'reject_once') ?? options.find((o) => o.kind === 'reject_always') ?? null;
}

/** 旧版的会话模型状态（`session/new` 应答里的 `models`，Gemini CLI 等还在用；SDK 的类型里已经没有）。 */
export interface LegacyModelState {
  availableModels?: Array<{ modelId: string; name?: string | null; description?: string | null }> | null;
  currentModelId?: string | null;
}

/** 会话应答里与模式、模型有关的部分。 */
export interface AcpSessionState {
  modes?: SessionModeState | null;
  models?: LegacyModelState | null;
  configOptions?: SessionConfigOption[] | null;
}

export function findSelectOption(
  configOptions: SessionConfigOption[] | null | undefined,
  category: string,
): Extract<SessionConfigOption, { type: 'select' }> | null {
  const option = configOptions?.find((o) => o.type === 'select' && o.category === category);
  return (option as Extract<SessionConfigOption, { type: 'select' }> | undefined) ?? null;
}

export function flattenSelectOptions(option: Extract<SessionConfigOption, { type: 'select' }>): SessionConfigSelectOption[] {
  return option.options.flatMap((o) => ('group' in o ? o.options : [o]));
}

/** 模型表：优先旧版的 `models`，否则取分类为 model 的配置项。ACP 没有推理强度的统一说法，`efforts` 一律空。 */
export function deriveModels(state: AcpSessionState): DriverModel[] {
  const legacy = state.models;
  if (legacy?.availableModels?.length) {
    return legacy.availableModels.map((m) =>
      model(m.modelId, m.name ?? m.modelId, m.description ?? null, m.modelId === legacy.currentModelId),
    );
  }
  const option = findSelectOption(state.configOptions, 'model');
  if (!option) return [];
  return flattenSelectOptions(option).map((o) => model(o.value, o.name, o.description ?? null, o.value === option.currentValue));
}

function model(id: string, label: string, description: string | null, isDefault: boolean): DriverModel {
  return { id, label, description, tier: null, isDefault, efforts: [], defaultEffort: null };
}

/** 能用的会话模式 id：`modes` 优先，否则取分类为 mode 的配置项。 */
export function availableModes(state: AcpSessionState): { ids: string[]; via: 'modes' | 'config' | null; configId: string | null } {
  if (state.modes?.availableModes?.length) return { ids: state.modes.availableModes.map((m) => m.id), via: 'modes', configId: null };
  const option = findSelectOption(state.configOptions, 'mode');
  if (option) return { ids: flattenSelectOptions(option).map((o) => o.value), via: 'config', configId: option.id };
  return { ids: [], via: null, configId: null };
}

/** BaoCut 的 MCP 服务 → ACP 的 `mcpServers`（Streamable HTTP）。 */
export function acpMcpServers(servers: Record<string, McpServerSpec> | undefined): McpServer[] {
  return Object.entries(servers ?? {}).map(([name, spec]) => ({
    type: 'http' as const,
    name,
    url: spec.url,
    headers: Object.entries(spec.headers).map(([header, value]) => ({ name: header, value })),
  }));
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readString(raw: Record<string, unknown> | null, keys: string[]): string | null {
  for (const key of keys) {
    const value = raw?.[key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}
