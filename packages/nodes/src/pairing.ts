import crypto from 'node:crypto';

/**
 * 配对与令牌（节点协议规范 §4）。
 *
 * - 配对码：6 位十进制数字（`crypto.randomInt`），默认 10 分钟有效，一次性。配对码与锁定只在内存里。
 * - 任意来源累计输错 5 次：锁定 10 分钟，当前配对码作废。`newCode()` 作废旧码、解除锁定并清零计数。
 * - 令牌：`<clientId>.<secret>`，`secret` 是 32 字节随机数的 base64url。只保存每个客户端的盐与 `sha256(盐 ‖ secret)`，
 *   比较用 `crypto.timingSafeEqual`。同一个 `clientId` 再次配对替换原来的令牌。
 *
 * 令牌与配对码不进日志：本模块不写日志，调用方也只记 `clientId`。
 */

export interface Clock {
  /** 毫秒时间戳。 */
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

/** 持久保存的已配对客户端（`node-share.json`）：没有令牌明文。 */
export interface PairedClient {
  clientId: string;
  name: string;
  /** base64 */
  salt: string;
  /** `sha256(盐 ‖ secret)` 的小写十六进制 */
  hash: string;
  pairedAt: string;
  lastSeenAt: string | null;
}

export interface PairingLimits {
  /** 配对码有效期（默认 10 分钟）。 */
  codeTtlMs: number;
  /** 输错多少次锁定（默认 5）。 */
  maxFailures: number;
  /** 锁定多久（默认 10 分钟）。 */
  lockMs: number;
}

export const DEFAULT_PAIRING_LIMITS: PairingLimits = { codeTtlMs: 10 * 60_000, maxFailures: 5, lockMs: 10 * 60_000 };

export type PairOutcome =
  | { ok: true; client: PairedClient; token: string }
  | { ok: false; code: 'PAIRING_CODE_INVALID' }
  | { ok: false; code: 'PAIRING_LOCKED'; retryAfterMs: number };

export type PairingState = { code: string; expiresAt: string } | { lockedUntil: string } | null;

const SECRET_BYTES = 32;

export class Pairing {
  readonly #clock: Clock;
  readonly #limits: PairingLimits;
  readonly #clients = new Map<string, PairedClient>();
  #code: { value: string; expiresAt: number } | null = null;
  #failures = 0;
  #lockedUntil: number | null = null;

  constructor(clients: readonly PairedClient[], options: { clock?: Clock; limits?: Partial<PairingLimits> } = {}) {
    this.#clock = options.clock ?? systemClock;
    this.#limits = { ...DEFAULT_PAIRING_LIMITS, ...options.limits };
    for (const client of clients) this.#clients.set(client.clientId, { ...client });
  }

  /** 作废旧配对码并生成新的，同时解除锁定、清零输错计数。 */
  newCode(): { code: string; expiresAt: string } {
    const value = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = this.#clock.now() + this.#limits.codeTtlMs;
    this.#code = { value, expiresAt };
    this.#failures = 0;
    this.#lockedUntil = null;
    return { code: value, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** 作废当前配对码（共享关闭时）。锁定不变。 */
  clearCode(): void {
    this.#code = null;
  }

  state(): PairingState {
    const now = this.#clock.now();
    this.#expire(now);
    if (this.#lockedUntil !== null) return { lockedUntil: new Date(this.#lockedUntil).toISOString() };
    if (this.#code) return { code: this.#code.value, expiresAt: new Date(this.#code.expiresAt).toISOString() };
    return null;
  }

  /** 用配对码换令牌。成功时配对码用掉；同一个 `clientId` 的旧令牌失效。 */
  pair(code: string, clientId: string, clientName: string): PairOutcome {
    const now = this.#clock.now();
    this.#expire(now);
    if (this.#lockedUntil !== null) return { ok: false, code: 'PAIRING_LOCKED', retryAfterMs: this.#lockedUntil - now };
    if (!this.#code || !sameCode(code, this.#code.value)) {
      this.#failures++;
      if (this.#failures >= this.#limits.maxFailures) {
        this.#lockedUntil = now + this.#limits.lockMs;
        this.#code = null;
        this.#failures = 0;
      }
      return { ok: false, code: 'PAIRING_CODE_INVALID' };
    }
    this.#code = null;
    this.#failures = 0;
    const secret = crypto.randomBytes(SECRET_BYTES);
    const salt = crypto.randomBytes(16);
    const client: PairedClient = {
      clientId,
      name: clientName,
      salt: salt.toString('base64'),
      hash: digest(salt, secret).toString('hex'),
      pairedAt: new Date(now).toISOString(),
      lastSeenAt: null,
    };
    this.#clients.set(clientId, client);
    return { ok: true, client: { ...client }, token: `${clientId}.${secret.toString('base64url')}` };
  }

  /** 验证令牌，返回它所属的客户端（并记下最近一次出现的时间）；无效或已吊销返回 null。 */
  verify(token: string): PairedClient | null {
    const dot = token.indexOf('.');
    if (dot <= 0) return null;
    const client = this.#clients.get(token.slice(0, dot));
    const text = token.slice(dot + 1);
    const secret = Buffer.from(text, 'base64url');
    // 只接受规范的 base64url：同一串字节只有一种写法。
    if (!client || secret.length !== SECRET_BYTES || secret.toString('base64url') !== text) return null;
    const expected = Buffer.from(client.hash, 'hex');
    const actual = digest(Buffer.from(client.salt, 'base64'), secret);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
    client.lastSeenAt = new Date(this.#clock.now()).toISOString();
    return { ...client };
  }

  revoke(clientId: string): boolean {
    return this.#clients.delete(clientId);
  }

  has(clientId: string): boolean {
    return this.#clients.has(clientId);
  }

  clients(): PairedClient[] {
    return [...this.#clients.values()].map((c) => ({ ...c }));
  }

  #expire(now: number): void {
    if (this.#lockedUntil !== null && now >= this.#lockedUntil) {
      this.#lockedUntil = null;
      this.#failures = 0;
    }
    if (this.#code && now >= this.#code.expiresAt) this.#code = null;
  }
}

function digest(salt: Buffer, secret: Buffer): Buffer {
  return crypto.createHash('sha256').update(salt).update(secret).digest();
}

/** 常量时间比较配对码（长度不同直接不等：长度不是秘密）。 */
function sameCode(given: string, expected: string): boolean {
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
