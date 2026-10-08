/*
 * 部分机制移植自 paseo（Apache-2.0，Copyright (c) 2025-present Mohamed Boudra），modified：
 * packages/server/src/server/agent/providers/opencode/tool-call-detail-parser.ts 与 tool-call-mapper.ts 的工具名分类
 * （shell / bash、edit / write / patch、websearch / webfetch，edit 的 path / filePath、oldString / newString），
 * v2/configuration.ts 的权限规则写法（`{ action, resource, effect }`），v2/permissions.ts 的权限请求形状。
 * 改成 BaoCut 的 AgentItem / ApprovalRequest；文件修改的输出直接用 OpenCode 在元数据里给的统一 diff，
 * 访问模式到权限规则的映射与「本会话放行」的分类键是新加的。
 */
import path from 'node:path';
import { normalizeAgentMode, type AgentMode, type ApprovalRequest, type ToolCallKind, type ToolCallStatus } from '@baocut/protocol';
import { DriversOpencode } from '@baocut/protocol/messages/agent-drivers';
import type { AgentItem } from '@baocut/harness';
import { commandRule } from '../approval-rule.ts';

/** 一条原生权限规则。后面的规则覆盖前面的（会话上的规则排在智能体自带的规则之后）。 */
export interface PermissionRule {
  action: string;
  resource: string;
  effect: 'allow' | 'deny' | 'ask';
}

/**
 * 访问模式 → 会话的权限规则（两边取更严的，架构设计 §3.12）。原生侧来问的动作由 Harness 按风险与模式查表
 * （`decideApproval`）回答，所以除了 fullAccess，能拦下的都设成 `ask`：
 *
 * | BaoCut 模式 | edit（含 write、patch） | shell | external_directory |
 * | --- | --- | --- | --- |
 * | plan | deny | ask | ask |
 * | ask / autoAcceptEdits / auto | ask | ask | ask |
 * | fullAccess | allow | allow | allow |
 *
 * 每一档都拒绝 `question`（向用户发表单）：BaoCut 没有回答表单的通道，发出来回合就会一直等。
 * BaoCut 自己的 MCP 工具不加规则：OpenCode 的 build 智能体默认放行（`* * allow`），它的写操作由 Runtime 把关。
 * 读文件、搜索、取网页也按 build 智能体的默认放行（读 `.env` 仍会来问）。
 */
export function permissionRules(mode: AgentMode): PermissionRule[] {
  const normalized = normalizeAgentMode(mode);
  const rule = (action: string, effect: PermissionRule['effect']): PermissionRule => ({ action, resource: '*', effect });
  const question = rule('question', 'deny');
  switch (normalized) {
    case 'plan':
      return [rule('edit', 'deny'), rule('shell', 'ask'), rule('external_directory', 'ask'), question];
    case 'fullAccess':
      return [rule('edit', 'allow'), rule('shell', 'allow'), rule('external_directory', 'allow'), question];
    default:
      return [rule('edit', 'ask'), rule('shell', 'ask'), rule('external_directory', 'ask'), question];
  }
}

/** 一个权限请求（`permission.asked` 的 data，或 `GET /api/session/{id}/permission` 的一项）。 */
export interface PermissionRequest {
  id: string;
  sessionID: string;
  action: string;
  resources?: string[];
  metadata?: Record<string, unknown>;
  source?: { type?: string; messageID?: string; id?: string };
  message?: string;
}

/**
 * 权限请求 → BaoCut 的审批内容，加上「本会话放行」用的分类键与是否越界：
 * `shell` 是命令（规则按 `commandRule`）；`edit` 是文件修改（文件用相对工作目录的路径，Harness 据此判断在不在目录里）；
 * `external_directory`（碰工作目录之外）算越界，Harness 记成 `high`；别的按工具。
 */
export function approvalOf(request: PermissionRequest, cwd: string): { request: ApprovalRequest; grantKey: string; escalation: boolean } {
  const resources = (request.resources ?? []).filter((r): r is string => typeof r === 'string');
  const reason = request.message ?? null;
  switch (request.action) {
    case 'shell':
    case 'bash': {
      const command = resources.join('\n') || 'shell';
      const rule = commandRule(command);
      return { request: { kind: 'command', command, cwd, reason, rule }, grantKey: `command:${rule ?? command}`, escalation: false };
    }
    case 'edit': {
      const files = metadataFiles(request.metadata).map((f) => f.file);
      return {
        request: { kind: 'file-change', reason, files: files.length > 0 ? files : resources, rule: null },
        grantKey: 'file-change',
        escalation: false,
      };
    }
    case 'external_directory':
      return {
        request: {
          kind: 'tool',
          tool: 'external_directory',
          reason: reason ?? String(DriversOpencode.externalDirectory()),
          files: resources,
          server: null,
          rule: null,
        },
        grantKey: `external:${resources.join('\n')}`,
        escalation: true,
      };
    default:
      return {
        request: { kind: 'tool', tool: request.action, reason, files: resources, server: null, rule: request.action },
        grantKey: `tool:${request.action}`,
        escalation: false,
      };
  }
}

/** OpenCode 在 edit 的权限请求与工具结果里附的改动：`{ file, patch, status }`，patch 是统一 diff。 */
export function metadataFiles(metadata: unknown): Array<{ file: string; patch: string | null; status: string | null }> {
  const files = record(metadata)?.files;
  if (!Array.isArray(files)) return [];
  return files.flatMap((f) => {
    const entry = record(f);
    if (typeof entry?.file !== 'string') return [];
    return [
      {
        file: entry.file,
        patch: typeof entry.patch === 'string' ? entry.patch : null,
        status: typeof entry.status === 'string' ? entry.status : null,
      },
    ];
  });
}

