import type { Id, RuntimeInfo, Seq } from './domain.ts';
import type { Topic } from './events.ts';
import { localizeText, refOf, type Localized, type MessageRef } from './message-ref.ts';
import './messages/index.ts';

/** 业务协议版本（`eventProtocolVersion`，架构设计 §13.3）。与 Runtime 版本独立演进。 */
export const PROTOCOL_VERSION = '0.6';
export const RUNTIME_VERSION = '0.5.0';

export type ClientKind = 'desktop' | 'cli' | 'agent';

/**
 * 连接的第一帧。令牌只在这里出现，不放进 URL（架构设计 §4.2、§12.2）。
 */
export interface HelloFrame {
  type: 'hello';
  protocolVersion: string;
  token: string;
  client: { kind: ClientKind; name: string; version: string };
}

export interface RequestFrame {
  type: 'request';
  id: string;
  method: string;
  params: unknown;
}

export type ClientFrame = HelloFrame | RequestFrame;

export interface WelcomeFrame {
  type: 'welcome';
  runtime: RuntimeInfo;
  connectionId: Id;
}

export interface ResponseFrame {
  type: 'response';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: RpcErrorPayload;
}

export interface EventFrame {
  type: 'event';
  topic: Topic;
  seq: Seq;
  event: unknown;
}

/** 连接级错误（握手失败、协议不兼容）。发完即关闭连接。 */
export interface FatalFrame {
  type: 'fatal';
  error: RpcErrorPayload;
}

export type ServerFrame = WelcomeFrame | ResponseFrame | EventFrame | FatalFrame;

/**
 * 错误合同。错误必须说明真实状态，不能用一个「失败」盖住所有情况
 * （文档约定「合同的状态」）。
 */
export type RpcErrorCode =
  | 'unauthenticated'
  | 'protocol-mismatch'
  | 'invalid-request'
  | 'unknown-method'
  | 'not-found'
  | 'forbidden'
  | 'conflict'
  | 'driver-unavailable'
  | 'driver-failed'
  | 'busy'
  /** 方法与参数都合法，但这个版本还做不到（例如还没接上的附件通道）；不是参数错。 */
  | 'unsupported'
  /** 视频引擎进程不可用（没有构建、启动失败或崩溃后正在重启）。 */
  | 'engine-unavailable'
  | 'internal';

export interface RpcErrorPayload {
  code: RpcErrorCode;
  /** 发出时 Runtime 当前语言的文字。 */
  message: string;
  /** `message` 的消息引用（message-ref.ts）：客户端按自己的语言重新生成。第三方原话、旧版本发来的错误没有。 */
  messageRef?: MessageRef;
  details?: unknown;
}

export class RpcError extends Error {
  readonly code: RpcErrorCode;
  readonly details: unknown;
  readonly messageRef: MessageRef | undefined;

  /** `message` 给 `Localized`（`defineCatalog` 的文案）时带上引用，客户端按自己的语言显示。 */
  constructor(code: RpcErrorCode, message: string | Localized, details?: unknown, messageRef?: MessageRef) {
    super(String(message));
    this.name = 'RpcError';
    this.code = code;
    this.details = details;
    this.messageRef = typeof message === 'string' ? messageRef : refOf(message);
  }

  toPayload(): RpcErrorPayload {
    return {
      code: this.code,
      message: this.message,
      ...(this.messageRef ? { messageRef: this.messageRef } : {}),
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }

  /** 收到的错误：有能认出的引用时 `message` 换成本进程当前语言的文字。 */
  static from(payload: RpcErrorPayload): RpcError {
    return new RpcError(payload.code, localizeText(payload.message, payload.messageRef), payload.details, payload.messageRef);
  }
}
