import path from 'node:path';
import { MCP_INTERFACE_VERSION, RpcError, renderCliToolNames, toolCommandName, type CatalogAgentSkill } from '@baocut/protocol';
import { RcGateway, RcSkills } from '@baocut/protocol/messages/runtime-core';
import type { TrustedPrincipal } from '../gateway.ts';
import type { RpcHandlers } from '../handlers.ts';
import { AGENT_SKILL_ID, AgentSkillRenderError, renderAgentSkill, resolveBuiltinAgentSkillsDir } from '../skills/agent-skill-renderer.ts';
import { resolveLocalPrincipal } from './local-scope.ts';
import { errorBody, type ToolCatalog, type ToolOutcome } from './tool-catalog.ts';
import { defaultToolRisk } from './tool-scope.ts';

/**
 * `catalog.*` 的处理函数（架构设计 §3.5、§4.1；命令与协议规范 §4.1）：把 Agent 面的工具目录经网关交给 CLI。目录是 Runtime 里
 * 那一份 `ToolCatalog`（工具组经 `ScopeRouter` 按主体转给 `LocalScope`），这里拿的是它对终端的视图。
 *
 * 只给 `cli` 与 `desktop` 连接：浏览器（`web`）、对外服务与 `agent` 连接一律 `forbidden`；Web 服务的白名单里也没有 `catalog.*`。
 * 工具层的结果与拒绝都放在返回值里（`{ ok }`），拒绝与 MCP 工具结果的 `error` 是同一个对象（`errorBody`）。
 *
 * `catalog.agentSkill` 把说明书（`agent-skills/baocut/`）按 CLI 面渲染给 `baocut skill install`：渲染器在 Runtime 这边，CLI 仍只经
 * Client 与协议（架构设计 §13.1）；`{{tool:…}}` 按这份目录对终端的视图核对。每次调用都重新读目录。
 */
export function catalogMethods(
  tools: ToolCatalog,
  options: { agentSkillsDir?: () => string | null } = {},
): Pick<RpcHandlers['methods'], 'catalog.list' | 'catalog.call' | 'catalog.agentSkill'> {
  const agentSkillsDir = options.agentSkillsDir ?? (() => resolveBuiltinAgentSkillsDir());
  let names: readonly string[] | null = null;
  const toolNames = () => (names ??= tools.list().map((tool) => tool.name));
  const own = (principal: TrustedPrincipal) => {
    if (principal.kind !== 'cli' && principal.kind !== 'desktop') {
      throw new RpcError('forbidden', RcGateway.catalogLocalOnly());
    }
  };
  return {
    'catalog.list': (_p, principal) => {
      own(principal);
      return {
        interfaceVersion: MCP_INTERFACE_VERSION,
        tools: tools.list().map((tool) => ({ ...tool, risk: defaultToolRisk(tool.name) })),
      };
    },
    // `cwd` 与 `project` 都是绝对路径（schema 检查）；`--project` 的相对路径由 CLI 按 cwd 解析好再发。
    'catalog.call': async (p, principal) => {
      own(principal);
      let local;
      try {
        local = await resolveLocalPrincipal(principal, p);
      } catch (error) {
        return { ok: false, error: errorBody(error) };
      }
      const outcome = await tools.invoke(p.name, p.args, local);
      return local.client === 'cli' ? renderForCli(outcome, toolNames()) : outcome;
    },
    'catalog.agentSkill': (_p, principal) => {
      own(principal);
      return agentSkill(agentSkillsDir(), tools);
    },
  };
}

function agentSkill(root: string | null, tools: ToolCatalog): CatalogAgentSkill {
  const sourceDir = root && path.join(root, AGENT_SKILL_ID);
  let files;
  try {
    files = sourceDir ? renderAgentSkill(sourceDir, { face: 'cli', catalog: { tools: tools.list() } }) : null;
  } catch (error) {
    if (error instanceof AgentSkillRenderError) {
      throw new RpcError('conflict', RcSkills.agentSkillRenderFailed({ problem: error.localized }), {
        code: 'AGENT_SKILL_INVALID',
        file: error.file,
        line: error.line,
      });
    }
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') files = null;
    else throw error;
  }
  if (!sourceDir || !files) {
    throw new RpcError('not-found', RcSkills.agentSkillDirNotFound({ dir: `agent-skills/${AGENT_SKILL_ID}` }), {
      code: 'AGENT_SKILL_NOT_FOUND',
      ...(sourceDir ? { path: sourceDir } : {}),
    });
  }
  return {
    interfaceVersion: MCP_INTERFACE_VERSION,
    id: AGENT_SKILL_ID,
    sourceDir,
    files: [...files].sort(([a], [b]) => a.localeCompare(b)).map(([file, content]) => ({ path: file, content })),
  };
}

/**
 * `next` 按主体渲染（Agent 面设计 §5.1；命令与协议规范 §11.7）：工具写的 `next` 用工具名（MCP 的写法），给 CLI 时把其中的
 * `<名词>_<动词>` 换成 `baocut <名词> <动词>`（多词动词 `_` → `-`）。只换目录里的名字；一级动词（`export`、`transcribe`）
 * 两边同名、又常是普通词，不动。只看结果与错误顶层的 `next`。
 */
export function renderForCli(outcome: ToolOutcome, names: readonly string[]): ToolOutcome {
  if (outcome.ok) {
    const result = outcome.result;
    if (!isRecord(result) || typeof result.next !== 'string') return outcome;
    return { ok: true, result: { ...result, next: cliNext(result.next, names) } };
  }
  if (typeof outcome.error.next !== 'string') return outcome;
  return { ok: false, error: { ...outcome.error, next: cliNext(outcome.error.next, names) } };
}

/** 一段 `next` 文字里的工具名换成 CLI 命令。 */
export function cliNext(text: string, names: readonly string[]): string {
  return renderCliToolNames(text, names);
}

/** 工具名 → CLI 命令（不含 `baocut`）：`videos_import_package` → `videos import-package`，`export` → `export`。 */
export function cliCommand(name: string): string {
  return toolCommandName(name).display;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
