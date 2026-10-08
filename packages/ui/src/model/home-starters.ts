import { HOME_STARTER_COPY } from '../copy.ts';
import { fillSlot, filledSlot, slotLabels } from './prompt-slots.ts';

/**
 * 起始页「快捷开始」那一行（产品设计 §3.2.1；原型 model-newproject.js `homeStarters`）：处理已有视频或音频的几件常见事。
 * 点一下只把一句提示词放进输入框，不发送、不展开表单；那句话进了输入框就是用户自己的话，可以改，素材照常从「+」或拖放加，
 * 也可以贴一条视频链接（下载工具能取的页面地址）。
 *
 * 「转录并翻译」翻成哪门语言没有缺省：上次填过就沿用（state/home-memory-store.ts），没填过留一个待填项（模板包规范 §5.5），
 * 不填也能发送，交给 Agent 的是 `[目标语言]`，由它先问。
 */

export type StarterKey = 'sub' | 'trans' | 'clean' | 'a2v';

export interface HomeStarter {
  key: StarterKey;
  title: string;
  prompt: string;
  /** 悬停说明：填入之后还要做什么。 */
  tip: string;
}

/** 这一行的顺序（原型同序）。 */
export const STARTER_KEYS: readonly StarterKey[] = ['sub', 'trans', 'clean', 'a2v'];

/** `target`：上次「转录并翻译」填的目标语言（用户的原话）；没有时那句话留待填项。 */
export function homeStarters(target: string | null = null): HomeStarter[] {
  return STARTER_KEYS.map((key) => starterOf(key, target));
}

export function starterOf(key: StarterKey, target: string | null = null): HomeStarter {
  const copy = HOME_STARTER_COPY[key];
  const slot = slotLabels(copy.prompt)[0];
  const prompt = slot && target?.trim() ? fillSlot(copy.prompt, slot, target.trim()) : copy.prompt;
  return { key, title: copy.title, prompt, tip: HOME_STARTER_COPY.tip(copy.needs, copy.link) };
}

/** 发送的那句话里「转录并翻译」的目标语言填成了什么（记下来下次沿用）；不是那句话、改得认不出或还没填时为 null。 */
export function starterTarget(text: string): string | null {
  const template = HOME_STARTER_COPY.trans.prompt;
  const slot = slotLabels(template)[0];
  return slot ? filledSlot(template, slot, text) : null;
}
