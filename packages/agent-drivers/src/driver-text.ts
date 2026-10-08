import { refOf, type DriverInstallOption, type Localized, type MessageRef } from '@baocut/protocol';
import { DriversCommon } from '@baocut/protocol/messages/agent-drivers';

/**
 * Driver 发出的给人看的文字：BaoCut 自己写的是 `Localized`（当前语言的文字 + 消息引用，message-ref.ts），
 * Agent 或第三方 CLI 的原话是字符串。发事件、写探测结果时文字照旧放在 `message` / `error` / `detail` 里，
 * 是 `Localized` 的另外带上 `xxxRef`，界面按自己的语言重新生成。
 */
export type DriverText = Localized | string;

export function isLocalized(value: unknown): value is Localized {
  return typeof value === 'object' && value !== null && typeof (value as Localized).key === 'string';
}

/** 文字本身（当前语言）。 */
export function textOf(value: DriverText): string;
export function textOf(value: DriverText | null | undefined): string | null;
export function textOf(value: DriverText | null | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** `{ [key]: 引用 }`；不是 `Localized`（原话、空）时是空对象，展开后不留 `undefined` 的键。 */
export function refField<K extends string>(key: K, value: DriverText | null | undefined): { [P in K]?: MessageRef } {
  return isLocalized(value) ? ({ [key]: refOf(value) } as { [P in K]?: MessageRef }) : {};
}

/** 官方脚本的安装方式：名字是 BaoCut 写的文字，同时给 `labelRef`。用的时候再调，不存进模块顶层的常量。 */
export function officialScript(command: string, upgrade: string): DriverInstallOption {
  const label = DriversCommon.officialScript();
  return { kind: 'script', label: String(label), labelRef: refOf(label), needs: null, command, upgrade };
}

/** 带消息引用的 Error：BaoCut 写的原因（例如进程退出），之后作为事件的 `error` / `message` 发出时带上引用。 */
export class LocalizedError extends Error {
  readonly messageRef: MessageRef;

  constructor(text: Localized) {
    super(String(text));
    this.name = 'LocalizedError';
    this.messageRef = refOf(text);
  }
}

/** 错误的引用字段：`LocalizedError` 带引用，别的（Agent 的原话）是空对象。 */
export function errorRefField<K extends string>(key: K, error: unknown): { [P in K]?: MessageRef } {
  return error instanceof LocalizedError ? ({ [key]: error.messageRef } as { [P in K]?: MessageRef }) : {};
}
