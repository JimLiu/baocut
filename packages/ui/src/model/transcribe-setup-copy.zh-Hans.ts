import type { TranscribeSetupMessages } from './transcribe-setup-copy.ts';

export const zhHans: TranscribeSetupMessages = {
  notConnected: '没有连上',
  unavailable: '不可用',
  autoDetect: '自动检测',
  hintNoModel: '还不知道这次用哪只语音模型：先在上面挑一只，才知道它收不收识别提示。',
  hintUnsupported: (model: string, alt: string | null) =>
    `${model} 不接受识别提示：术语表和提示词在这一步都用不上，转录时会略过。${alt ? `想在转录时就用上，换 ${alt}。` : ''}`,
  budget: (model: string, b: { custom: number; terms: number; chars: number; dropped: number }, max: number) => {
    const custom = b.custom ? `提示词 ${b.custom} 字` : '没有提示词';
    const dropped = b.dropped ? ` · 还有 ${b.dropped} 条放不下，排在前面的表先进` : '';
    return `送给 ${model}：${custom} + ${b.terms} 个写法 · 约 ${b.chars} / ${max} 字${dropped}`;
  },
  glossaryGone: '已经不在术语表库里 · 这次不用',
  glossaryTranslation: '是翻译术语表，转录用不上 · 这次不用',
  anyLanguage: '不限语言',
  termCount: (count: number) => `${count} 条`,
  noDefaultModel: '还没有默认的语音模型',
  defaultModel: (label: string) => `${label}（默认）`,
  autoDetectLanguage: '自动检测语言',
  glossaries: (count: number) => `${count} 张术语表`,
  hasPrompt: '有提示词',
  noDefaultFacts: '还没有默认的语音模型：挑一只，或去模型页设一个默认值。不挑直接开始时会告诉你缺什么。',
  modelUnusable: '这只模型现在不能用',
  acceptsHint: '收识别提示',
  noHint: '不收识别提示',
  followDefault: (facts: string) => `跟随默认 · ${facts}`,
};
