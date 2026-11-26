import crypto from 'node:crypto';
import { WEB_ACCESS_CODE_TTL_MS, WEB_REVIEW_SESSION_TTL_MS, WEB_SESSION_TTL_MS, newId, nowIso, type WebSession } from '@baocut/protocol';

/**
 * Web 服务的登录状态（架构设计 §4.8、§12.8）：访问链接里的一次性代码与浏览器会话，只在内存里。
 *
 * - 代码是 32 字节随机数的 base64url，只存 `sha256`；第一次尝试兑换时就作废（成不成功都一样），到期也作废；
 *   同时有效的代码有上限，超过时丢掉最早发的。
 * - 会话令牌是 `<sessionId>.<secret>`，`secret` 同样 32 字节、只存哈希，比较用 `timingSafeEqual`；令牌只在 cookie 里。
 * - 审片会话（`openReview`）由审片链接的密钥换来，只能看 `videos` 里的视频；同一个浏览器再打开另一部视频的审片链接时，
 *   视频加进同一个会话。完整会话的 `videos` 为 null。审片会话另记它自己起的导出（`exports`），只有这些它看得到、取消得了。
 * - 服务停止时全部清空：令牌在服务每次启动时重新生成（§12.8）。
 */

const SECRET_BYTES = 32;
const MAX_CODES = 20;
const USER_AGENT_MAX = 200;

interface StoredSession {
  sessionId: string;
  hash: Buffer;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: number;
  userAgent: string | null;
  connections: number;
  /** 审片会话能看的视频；完整会话为 null。 */
  videos: Set<string> | null;
  /** 审片会话起的导出任务（`jobId`）；完整会话不记。 */
  exports: Set<string>;
}

/** 一个审片会话最多记这么多条导出，超过时丢掉最早的（它们照旧在任务列表里，只是这个页面不再看得到）。 */
const MAX_REVIEW_EXPORTS = 200;

export interface WebSessionsOptions {
  codeTtlMs?: number;
  sessionTtlMs?: number;
  reviewTtlMs?: number;
}

export class WebSessions {
  readonly codeTtlMs: number;
  readonly sessionTtlMs: number;
  readonly reviewTtlMs: number;
  /** sha256(代码) → 到期时间。按插入顺序，最早的在前。 */
  readonly #codes = new Map<string, number>();
  readonly #sessions = new Map<string, StoredSession>();

  constructor(options: WebSessionsOptions = {}) {
    this.codeTtlMs = options.codeTtlMs ?? WEB_ACCESS_CODE_TTL_MS;
    this.sessionTtlMs = options.sessionTtlMs ?? WEB_SESSION_TTL_MS;
    this.reviewTtlMs = options.reviewTtlMs ?? WEB_REVIEW_SESSION_TTL_MS;
  }

