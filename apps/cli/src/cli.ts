import fs from 'node:fs';
import {
  RpcError,
  processLanguageTags,
  resolveLanguage,
  setLocale,
  type CatalogEditOperations,
  type CatalogListResult,
} from '@baocut/protocol';
import { M } from './cli-copy.ts';
import { CliError, EXIT, Output, type ExitCode } from './envelope.ts';
import { buildTree, lookup } from './catalog/command-tree.ts';
import { extractGlobals, processInput, parseToolArgs, type GlobalFlags, type InputSource } from './catalog/flags.ts';
import { renderCommandHelp, renderGroupHelp, renderMainHelp, type AdminEntry } from './catalog/help.ts';
import { runTool } from './catalog/run.ts';
import { SNAPSHOT_COMMAND, loadSnapshot } from './catalog/snapshot.ts';
import { specOf } from './catalog/spec.ts';
import { status, version } from './meta.ts';
import { connectRuntime, findRuntime, openClient, runtimeHome, type Session } from './runtime/connection.ts';
import { runtimeCommand } from './runtime/runtime-command.ts';

/**
 * `baocut` 的分发（Agent 面设计 §4、§5）：元命令 → 管理桶 → 由目录派生的命令。
 *
 * - 元命令：`help`、`spec`、`version`、`status`、`runtime`，以及不带命令或带 `--help`。
 * - 管理桶（§7）：手写的、只给人用的命令，按名词与子命令精确匹配（`models configure`），先于派生命令。
 * - 其余按目录：连上 Runtime（必要时拉起），以 `catalog.list` 为准找命令、解析参数、执行。
 */

/** 管理桶：名字给帮助用，`handles` 判断一条命令归不归它，`run` 执行（收到命令行的全部参数）。 */
export interface AdminBucket {
  entries: readonly AdminEntry[];
  /** `words` 是命令行里去掉旗标之后的词（`['models', 'configure', …]`）。 */
  handles(words: readonly string[]): boolean;
  run(argv: readonly string[], context: AdminContext): Promise<ExitCode>;
}

export interface AdminContext {
  output: Output;
  globals: GlobalFlags;
  home: string;
  cwd: string;
  /** 这次调用的环境变量（测试里换成临时的 HOME、宿主配置目录）。 */
  env: NodeJS.ProcessEnv;
}

export interface CliIo {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdout?: NodeJS.WritableStream & { isTTY?: boolean };
  stderr?: NodeJS.WritableStream & { isTTY?: boolean };
  input?: InputSource;
}

const META = new Set(['help', 'spec', 'version', 'status', 'runtime']);

function isMeta(word: string): word is 'help' | 'spec' | 'version' | 'status' | 'runtime' {
  return META.has(word);
}

/** `status` 的参数：只有 `--full`（带上每种能力的全部 Provider 与模型、本地模型包的详情）。 */
function statusArgs(tail: readonly string[]): boolean {
  for (const token of tail) {
    if (token === '--full') continue;
    const flag = token.startsWith('-');
    throw new CliError(
      'INVALID_ARGUMENTS',
      flag ? M.unknownFlag(token, 'status') : M.unknownCommand(`status ${token}`),
      flag ? { flag: token } : {},
    );
  }
  return tail.length > 0;
}

export async function runCli(argv: readonly string[], admin: AdminBucket, io: CliIo = {}): Promise<ExitCode> {
  setLocale(resolveLanguage(null, processLanguageTags()));
  const env = io.env ?? process.env;
  const home = runtimeHome(env);
  const cwd = fs.realpathSync(io.cwd ?? process.cwd());
  let output = new Output({ stdout: io.stdout, stderr: io.stderr });
  let session: Session | null = null;
  try {
    let parsed: ReturnType<typeof extractGlobals> | null = null;
    let parseError: unknown = null;
    try {
      parsed = extractGlobals(argv);
    } catch (error) {
      parseError = error;
    }
    // 管理桶自己解析旗标（它们有 `--yes`、`--out` 之类的同名旗标，含义各自的）。
    const words = (parsed?.rest ?? argv).filter((token) => !token.startsWith('-'));
    if (words.length > 0 && !META.has(words[0]!) && admin.handles(words)) {
      const globals = extractGlobals(argv.filter((token) => token === '--json' || token === '--no-json')).globals;
      output = new Output({ json: globals.json, stdout: io.stdout, stderr: io.stderr });
      return await admin.run(argv, { output, globals, home, cwd, env });
    }
    if (!parsed) throw parseError;

    const { globals, rest } = parsed;
    output = new Output({ json: globals.json, stdout: io.stdout, stderr: io.stderr });
    const [first, ...tail] = rest;

    if (first === undefined || first === 'help') {
      const target = first === 'help' ? tail : [];
      return await help(output, home, cwd, admin, target);
    }
    // `--help` 在哪条命令上都是帮助，元命令（`runtime --help`、`spec --help`）也一样（§4.5）。
    if (globals.help) return await help(output, home, cwd, admin, rest);
    if (first === 'spec') {
      if (tail.length > 1) throw new CliError('INVALID_ARGUMENTS', M.unknownSpec(tail.join(' ')));
      return await spec(output, home, cwd, tail[0]);
    }
    if (first === 'version') return await version(output, home);
    if (first === 'runtime') return await runtimeCommand(output, home, tail, globals.noStart);

    // 没有正在跑的 Runtime 时先按快照看命令：拼错的命令（含已知名词后不认识的动词）不必为此拉起 Runtime，只给名词时
    // 列出这个组也不必。有在跑的就问它（快照旧了时以它为准），不拉起。
    const snapshot = first === 'status' ? null : loadSnapshot();
    if (snapshot && !findRuntime(home)) {
      const known = lookup(buildTree(snapshot.tools), rest);
      if (known.kind === 'none' || (known.kind === 'group' && known.verb !== null)) {
        throw new CliError('UNKNOWN_COMMAND', M.unknownCommand(rest.slice(0, 2).join(' ')));
      }
      if (known.kind === 'group') return await help(output, home, cwd, admin, [known.noun]);
    }
    // `status` 只认 `--full`；不认识的在拉起 Runtime 之前拒绝。
    const statusFull = first === 'status' && statusArgs(tail);
    // `status --no-start`：只看状态，没在跑也是一个回答。
    if (first === 'status' && globals.noStart && !findRuntime(home)) {
      return output.success({ runtime: { running: false, home } }, 'baocut runtime ensure');
    }

    session = await connectRuntime({ home, start: !globals.noStart });
    output.runtimeStarted = session.started;
    if (first === 'status') return await status(output, session, cwd, { full: statusFull });

    const found = lookup(buildTree(session.catalog.tools), rest);
    if (found.kind !== 'command') {
      if (found.kind === 'group' && found.verb === null)
        return output.text(renderGroupHelp(session.catalog.tools, found.noun, adminEntry(admin, found.noun)) ?? '');
      throw new CliError('UNKNOWN_COMMAND', M.unknownCommand(rest.slice(0, 2).join(' ')));
    }
    const input = io.input ?? processInput(cwd);
    const args = await parseToolArgs(found.command, found.rest, globals, input);
    return await runTool({ session, command: found.command, args, globals, cwd, output });
  } catch (error) {
    return fail(output, error);
  } finally {
    session?.client.close();
  }
}

