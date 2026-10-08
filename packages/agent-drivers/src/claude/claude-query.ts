/*
 * 部分机制移植自 paseo（Apache-2.0，Copyright (c) 2025-present Mohamed Boudra），modified：
 * - packages/server/src/server/agent/providers/claude/agent.ts 的 createAsyncMessageInput（流式输入队列）
 * - packages/server/src/server/agent/providers/claude/query.ts 的 queryFactory 注入
 */
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { ModelInfo, Options, PermissionMode, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

/**
 * Driver 用到的那部分 `Query`。SDK 的 `query()` 返回值在结构上满足它；测试注入的假 Query
 * （`testing/fake-claude.ts`）只实现这些，不必追着 SDK 完整的 `Query` 类型走。
 */
export interface ClaudeQuery extends AsyncIterable<SDKMessage> {
  interrupt(): Promise<unknown>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  setModel(model?: string): Promise<void>;
  supportedModels(): Promise<ModelInfo[]>;
  close(): void;
}

export interface ClaudeQueryParams {
  prompt: AsyncIterable<SDKUserMessage>;
  options: Options;
}

/** 起一个 Query。默认用 SDK 的 `query()`；测试注入假的，不起进程、不登录。 */
export type ClaudeQueryFactory = (params: ClaudeQueryParams) => ClaudeQuery;

export const sdkQueryFactory: ClaudeQueryFactory = (params) => sdkQuery(params);

/**
 * 长驻 Query 的流式输入：一个可以随时 push 的队列。
 *
 * 整个会话只有这一条输入流。追加消息（steer）也 push 到这里，而不是另调 `Query.streamInput()`：
 * SDK 的 streamInput 在传入的 iterable 结束后会关掉 CLI 的 stdin，会话就再也收不到消息了。
 */
export interface MessageInput<T> {
  push(item: T): void;
  /** 结束输入：CLI 读到 stdin 结束后退出。 */
  end(): void;
  readonly iterable: AsyncIterable<T>;
}

export function createMessageInput<T>(): MessageInput<T> {
  const queue: T[] = [];
  const waiting: Array<(result: IteratorResult<T, undefined>) => void> = [];
  let closed = false;
  return {
    push(item) {
      if (closed) return;
      const resolve = waiting.shift();
      if (resolve) resolve({ value: item, done: false });
      else queue.push(item);
    },
    end() {
      closed = true;
      for (const resolve of waiting.splice(0)) resolve({ value: undefined, done: true });
    },
    iterable: {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          if (queue.length > 0) return Promise.resolve({ value: queue.shift()!, done: false });
          if (closed) return Promise.resolve({ value: undefined, done: true });
          return new Promise<IteratorResult<T, undefined>>((resolve) => waiting.push(resolve));
        },
      }),
    },
  };
}
