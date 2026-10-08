import { HOME_STARTER_COPY } from '../copy.ts';

/**
 * 起始页「快捷开始」那一行（产品设计 §3.2.1；原型 model-newproject.js `homeStarters`）：处理已有视频或音频的几件常见事。
 * 点一下只把一句提示词放进输入框，不发送、不展开表单；那句话进了输入框就是用户自己的话，可以改，素材照常从「+」或拖放加。
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

export function homeStarters(): HomeStarter[] {
  return STARTER_KEYS.map(starterOf);
}

export function starterOf(key: StarterKey): HomeStarter {
  const copy = HOME_STARTER_COPY[key];
  return { key, title: copy.title, prompt: copy.prompt, tip: HOME_STARTER_COPY.tip(copy.needs) };
}