/** 错误 → 失败信封。 */
function fail(output: Output, error: unknown): ExitCode {
  if (error instanceof CliError) return output.failure(error.body());
  if (error instanceof RpcError) {
    const details = (typeof error.details === 'object' && error.details !== null ? error.details : {}) as Record<string, unknown>;
    const code = typeof details.code === 'string' ? details.code : error.code.toUpperCase().replace(/-/g, '_');
    return output.failure({ ...details, code, message: error.message });
  }
  return output.failure({ code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) }, EXIT.failed);
}

function adminEntry(admin: AdminBucket, name: string): AdminEntry | undefined {
  return admin.entries.find((entry) => entry.name === name);
}

/**
 * `help` 与 `spec` 用的目录（架构设计 §3.6）：有正在跑的 Runtime 时以它的 `catalog.list` 为准（版本与执行时一致），没有或问不到时
 * 用构建时的快照；都没有时 `CATALOG_UNAVAILABLE`。不为看帮助拉起 Runtime。
 */
async function readCatalog(
  home: string,
  cwd: string,
  withOps: boolean,
): Promise<{ catalog: CatalogListResult; editOps: CatalogEditOperations | null }> {
  const discovery = findRuntime(home);
  if (discovery) {
    try {
      const { client } = await openClient(discovery);
      try {
        const catalog = await client.request('catalog.list', {});
        let editOps: CatalogEditOperations | null = null;
        if (withOps) {
          const ops = await client.request('catalog.call', { name: 'edits_ops', args: {}, cwd });
          if (ops.ok) editOps = ops.result as CatalogEditOperations;
        }
        return { catalog, editOps };
      } finally {
        client.close();
      }
    } catch {
      // 问不到（正在退出、协议不同）：退回快照。
    }
  }
  const snapshot = loadSnapshot();
  if (snapshot) return { catalog: snapshot, editOps: snapshot.editOps };
  throw new CliError('CATALOG_UNAVAILABLE', M.catalogUnavailable(SNAPSHOT_COMMAND), { next: SNAPSHOT_COMMAND });
}

async function help(output: Output, home: string, cwd: string, admin: AdminBucket, target: readonly string[]): Promise<ExitCode> {
  const topic = target[0];
  if (topic !== undefined && isMeta(topic)) return output.text(M.metaHelp[topic]);
  const { catalog } = await readCatalog(home, cwd, false);
  if (target.length === 0) return output.text(renderMainHelp(catalog.tools, admin.entries));
  const found = lookup(buildTree(catalog.tools), target);
  if (found.kind === 'command')
    return output.text(
      renderCommandHelp(
        found.command,
        catalog.tools.map((tool) => tool.name),
      ),
    );
  const noun = target[0]!;
  const entry = adminEntry(admin, noun);
  if (found.kind === 'group' || entry) {
    const text = renderGroupHelp(catalog.tools, noun, entry);
    if (text) return output.text(text);
  }
  throw new CliError('UNKNOWN_COMMAND', M.unknownCommand(target.slice(0, 2).join(' ')));
}

async function spec(output: Output, home: string, cwd: string, name: string | undefined): Promise<ExitCode> {
  const { catalog, editOps } = await readCatalog(home, cwd, Boolean(name?.startsWith('edits')));
  return output.raw(specOf(catalog, editOps, name));
}
