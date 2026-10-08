import { getLocale, type Translations } from './i18n.ts';

/**
 * 可本地化的文字（架构设计 §5.10、命令与协议规范 §11.3）：Runtime 给人看的文字除了当下语言的文本，还带一个消息引用
 * （`key` + `params`），记录与事件里一起存下。界面按自己的当前语言用引用重新生成文字，所以切换语言后已经存下的错误原因、
 * 任务说明也跟着换；引用认不出（更新的 Runtime 发来的新键）或没有引用（旧记录、第三方原话）时照用文本。
 *
 * 约定：带文字的字段 `foo` 旁边放 `fooRef?: MessageRef`（例如 `message` / `messageRef`、`detail` / `detailRef`）。
 */

/**
 * 参数：标量或另一条引用（嵌套的引用按读者的语言展开，认不出时用它生成时的 `text`）。供应商的原话、文件名这类内容照原样
 * 作为字符串参数。
 */
export type MessageParam = string | number | boolean | null | NestedRef;
export type NestedRef = MessageRef & { text?: string };

export interface MessageRef {
  /** `<区域>.<名字>`，例如 `jobs.modelLoadFailed`。发布后不改名、不复用。 */
  key: string;
  params?: Record<string, MessageParam>;
}

/** 一条已经按当前语言生成的文字，同时带着它的引用。`String(x)` 与模板字符串里得到 `text`。 */
export interface Localized extends MessageRef {
  readonly text: string;
  toString(): string;
}

type Entry = string | ((params: never) => string);
type ParamsOf<E> = E extends (params: infer P) => string ? P : never;
/** 调用方可以把嵌套的 `Localized` 传给声明为字符串的参数：引用里存引用，文本里用它的文字。 */
type ParamsIn<P> = { [K in keyof P]: P[K] | (string extends P[K] ? Localized : never) };
export type MessageBuilders<T> = {
  readonly [K in keyof T]: T[K] extends string ? () => Localized : (params: ParamsIn<ParamsOf<T[K]>>) => Localized;
};

const registry = new Map<string, { en: Record<string, Entry>; translations: Record<string, Record<string, Entry>> }>();

export function isMessageRef(value: unknown): value is MessageRef {
  return !!value && typeof value === 'object' && typeof (value as MessageRef).key === 'string';
}

function render(entry: Entry | undefined, params: Record<string, MessageParam> | undefined, locale: string): string | null {
  if (entry === undefined) return null;
  if (typeof entry === 'string') return entry;
  const plain: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(params ?? {})) plain[name] = isMessageRef(value) ? formatRef(value, (value as NestedRef).text ?? '', locale) : value;
  return (entry as (p: unknown) => string)(plain);
}

function lookup(key: string, locale: string): Entry | undefined {
  const dot = key.indexOf('.');
  const area = registry.get(key.slice(0, dot));
  if (!area) return undefined;
  const name = key.slice(dot + 1);
  return area.translations[locale]?.[name] ?? area.en[name];
}

/** 按读者的语言（缺省为当前语言）展开一条引用；认不出时用 `fallback`。 */
export function formatRef(ref: MessageRef, fallback: string, locale: string = getLocale()): string {
  try {
    return render(lookup(ref.key, locale), ref.params, locale) ?? fallback;
  } catch {
    return fallback;
  }
}

/** 字段 `text` 与它旁边的 `ref`：有能认出的引用就按当前语言重新生成，否则照用文本。 */
export function localizeText(text: string, ref?: MessageRef | null): string;
export function localizeText(text: string | null | undefined, ref?: MessageRef | null): string | null | undefined;
export function localizeText(text: string | null | undefined, ref?: MessageRef | null): string | null | undefined {
  return ref ? formatRef(ref, text ?? '') : text;
}

/**
 * 存下的文字与它旁边的引用拼回 `Localized`，可以再当嵌套参数传给目录文案（读者按自己的语言展开）。没有引用时就是文字本身。
 */
export function withRef(text: string, ref?: MessageRef | null): string | Localized {
  return ref ? { ...refOf(ref), text, toString: () => text } : text;
}

/** 只要引用（存盘、过线用），不要 `text` 与方法。 */
export function refOf(value: Localized | MessageRef): MessageRef {
  return value.params && Object.keys(value.params).length ? { key: value.key, params: value.params } : { key: value.key };
}

function nested(value: MessageRef & { text?: string }): NestedRef {
  const ref: NestedRef = refOf(value);
  if (typeof value.text === 'string') ref.text = value.text;
  return ref;
}

/**
 * 一个区域的 Runtime 文案目录：`defineCatalog('jobs', en, { 'zh-Hans': zh })`。返回每条文案的构造函数，调用得到 `Localized`
 * （当前语言的文字 + 引用）。目录在加载时登记，界面、CLI 与 Runtime 都经 `messages/index.ts` 加载全部目录。
 */
export function defineCatalog<T extends Record<string, Entry>>(area: string, en: T, translations: Translations<T>): MessageBuilders<T> {
  // 同名区域后登记的覆盖先登记的：开发时热更新会重新执行目录模块。
  registry.set(area, { en, translations: translations as unknown as Record<string, Record<string, Entry>> });
  const builders: Record<string, (params?: Record<string, unknown>) => Localized> = {};
  for (const name of Object.keys(en)) {
    const key = `${area}.${name}`;
    builders[name] = (params) => {
      const stored: Record<string, MessageParam> = {};
      for (const [k, v] of Object.entries(params ?? {})) stored[k] = isMessageRef(v) ? nested(v) : (v as MessageParam);
      const ref: MessageRef = Object.keys(stored).length ? { key, params: stored } : { key };
      const text = formatRef(ref, key);
      return { ...ref, text, toString: () => text };
    };
  }
  return builders as unknown as MessageBuilders<T>;
}
