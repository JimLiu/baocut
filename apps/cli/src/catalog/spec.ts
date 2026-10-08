import type { CatalogEditOperations, CatalogListResult, CatalogTool } from '@baocut/protocol';
import { M } from '../cli-copy.ts';
import { CliError } from '../envelope.ts';
import { buildTree } from './command-tree.ts';

/**
 * `baocut spec [<名字>]`（Agent 面设计 §4.5）：机器可读的目录，裸 JSON（不包信封）。名字可以写工具名（`videos_inspect`）、
 * 点号（`videos.inspect`）或命令（`videos inspect`）；`edits.<操作>` 给 `edits apply` 的一个操作（与 `edits_ops` 同源）。
 * 每一项都带接口版本。
 */

export type SpecResult =
  | { interfaceVersion: string; tools: CatalogTool[] }
  | { interfaceVersion: string; tool: CatalogTool }
  | { interfaceVersion: string; operation: CatalogEditOperations['families'][number]['operations'][number]; conventions: string };

export function specOf(catalog: CatalogListResult, editOps: CatalogEditOperations | null, name: string | undefined): SpecResult {
  const { interfaceVersion } = catalog;
  if (!name) return { interfaceVersion, tools: catalog.tools };
  const tool = findTool(catalog.tools, name);
  if (tool) return { interfaceVersion, tool };
  const op = /^edits[._ ](.+)$/.exec(name)?.[1];
  if (op && editOps) {
    for (const family of editOps.families) {
      const operation = family.operations.find((candidate) => candidate.type === op);
      if (operation) return { interfaceVersion, operation, conventions: editOps.conventions };
    }
    throw new CliError('INVALID_ARGUMENTS', M.unknownEditOp(op), {
      operations: editOps.families.flatMap((family) => family.operations.map((operation) => operation.type)),
    });
  }
  throw new CliError('INVALID_ARGUMENTS', M.unknownSpec(name));
}

/** 名字 → 工具：工具名、`名词.动词` 或 `名词 动词`（多词动词用 `-`）。 */
export function findTool(tools: readonly CatalogTool[], name: string): CatalogTool | undefined {
  const direct = tools.find((tool) => tool.name === name);
  if (direct) return direct;
  const [noun, verb, extra] = name.split(/[. ]/);
  if (extra !== undefined || !noun) return undefined;
  const tree = buildTree(tools);
  return verb === undefined ? tree.verbs.get(noun)?.tool : tree.nouns.get(noun)?.get(verb)?.tool;
}
