/**
 * `packages/agent-drivers` 给人看的文字（message-ref.ts）。每个区域一个 `<区域>.ts` 与它的译文 `<区域>.zh-Hans.ts`，在这里 export 登记。
 * 包外按 `@baocut/protocol/messages/agent-drivers` 引用。
 */
export * from './drivers-common.ts';
export * from './drivers-acp.ts';
export * from './drivers-claude.ts';
export * from './drivers-codex.ts';
export * from './drivers-opencode.ts';
export * from './drivers-pi.ts';