  /** 发一个一次性代码。明文只在这里返回。 */
  issueCode(): { code: string; expiresAt: string } {
    this.#prune();
    while (this.#codes.size >= MAX_CODES) {
      const oldest = this.#codes.keys().next().value;
      if (oldest === undefined) break;
      this.#codes.delete(oldest);
    }
    const code = crypto.randomBytes(SECRET_BYTES).toString('base64url');
    const expiresAt = Date.now() + this.codeTtlMs;
    this.#codes.set(hashText(code), expiresAt);
    return { code, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** 用代码换一个会话。代码不认识、已用过或已过期时为 null；无论结果如何，这个代码从此作废。 */
  exchange(code: string, userAgent: string | undefined): { sessionId: string; token: string; maxAgeSec: number } | null {
    const key = hashText(code);
    const expiresAt = this.#codes.get(key);
    this.#codes.delete(key);
    if (expiresAt === undefined || expiresAt <= Date.now()) return null;
    return this.#create(null, this.sessionTtlMs, userAgent);
  }

  /**
   * 审片链接的密钥核对过之后：浏览器已有的审片会话（`token`，审片 cookie 里的）还有效就把视频加进去、沿用它，否则另开一个。
   * 返回的 `token` 为 null 时沿用原来的 cookie。
   */
  openReview(videoId: string, token: string | null, userAgent: string | undefined): { sessionId: string; token: string | null; maxAgeSec: number } {
    const existing = token ? this.verify(token) : null;
    const session = existing ? this.#sessions.get(existing) : undefined;
    if (session?.videos) {
      session.videos.add(videoId);
      return { sessionId: session.sessionId, token: null, maxAgeSec: Math.floor((session.expiresAt - Date.now()) / 1000) };
    }
    return this.#create(new Set([videoId]), this.reviewTtlMs, userAgent);
  }

  /** 会话能看的视频：完整会话为 null，没有这个会话时是空集。 */
  scope(sessionId: string): ReadonlySet<string> | null {
    const session = this.#sessions.get(sessionId);
    return session ? session.videos : new Set();
  }

  /** 审片会话起了一条导出：记下来，之后 `exports.get`、`jobs.cancel` 与下载只认这些。完整会话或会话不在时什么也不做。 */
  addExport(sessionId: string, jobId: string): void {
    const session = this.#sessions.get(sessionId);
    if (!session?.videos) return;
    session.exports.add(jobId);
    while (session.exports.size > MAX_REVIEW_EXPORTS) {
      const oldest = session.exports.values().next().value;
      if (oldest === undefined) break;
      session.exports.delete(oldest);
    }
  }

  /** 这个会话能不能看这条导出：完整会话都能；审片会话只有它自己起的。 */
  ownsExport(sessionId: string, jobId: string): boolean {
    const session = this.#sessions.get(sessionId);
    if (!session) return false;
    return session.videos === null || session.exports.has(jobId);
  }

  #create(videos: Set<string> | null, ttlMs: number, userAgent: string | undefined): { sessionId: string; token: string; maxAgeSec: number } {
    const sessionId = newId('wses');
    const secret = crypto.randomBytes(SECRET_BYTES);
    const now = nowIso();
    this.#sessions.set(sessionId, {
      sessionId,
      hash: crypto.createHash('sha256').update(secret).digest(),
      createdAt: now,
      lastUsedAt: now,
      expiresAt: Date.now() + ttlMs,
      userAgent: userAgent ? userAgent.slice(0, USER_AGENT_MAX) : null,
      connections: 0,
      videos,
      exports: new Set(),
    });
    return { sessionId, token: `${sessionId}.${secret.toString('base64url')}`, maxAgeSec: Math.floor(ttlMs / 1000) };
  }

  /** 会话令牌 → 会话 ID；不认识、已吊销、已过期或写法不规范时为 null。记下最近使用的时间。 */
  verify(token: string): string | null {
    const dot = token.indexOf('.');
    if (dot <= 0) return null;
    const session = this.#sessions.get(token.slice(0, dot));
    const text = token.slice(dot + 1);
    const secret = Buffer.from(text, 'base64url');
    if (!session || secret.length !== SECRET_BYTES || secret.toString('base64url') !== text) return null;
    const actual = crypto.createHash('sha256').update(secret).digest();
    if (!crypto.timingSafeEqual(actual, session.hash)) return null;
    if (session.expiresAt <= Date.now()) {
      this.#sessions.delete(session.sessionId);
      return null;
    }
    session.lastUsedAt = nowIso();
    return session.sessionId;
  }

  /** 会话还有效（连接上的每个请求都查一次：过期的会话不再执行任何方法）。 */
  alive(sessionId: string): boolean {
    const session = this.#sessions.get(sessionId);
    if (!session) return false;
    if (session.expiresAt > Date.now()) return true;
    this.#sessions.delete(sessionId);
    return false;
  }

  connected(sessionId: string, delta: 1 | -1): void {
    const session = this.#sessions.get(sessionId);
    if (session) session.connections = Math.max(0, session.connections + delta);
  }

  revoke(sessionId: string): boolean {
    return this.#sessions.delete(sessionId);
  }

  list(): WebSession[] {
    this.#prune();
    return [...this.#sessions.values()].map((s) => ({
      sessionId: s.sessionId,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      expiresAt: new Date(s.expiresAt).toISOString(),
      connections: s.connections,
      userAgent: s.userAgent,
      ...(s.videos ? { videos: [...s.videos] } : {}),
    }));
  }

  clear(): void {
    this.#codes.clear();
    this.#sessions.clear();
  }

  #prune(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.#codes) if (expiresAt <= now) this.#codes.delete(key);
    for (const [id, session] of this.#sessions) if (session.expiresAt <= now) this.#sessions.delete(id);
  }
}

function hashText(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}
