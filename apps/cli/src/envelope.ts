import { isMessageRef, localizeText, type CatalogToolError } from '@baocut/protocol';
import { M } from './cli-copy.ts';
import { remedyHintText, remedyText } from './localized-text.ts';

/**
 * CLI 的输出信封与退出码（Agent 面设计 §5.1、§5.2；命令与协议规范 §11.7）。派生命令、元命令与管理桶共用这一份：
 *
 * - 成功 `{ ok: true, result, next?, runtime? }`：`result` 是工具的结果对象（与 MCP 工具结果的 JSON 相同），`next` 是建议的下一条
 *   命令（工具结果里的 `next`，已按 CLI 的写法渲染），`runtime: { started: true }` 表示这次自动拉起了 Runtime。
 * - 失败 `{ ok: false, error, runtime? }`：`error` 与 `catalog.call` 的错误对象（`ToolCatalog.errorBody`）相同；CLI 自己发现的问题
 *   （参数、缺 `--yes`、Runtime 不可用）用同一个形状。
 * - `--json`（stdout 不是 TTY 时默认）把信封原样写到 stdout；否则成功的结果按缩进格式写到 stdout，失败写到 stderr。
 */

export type Envelope =
  | { ok: true; result: unknown; next?: string; runtime?: { started: true } }
  | { ok: false; error: CatalogToolError; runtime?: { started: true } };

/** 退出码（§5.2）。 */
export const EXIT = {
  ok: 0,
  /** 失败或取消：任务终态 `failed` / `cancelled`，或工具、引擎拒绝。 */
  failed: 1,
  /** 要用户做事才能继续：配置能力、授权、同意外部工具等。输出里有 `remedy` 与 `next`。 */
  actionRequired: 2,
  /** Runtime 不可用或版本不兼容。 */
  runtimeUnavailable: 3,
  /** 参数不对，或不可撤销的命令缺 `--yes`。 */
  invalidArguments: 4,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/**
 * 错误码 → 退出码的唯一一张表。没列出的错误码都是 1。任务失败时按任务的错误码查，但不会低于 1。
 *
 * - 2：用户得先做一件事（配置、授权、同意、登录、安装），Agent 照 `remedy` / `next` 转告用户，不自己绕过。
 * - 3：CLI 自己判定的 Runtime 问题（连不上、拉不起、协议或接口版本不同）。
 * - 4：参数（含 CLI 解析阶段的未知旗标、类型不对）与缺 `--yes`。
 *
 * 说明书 `conventions.md` 的错误码表由 `tools/sync-agent-skill.ts` 按这张表生成。
 */
export const EXIT_BY_CODE: Readonly<Record<string, ExitCode>> = {
  // 能力与模型
  CAPABILITY_NOT_CONFIGURED: EXIT.actionRequired,
  DUB_SEPARATION_NOT_CONFIGURED: EXIT.actionRequired,
  MODELS_DIR_MISSING: EXIT.actionRequired,
  CREDENTIAL_UNAVAILABLE: EXIT.actionRequired,
  AUTHENTICATION_REQUIRED: EXIT.actionRequired,
  OFFLINE_STRICT: EXIT.actionRequired,
  // 授权与预算
  GRANT_REQUIRED: EXIT.actionRequired,
  GRANT_REVOKED: EXIT.actionRequired,
  BUDGET_EXCEEDED: EXIT.actionRequired,
  BUDGET_UNVERIFIABLE: EXIT.actionRequired,
  TASK_BUDGET_EXCEEDED: EXIT.actionRequired,
  TASK_BUDGET_UNVERIFIABLE: EXIT.actionRequired,
  // 外部工具（yt-dlp、ffmpeg）与链接
  TOOL_UNAVAILABLE: EXIT.actionRequired,
  TOOL_CONSENT_REQUIRED: EXIT.actionRequired,
  TOOL_UPDATE_CONFIRM_REQUIRED: EXIT.actionRequired,
  TOOL_UPDATE_MANUAL: EXIT.actionRequired,
  MEDIA_TOOL_UNAVAILABLE: EXIT.actionRequired,
  EXPORT_TOOL_MISSING: EXIT.actionRequired,
  LINK_LOGIN_REQUIRED: EXIT.actionRequired,
  LINK_COOKIES_UNAVAILABLE: EXIT.actionRequired,
  LINK_TOOL_UPDATE_REQUIRED: EXIT.actionRequired,
  // 音色
  VOICE_CONSENT_REQUIRED: EXIT.actionRequired,
  VOICE_CLONE_REQUIRED: EXIT.actionRequired,
  // Runtime
  RUNTIME_UNAVAILABLE: EXIT.runtimeUnavailable,
  RUNTIME_START_FAILED: EXIT.runtimeUnavailable,
  PROTOCOL_MISMATCH: EXIT.runtimeUnavailable,
  INTERFACE_VERSION_MISMATCH: EXIT.runtimeUnavailable,
  CATALOG_UNAVAILABLE: EXIT.runtimeUnavailable,
  // Runtime 在却停不了：不是 CLI 拉起的，或还有人在用。是失败，不是 Runtime 不可用。
  RUNTIME_NOT_OWNED: EXIT.failed,
  RUNTIME_IN_USE: EXIT.failed,
  // 说明书（`catalog.agentSkill`）找不到或写错：是安装或说明书本身的问题，不是参数也不是 Runtime 不可用。
  AGENT_SKILL_NOT_FOUND: EXIT.failed,
  AGENT_SKILL_INVALID: EXIT.failed,
  // 参数
  INVALID_ARGUMENTS: EXIT.invalidArguments,
  UNKNOWN_COMMAND: EXIT.invalidArguments,
  UNKNOWN_TOOL: EXIT.invalidArguments,
  CONFIRMATION_REQUIRED: EXIT.invalidArguments,
};

export function exitCodeFor(code: string): ExitCode {
  return EXIT_BY_CODE[code] ?? EXIT.failed;
}

/** 任务以失败或取消结束：按任务的错误码查表，但至少是 1（任务的错误码不会是参数或 Runtime 问题的 3、4）。 */
export function exitCodeForJob(code: string | null | undefined): ExitCode {
  const mapped = code ? exitCodeFor(code) : EXIT.failed;
  return mapped === EXIT.actionRequired ? mapped : EXIT.failed;
}

/** CLI 自己发现的问题：带错误码，最后由 `main` 包成失败信封。 */
export class CliError extends Error {
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.extra = extra;
  }

  body(): CatalogToolError {
    return { code: this.code, message: this.message, ...this.extra };
  }
}

