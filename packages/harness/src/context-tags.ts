/*
 * 交给智能体的文字里，`<baocut-…>` 段是 BaoCut 附上的上下文（编辑器状态、Space 引用、各种标注、品牌），模型按标签名认它们
 * （skills/baocut/SKILL.md 写明了每一种）。用户写的内容——消息正文、批注、视频与条目的名字、BRAND.md——里出现的同名标签先转义，
 * 不能冒充这些段或提前把它们闭合（架构设计 §3.4）。只转义 `<baocut-` 与 `</baocut-` 开头的标签，别的尖括号原样。
 */

const CONTEXT_TAG = /<(\/?baocut-)/gi;

/** 把用户写的内容里的 `<baocut-…>`、`</baocut-…>` 写成 `&lt;baocut-…`。 */
export function escapeContextTags(text: string): string {
  return text.replace(CONTEXT_TAG, '&lt;$1');
}

/** 一段上下文：开标签、正文、闭标签各占一行；正文先 `escapeContextTags`。 */
export function contextBlock(open: string, body: readonly string[], close: string): string {
  return [open, ...body.map(escapeContextTags), close].join('\n');
}
