import { spawn } from 'node:child_process';
import {
  CredentialStoreError,
  checkCredentialKey,
  checkCredentialSecret,
  type CredentialErrorCode,
  type CredentialStore,
} from './credential-store.ts';
import { RuntimeStorageCredentials as SC } from '@baocut/protocol/messages/runtime-storage';

/**
 * 正式版本的凭据存放（架构设计 §6.8）：系统的安全存储，经随应用签名的 `credential-helper` 访问（macOS 钥匙串 / Windows Credential Manager）。
 *
 * 每个操作起一个助手进程：stdin 写一行 JSON 请求 `{ op, key, secret? }`，stdout 读一行 JSON 响应
 * `{ ok: true, secret? , exists? }` 或 `{ ok: false, error, message }`。密钥只经 stdin 与 stdout：不进命令行参数、
 * 环境变量与日志；助手的 stderr 读掉丢弃。操作串行。
 *
 * 助手缺失、起不来、超时都报告 `unavailable`；绝不换成明文文件。
 */

/** 助手的命令。测试用 `{ command: process.execPath, args: [假助手脚本] }`。 */
export interface CredentialHelperCommand {
  command: string;
  args?: string[];
}

export interface KeychainCredentialStoreOptions {
  /** null：没有找到助手程序，每个操作都以 `unavailable` 失败。 */
  helper: CredentialHelperCommand | null;
  /** 一个操作的期限。系统可能弹出授权提示等用户回应，所以默认较长（60 秒）。 */
  timeoutMs?: number;
}

type Op = 'get' | 'set' | 'delete' | 'has';

const HELPER_ERRORS = new Set(['not-found', 'denied', 'unavailable', 'unsupported', 'internal']);
const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

interface HelperResponse {
  ok: boolean;
  secret?: unknown;
  exists?: unknown;
  error?: unknown;
  message?: unknown;
}

export class KeychainCredentialStore implements CredentialStore {
  readonly kind = 'keychain' as const;
  readonly #helper: CredentialHelperCommand | null;
  readonly #timeoutMs: number;
  #chain: Promise<unknown> = Promise.resolve();

  constructor(options: KeychainCredentialStoreOptions) {
    this.#helper = options.helper;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async get(key: string): Promise<string | null> {
    checkCredentialKey(key);
    const response = await this.#call('get', key);
    if (!response.ok) return null;
    if (typeof response.secret !== 'string' || !response.secret) throw new CredentialStoreError('internal', SC.helperBadResponse().text);
    return response.secret;
  }

  async set(key: string, secret: string): Promise<void> {
    checkCredentialKey(key);
    checkCredentialSecret(secret);
    const response = await this.#call('set', key, secret);
    if (!response.ok) throw new CredentialStoreError('internal', SC.helperBadResponse().text);
  }

  async delete(key: string): Promise<void> {
    checkCredentialKey(key);
    await this.#call('delete', key);
  }

  async has(key: string): Promise<boolean> {
    checkCredentialKey(key);
    const response = await this.#call('has', key);
    if (typeof response.exists !== 'boolean') throw new CredentialStoreError('internal', SC.helperBadResponse().text);
    return response.exists;
  }

  /** 串行地跑一个操作。`not-found` 以 `{ ok: false }` 返回（`get` 与 `delete` 据此处理），其余错误抛出。 */
  #call(op: Op, key: string, secret?: string): Promise<HelperResponse> {
    const next = this.#chain.then(() => this.#run(op, key, secret));
    this.#chain = next.catch(() => {});
    return next;
  }

  #run(op: Op, key: string, secret?: string): Promise<HelperResponse> {
    const helper = this.#helper;
    if (!helper) return Promise.reject(new CredentialStoreError('unavailable', SC.helperNotFound().text));
    const request = `${JSON.stringify(secret === undefined ? { op, key } : { op, key, secret })}\n`;
    return new Promise<HelperResponse>((resolve, reject) => {
      let settled = false;
      const chunks: Buffer[] = [];
      let size = 0;
      const child = spawn(helper.command, helper.args ?? [], { stdio: ['pipe', 'pipe', 'pipe'] });
      const finish = (outcome: { response: HelperResponse } | { error: CredentialStoreError }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        if ('response' in outcome) resolve(outcome.response);
        else reject(outcome.error);
      };
      const timer = setTimeout(
        () => finish({ error: new CredentialStoreError('unavailable', SC.helperTimedOut({ seconds: Math.round(this.#timeoutMs / 1000) }).text) }),
        this.#timeoutMs,
      );
      child.once('error', (error: NodeJS.ErrnoException) => {
        const reason = error.code === 'ENOENT' ? SC.helperMissing().text : SC.helperStartFailed({ code: error.code ?? 'unknown' }).text;
        finish({ error: new CredentialStoreError('unavailable', reason) });
      });
      // 助手的 stderr 可能有系统的诊断：读掉，不记录。
      child.stderr.resume();
      child.stdin.on('error', () => {});
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) finish({ error: new CredentialStoreError('internal', SC.helperResponseTooLong().text) });
        else chunks.push(chunk);
      });
      child.once('close', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const line = text.split('\n', 1)[0]!.trim();
        if (!line) {
          finish({ error: new CredentialStoreError('unavailable', SC.helperExitedSilently().text) });
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          finish({ error: new CredentialStoreError('internal', SC.helperBadResponse().text) });
          return;
        }
        finish(interpret(op, parsed, secret));
      });
      child.stdin.end(request);
    });
  }
}

function interpret(op: Op, value: unknown, secret: string | undefined): { response: HelperResponse } | { error: CredentialStoreError } {
  if (typeof value !== 'object' || value === null || typeof (value as HelperResponse).ok !== 'boolean') {
    return { error: new CredentialStoreError('internal', SC.helperBadResponse().text) };
  }
  const response = value as HelperResponse;
  if (response.ok) return { response };
  const code = typeof response.error === 'string' && HELPER_ERRORS.has(response.error) ? response.error : 'internal';
  if (code === 'not-found' && (op === 'get' || op === 'delete')) return { response: { ok: false } };
  const mapped: CredentialErrorCode = code === 'not-found' ? 'internal' : (code as CredentialErrorCode);
  return { error: new CredentialStoreError(mapped, helperMessage(response.message, secret)) };
}

/** 助手给的说明：截短，并且万一含有这次的密钥也去掉。 */
function helperMessage(message: unknown, secret: string | undefined): string {
  let text = typeof message === 'string' && message.trim() ? message.trim().slice(0, 300) : SC.helperReportedError().text;
  if (secret) text = text.split(secret).join(SC.redacted().text);
  return text;
}
