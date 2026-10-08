import { renderCliToolNames, toolCommandName, type CatalogTool } from '@baocut/protocol';

/**
 * 目录 → 命令树（Agent 面设计 §4.1）：工具名 `<名词>_<动词>` 是 `baocut <名词> <动词>`，多词动词的 `_` 换成 `-`
 * （`videos_import_package` → `videos import-package`）；没有 `_` 的是一级动词，两边同名（`transcribe`）。规则只有一份，在
 * `@baocut/protocol` 的 `toolCommandName`（Runtime 渲染 `next` 与说明书的渲染器也用它）。
 */

export interface CatalogCommand {
  tool: CatalogTool;
  /** 名词组；一级动词为 null。 */
  noun: string | null;
  verb: string;
  /** 命令行上的写法（不含 `baocut`）：`videos import-package`、`export`。 */
  display: string;
}

export interface CommandTree {
  /** 一级动词，按目录顺序。 */
  verbs: Map<string, CatalogCommand>;
  /** 名词组 → 动词 → 命令，按目录顺序。 */
  nouns: Map<string, Map<string, CatalogCommand>>;
  byTool: Map<string, CatalogCommand>;
}

export function commandOf(tool: CatalogTool): CatalogCommand {
  return { tool, ...toolCommandName(tool.name) };
}

export function buildTree(tools: readonly CatalogTool[]): CommandTree {
  const tree: CommandTree = { verbs: new Map(), nouns: new Map(), byTool: new Map() };
  for (const tool of tools) {
    const command = commandOf(tool);
    tree.byTool.set(tool.name, command);
    if (command.noun === null) tree.verbs.set(command.verb, command);
    else {
      let group = tree.nouns.get(command.noun);
      if (!group) tree.nouns.set(command.noun, (group = new Map()));
      group.set(command.verb, command);
    }
  }
  return tree;
}

export type Lookup =
  | { kind: 'command'; command: CatalogCommand; rest: string[] }
  /** 只给了名词（或名词后跟着不认识的动词）：交给管理桶，或列出这个组。 */
  | { kind: 'group'; noun: string; verb: string | null; rest: string[] }
  | { kind: 'none' };

/** 按命令行的前一两个词找命令。 */
export function lookup(tree: CommandTree, argv: readonly string[]): Lookup {
  const [first, second, ...rest] = argv;
  if (!first) return { kind: 'none' };
  const verb = tree.verbs.get(first);
  if (verb) return { kind: 'command', command: verb, rest: argv.slice(1) };
  const group = tree.nouns.get(first);
  if (!group) return { kind: 'none' };
  const command = second === undefined ? undefined : group.get(second);
  if (command) return { kind: 'command', command, rest };
  return { kind: 'group', noun: first, verb: second ?? null, rest };
}

/**
 * 要用户点头才执行的命令（不可撤销的，以及先报大小的 `models install`，Agent 面设计 §3.3、§4.3）：没有 `--yes` 时不执行，
 * 退出码 4。帮助里的示例与通用旗标据此带上 `--yes`。
 */
export function needsConfirmation(tool: CatalogTool): boolean {
  return tool.effect === 'destructive' || tool.name === 'models_install';
}

/** 工具说明的第一句（`ToolDefinition.description` 约定第一句是一行摘要）。句号后紧跟字母的（`video.db`）不算句末。 */
export function summaryOf(description: string): string {
  const match = /^[\s\S]*?(?:[。！？]|[.!?](?=\s|$))/.exec(description);
  return (match ? match[0] : description).trim();
}

/**
 * 说明里的工具名换成命令（`videos_list` → `baocut videos list`），与 Runtime 给 CLI 渲染 `next` 的是同一个函数
 * （`@baocut/protocol` 的 `renderCliToolNames`）：只换目录里带 `_` 的名字，一级动词两边同名、又常是普通词，不动。
 */
export function renderToolNames(text: string, names: readonly string[]): string {
  return renderCliToolNames(text, names);
}