/** 一次工具调用到目前为止的样子（`session.tool.*` 事件合并）。 */
export interface ToolState {
  id: string;
  name: string;
  input: Record<string, unknown> | null;
  status: ToolCallStatus;
  content: string | null;
  metadata: Record<string, unknown> | null;
  error: string | null;
  startedAt: number;
  endedAt: number | null;
}

const COMMAND_TOOLS = new Set(['shell', 'bash']);
const FILE_TOOLS = new Set(['edit', 'write', 'patch', 'apply_patch', 'multiedit']);
const WEB_TOOLS = new Set(['websearch', 'web_search', 'webfetch']);

/** 工具名 → 步骤种类。MCP 工具在 OpenCode 里叫 `<服务名>_<工具名>`。 */
export function toolKind(name: string, mcpServers: Iterable<string>): ToolCallKind {
  if (COMMAND_TOOLS.has(name)) return 'command';
  if (FILE_TOOLS.has(name)) return 'file-change';
  if (WEB_TOOLS.has(name)) return 'web-search';
  for (const server of mcpServers) if (name.startsWith(`${server}_`)) return 'mcp';
  return 'other';
}

/** 时间线上的一步。文件修改的 `output` 是统一 diff：优先用 OpenCode 给的，没有时由 oldString / newString 拼一个。 */
export function toolItem(state: ToolState, cwd: string, mcpServers: Iterable<string>): Extract<AgentItem, { kind: 'tool-call' }> {
  const kind = toolKind(state.name, mcpServers);
  const input = state.input;
  const file = readString(input, ['path', 'filePath', 'file_path']);
  const shown = file ? relativeTo(cwd, file) : null;
  let title = state.name;
  let detail: string | null = null;
  let output = state.error ?? state.content;
  switch (kind) {
    case 'command': {
      const command = readString(input, ['command']);
      if (command) title = command;
      const workdir = readString(input, ['workdir', 'cwd']);
      detail = workdir ? `cwd: ${workdir}` : null;
      break;
    }
    case 'file-change': {
      const files = metadataFiles(state.metadata);
      title = files.length > 0 ? files.map((f) => f.file).join(', ') : (shown ?? state.name);
      detail = files.length > 0 ? files.map((f) => `${f.status ?? 'modified'} ${f.file}`).join('\n') : shown;
      const diff =
        files
          .map((f) => f.patch)
          .filter((p): p is string => !!p)
          .join('\n') || editDiff(shown, input);
      if (diff) output = state.error ? `${state.error}\n${diff}` : diff;
      break;
    }
    case 'web-search':
      title = readString(input, ['query', 'url']) ?? state.name;
      break;
    case 'mcp':
      title = state.name;
      detail = input && Object.keys(input).length > 0 ? JSON.stringify(input) : null;
      break;
    default: {
      const hint = shown ?? readString(input, ['pattern', 'query', 'description']);
      title = hint ? `${state.name} ${hint}` : state.name;
      break;
    }
  }
  const meta = state.metadata;
  const exit = meta?.exit ?? meta?.exitCode;
  return {
    kind: 'tool-call',
    id: state.id,
    tool: kind,
    title,
    detail,
    output: output || null,
    status: state.status,
    exitCode: typeof exit === 'number' ? exit : null,
    durationMs: state.endedAt !== null ? state.endedAt - state.startedAt : null,
  };
}

/** edit 的 oldString → newString 写成一段统一 diff（OpenCode 没给元数据时的兜底）。 */
export function editDiff(file: string | null, input: Record<string, unknown> | null): string | null {
  const before = readString(input, ['oldString', 'old_string']);
  const after = readString(input, ['newString', 'new_string']);
  if (before === null && after === null) {
    const content = readString(input, ['content']);
    if (content === null || !file) return null;
    const lines = content.replace(/\n$/, '').split('\n');
    return [`--- /dev/null`, `+++ ${file}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join('\n') + '\n';
  }
  const oldLines = (before ?? '').split('\n');
  const newLines = (after ?? '').split('\n');
  const name = file ?? 'file';
  return (
    [
      `--- ${name}`,
      `+++ ${name}`,
      `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
      ...oldLines.map((l) => `-${l}`),
      ...newLines.map((l) => `+${l}`),
    ].join('\n') + '\n'
  );
}

/** 工具结果的内容（`[{ type: 'text', text }, { type: 'file', uri }]`）拼成文字。 */
export function contentText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const parts = content.flatMap((c) => {
    const entry = record(c);
    if (entry?.type === 'text' && typeof entry.text === 'string') return [entry.text];
    if (entry?.type === 'file' && typeof entry.uri === 'string') return [typeof entry.name === 'string' ? entry.name : entry.uri];
    return [];
  });
  return parts.length > 0 ? parts.join('\n') : null;
}

function relativeTo(cwd: string, file: string): string {
  if (!path.isAbsolute(file)) return file;
  const relative = path.relative(cwd, file);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : file;
}

export function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readString(raw: Record<string, unknown> | null, keys: string[]): string | null {
  for (const key of keys) {
    const value = raw?.[key];
    if (typeof value === 'string') return value;
  }
  return null;
}
