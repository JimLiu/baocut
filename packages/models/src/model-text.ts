import { refOf, type Localized, type MessageRef } from '@baocut/protocol';

/**
 * 模型包与 Provider 给人看的文字（仓库约定 §5）：目录生成的 `Localized`（文本 + 消息引用），或照原样的字符串
 * （第三方原话、Worker 的报错）。错误类用它构造，记下 `messageRef`，任务记录与界面再按读者的语言重新生成。
 */
export type ModelText = string | Localized;

/** 文字的消息引用（字符串没有）。 */
export function modelTextRef(text: ModelText): MessageRef | undefined {
  return typeof text === 'string' ? undefined : refOf(text);
}

/** 文字与它的引用，存进带 `detail` / `detailRef` 的状态字段时用。 */
export function modelDetail(text: ModelText): { detail: string; detailRef?: MessageRef } {
  const ref = modelTextRef(text);
  return ref ? { detail: String(text), detailRef: ref } : { detail: String(text) };
}
