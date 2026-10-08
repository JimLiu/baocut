import { RcAgentTools } from '@baocut/protocol/messages/runtime-core';
import crypto from 'node:crypto';
import { newId, type Id } from '@baocut/protocol';
import type { AgentToolAccess, ToolGrant } from '@baocut/harness';
import type { TrustedPrincipal } from '../gateway.ts';

/** 工具调用的身份：哪个会话的智能体（架构设计 §4.2）。 */
export interface AgentPrincipal extends TrustedPrincipal {
  kind: 'agent';
  conversationId: Id;
}

/**
 * 工具通道的授权（架构设计 §3.5、§12.5）。每个原生会话一枚随机令牌，只认会话、不带权限：
 * 能做什么在每次调用时按会话当前的任务判断。会话关闭时收回令牌，并让它打开的视频按宽限期关闭。
 */
export class AgentGrants implements AgentToolAccess {
  readonly #byToken = new Map<string, AgentPrincipal>();
  readonly #onRevoke: (principal: AgentPrincipal) => void;
  readonly #extra: ((conversationId: Id) => Promise<string>) | null;
  #endpoint: string | null = null;
  #instructions: string | null = null;

  /** `sessionInstructions`：每个原生会话开始时附在指导后面的一段（开着的 skill 的索引，§3.8）。 */
  constructor(onRevoke: (principal: AgentPrincipal) => void, sessionInstructions?: (conversationId: Id) => Promise<string>) {
    this.#onRevoke = onRevoke;
    this.#extra = sessionInstructions ?? null;
  }

  /**
   * 每个原生会话的开发者指导（§3.8）：说明书按工具桥面渲染的「工作方式」段（`guidance.ts`）。工具目录建好之后才渲染得出来，
   * 由 Runtime 在开会话之前设上；没设就开会话是装配错误，直接抛错，不带着空指导开会话。
   */
  get instructions(): string {
    if (this.#instructions === null) throw new Error(RcAgentTools.instructionsNotSet().text);
    return this.#instructions;
  }

  setInstructions(text: string): void {
    this.#instructions = text;
  }

  sessionInstructions(conversationId: Id): Promise<string> {
    return this.#extra ? this.#extra(conversationId) : Promise.resolve('');
  }

  /** 网关监听之后才知道地址。 */
  setEndpoint(url: string): void {
    this.#endpoint = url;
  }

  grant(conversationId: Id): ToolGrant {
    if (!this.#endpoint) return { mcpServers: {}, revoke() {} };
    const token = crypto.randomBytes(32).toString('base64url');
    const principal: AgentPrincipal = { connectionId: newId('agt'), kind: 'agent', name: conversationId, conversationId };
    this.#byToken.set(token, principal);
    let revoked = false;
    return {
      mcpServers: { baocut: { url: this.#endpoint, headers: { Authorization: `Bearer ${token}` } } },
      revoke: () => {
        if (revoked) return;
        revoked = true;
        this.#byToken.delete(token);
        this.#onRevoke(principal);
      },
    };
  }

  /** `Authorization: Bearer <令牌>` → 身份；不认识或已收回时为空。 */
  resolve(authorization: string | undefined): AgentPrincipal | null {
    const match = /^Bearer\s+(\S+)$/.exec(authorization ?? '');
    return match ? (this.#byToken.get(match[1]!) ?? null) : null;
  }
}
