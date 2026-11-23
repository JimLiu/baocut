// i18n-ignore-file: 给模型的工具说明与错误（说明来自 Open Artifact，英文）
import { z } from 'zod';
import { TOOL_DEFINITIONS, type ToolCallResult, type ToolDefinition } from '@open-artifact/protocol';
import type { Id, RiskLevel } from '@baocut/protocol';
import { RcArtifacts } from '@baocut/protocol/messages/runtime-core';
import { ToolError, type ToolInfo, type ToolSet } from './tool-catalog.ts';
import { approvalField, confirmSummary, type ToolPrincipal, type ToolScope } from './tool-scope.ts';

/**
 * Open Artifact 的三个工具（docs/design/artifacts §3）：`Artifact`、`ArtifactData`、`ArtifactComments`。
 *
 * 实现都在 Open Artifact 的 daemon 里：这里只按 BaoCut 的访问模式把关（动作的种类来自工具定义的 `actions`），再以会话的身份
 * 交给 daemon（`ArtifactsBackend.call`，会话 id 是 Open Artifact 的 session，会话的工作目录是 workspace）。参数的细查也在 daemon，
 * 所以 `schemas` 只要求是个对象，给智能体看的 JSON Schema 原样用 Open Artifact 的（`inputSchemas`）。
 */

/** 工具组交给 daemon 的那一步：由 `ArtifactsService` 实现；daemon 连不上时抛 `ToolError('ARTIFACTS_UNAVAILABLE')`。 */
export interface ArtifactsBackend {
  /** 工具定义：连上时是 daemon 的，没连上时是随包带的。 */
  definitions(): readonly ToolDefinition[];
  call(name: string, args: Record<string, unknown>, conversationId: Id): Promise<ToolCallResult>;
}

export interface ArtifactToolsDeps {
  scope: ToolScope;
  backend: ArtifactsBackend;
}

export const ARTIFACT_TOOL_NAMES = ['Artifact', 'ArtifactData', 'ArtifactComments'] as const;
type ArtifactToolName = (typeof ARTIFACT_TOOL_NAMES)[number];

const loose = z.object({ action: z.string().min(1).max(64) }).catchall(z.unknown());

const EXAMPLES: Record<ArtifactToolName, ToolInfo['examples']> = {
  Artifact: [
    { title: 'Start an artifact of a type', args: { action: 'quickstart', intent: 'slides' } },
    { title: 'List artifacts in this workspace', args: { action: 'list' } },
  ],
  ArtifactData: [{ title: 'List documents in a collection', args: { action: 'list', url: 'open-artifact://artifact/abc123', collection: 'items' } }],
  ArtifactComments: [{ title: 'Read open comment threads', args: { action: 'read', url: 'open-artifact://artifact/abc123' } }],
};

function infoOf(def: ToolDefinition): ToolInfo {
  const name = def.name as ArtifactToolName;
  const readOnly = Object.values(def.actions ?? {}).every((kind) => kind === 'read');
  return {
    title: def.annotations?.title ?? def.name,
    description: def.description,
    annotations: {
      ...(def.annotations?.readOnlyHint !== undefined ? { readOnlyHint: def.annotations.readOnlyHint } : {}),
      ...(def.annotations?.destructiveHint !== undefined ? { destructiveHint: def.annotations.destructiveHint } : {}),
    },
    effect: readOnly ? 'query' : 'mutation',
    examples: EXAMPLES[name] ?? [],
    // 只给会话里的智能体：作品属于会话（Open Artifact 的 session），终端与对外服务用 Open Artifact 自己的 CLI 与 MCP。
    surfaces: ['agent'],
  };
}

/**
 * 一个动作的风险（§3.12）：读与打开页面是 `read`，写是 `edit`；删除、交出所有权（`remove`）、给人分享（`person`）是 `high`。
 * 装了远程类型（作品页面与动作在别的计算机上）时，daemon 的工具定义标 `openWorldHint`：这时会把数据发出本机的动作（`remoteActions`）
 * 也是 `high`；没装远程类型时数据不出本机，`remoteActions` 不算数。工具定义里没有的动作按 `edit`，daemon 再自己拒绝不认识的。
 */
export function artifactRisk(def: ToolDefinition | undefined, action: string): RiskLevel {
  if (def?.annotations?.openWorldHint === true && def.remoteActions?.includes(action)) return 'high';
  const kind = def?.actions?.[action];
  if (kind === 'read' || kind === 'ui') return 'read';
  if (kind === 'remove' || kind === 'person') return 'high';
  return 'edit';
}

export class ArtifactTools implements ToolSet {
  readonly schemas: Readonly<Record<string, z.ZodType>>;
  readonly definitions: Readonly<Record<string, ToolInfo>>;
  readonly inputSchemas: Readonly<Record<string, Record<string, unknown>>>;
  readonly #deps: ArtifactToolsDeps;

  constructor(deps: ArtifactToolsDeps) {
    this.#deps = deps;
    // 目录项按随包带的定义建：工具名与参数形状在同一个协议版本里不变；daemon 更新后的说明在调用时生效。
    const defs = TOOL_DEFINITIONS;
    this.schemas = Object.fromEntries(defs.map((def) => [def.name, loose]));
    this.definitions = Object.fromEntries(defs.map((def) => [def.name, infoOf(def)]));
    this.inputSchemas = Object.fromEntries(defs.map((def) => [def.name, def.inputSchema as unknown as Record<string, unknown>]));
  }

  async dispatch(name: string, args: unknown, principal: ToolPrincipal): Promise<unknown> {
    if (!(ARTIFACT_TOOL_NAMES as readonly string[]).includes(name)) throw new ToolError('UNKNOWN_TOOL', `No such tool: ${name}`);
    if (principal.kind !== 'agent') throw new ToolError('FORBIDDEN', 'Artifact tools are only available to an agent in a BaoCut conversation');
    const { scope, backend } = this.#deps;
    const params = args as Record<string, unknown> & { action: string };
    const def = backend.definitions().find((d) => d.name === name) ?? TOOL_DEFINITIONS.find((d) => d.name === name);
    const risk = artifactRisk(def, params.action);
    const access = scope.authorize(principal, risk !== 'read');
    const note = risk === 'read' ? undefined : await scope.confirm(access, { tool: name, risk, ...confirmSummary(RcArtifacts.confirmAction({ tool: name, action: params.action })) });
    const result = await backend.call(name, params, principal.conversationId);
    if (result.error) {
      const { code, message, fix } = result.error;
      throw new ToolError(code, message, { ...(fix ? { fix } : {}), ...(result.next ? { next: result.next } : {}), ...(result.messages?.length ? { messages: result.messages } : {}) });
    }
    return { ...result, ...approvalField(note) };
  }
}