export interface OutputOptions {
  /** 写信封的 JSON；不给时按 stdout 是不是 TTY。 */
  json?: boolean | undefined;
  stdout?: NodeJS.WritableStream & { isTTY?: boolean };
  stderr?: NodeJS.WritableStream & { isTTY?: boolean };
}

/** 一条命令的输出：信封写到哪里、写成什么样。 */
export class Output {
  readonly json: boolean;
  readonly stdout: NodeJS.WritableStream & { isTTY?: boolean };
  readonly stderr: NodeJS.WritableStream & { isTTY?: boolean };
  /** 这次自动拉起了 Runtime：写进信封。 */
  runtimeStarted = false;

  constructor(options: OutputOptions = {}) {
    this.stdout = options.stdout ?? process.stdout;
    this.stderr = options.stderr ?? process.stderr;
    this.json = options.json ?? !this.stdout.isTTY;
  }

  /** 写成功的信封，返回退出码 0。`next` 不给时取结果顶层的 `next`；`next` 只在信封顶层出现一次，结果里的去掉。 */
  success(result: unknown, next?: string | null): ExitCode {
    const hint = next ?? nextOf(result);
    const body = withoutNext(result);
    const envelope: Envelope = { ok: true, result: body, ...(hint ? { next: hint } : {}), ...this.#runtime() };
    if (this.json) this.stdout.write(`${JSON.stringify(envelope)}\n`);
    else {
      const text = renderHuman(body);
      if (text) this.stdout.write(`${text}\n`);
      if (hint) this.stdout.write(`${M.nextLabel}: ${hint}\n`);
      if (this.runtimeStarted) this.stderr.write(`${M.runtimeStartedNote}\n`);
    }
    return EXIT.ok;
  }

  /**
   * 管理桶的成功：`--json` 时与 `success` 相同（结果是协议方法的原始结果）；给人读时打印手写的几行，不用通用排版。
   */
  report(result: unknown, lines: readonly string[], next?: string | null): ExitCode {
    if (this.json) return this.success(result, next ?? null);
    for (const line of lines) this.stdout.write(`${line}\n`);
    if (next) this.stdout.write(`${M.nextLabel}: ${next}\n`);
    if (this.runtimeStarted) this.stderr.write(`${M.runtimeStartedNote}\n`);
    return EXIT.ok;
  }

  /** 写失败的信封，返回按错误码查到的退出码（或调用方给的）。 */
  failure(error: CatalogToolError, exitCode: ExitCode = exitCodeFor(error.code)): ExitCode {
    const envelope: Envelope = { ok: false, error, ...this.#runtime() };
    if (this.json) this.stdout.write(`${JSON.stringify(envelope)}\n`);
    else this.stderr.write(`${renderError(error)}\n`);
    return exitCode;
  }

  /** 裸 JSON（`spec`、`version`）：不包信封，人读时也是缩进的 JSON。 */
  raw(value: unknown): ExitCode {
    this.stdout.write(`${this.json ? JSON.stringify(value) : JSON.stringify(value, null, 2)}\n`);
    return EXIT.ok;
  }

  /** 纯文本（`--help`、`help <命令>`）。 */
  text(text: string): ExitCode {
    this.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
    return EXIT.ok;
  }

  #runtime(): { runtime?: { started: true } } {
    return this.runtimeStarted ? { runtime: { started: true } } : {};
  }
}

function nextOf(result: unknown): string | null {
  return isRecord(result) && typeof result.next === 'string' ? result.next : null;
}

function withoutNext(result: unknown): unknown {
  if (!isRecord(result) || !('next' in result)) return result;
  const { next: _next, ...rest } = result;
  return rest;
}

/** 失败给人读的样子：一行错误码与说明，随后是补救与下一步。 */
export function renderError(error: CatalogToolError): string {
  const message = localizeText(error.message, isMessageRef(error.messageRef) ? error.messageRef : null);
  const lines = [`${M.errorLabel} ${error.code}: ${message}`];
  const remedy = error.remedy;
  if (typeof remedy === 'string') lines.push(`  ${remedyText(error)}`);
  else if (isRecord(remedy)) {
    const hint = remedyHintText(remedy);
    if (hint !== null) lines.push(`  ${hint}`);
    if (Array.isArray(remedy.commands)) for (const command of remedy.commands) lines.push(`    ${String(command)}`);
  }
  // 引擎错误带消息引用：按 CLI 的界面语言重写说明与补救。
  if (typeof error.recovery === 'string')
    lines.push(`  ${localizeText(error.recovery, isMessageRef(error.recoveryRef) ? error.recoveryRef : null)}`);
  const rest = Object.fromEntries(
    Object.entries(error).filter(
      ([key]) => !['code', 'message', 'messageRef', 'remedy', 'remedyRef', 'recovery', 'recoveryRef', 'next'].includes(key),
    ),
  );
  const detail = renderHuman(rest);
  if (detail) lines.push(indent(detail, '  '));
  if (typeof error.next === 'string') lines.push(`${M.nextLabel}: ${error.next}`);
  return lines.join('\n');
}

/**
 * 给人读的格式：JSON 的另一种排版（缩进的「键: 值」），不另写每个工具的渲染。标量一行；短的标量数组写在一行；
 * 多行字符串缩进成块。
 */
export function renderHuman(value: unknown): string {
  return lines(value, '').join('\n');
}

function lines(value: unknown, pad: string): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${pad}[]`];
    if (value.every(isScalar) && value.map(scalar).join(', ').length <= 100) return [`${pad}${value.map(scalar).join(', ')}`];
    const out: string[] = [];
    for (const item of value) {
      const inner = lines(item, `${pad}  `);
      out.push(`${pad}- ${inner[0]!.slice(pad.length + 2)}`, ...inner.slice(1));
    }
    return out;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return pad ? [`${pad}{}`] : [];
    const out: string[] = [];
    for (const [key, item] of entries) {
      if (isScalar(item) && !(typeof item === 'string' && item.includes('\n'))) out.push(`${pad}${key}: ${scalar(item)}`);
      else if (typeof item === 'string') out.push(`${pad}${key}: |`, ...item.split('\n').map((line) => `${pad}  ${line}`));
      else if ((Array.isArray(item) && item.length === 0) || (isRecord(item) && Object.keys(item).length === 0)) {
        out.push(`${pad}${key}: ${Array.isArray(item) ? '[]' : '{}'}`);
      } else if (Array.isArray(item) && item.every(isScalar) && item.map(scalar).join(', ').length <= 100) {
        out.push(`${pad}${key}: ${item.map(scalar).join(', ')}`);
      } else out.push(`${pad}${key}:`, ...lines(item, `${pad}  `));
    }
    return out;
  }
  return [`${pad}${scalar(value)}`];
}

function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function scalar(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function indent(text: string, pad: string): string {
  return text
    .split('\n')
    .map((line) => `${pad}${line}`)
    .join('\n');
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
