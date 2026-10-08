import type { TtsQuickTestMessages } from './tts-quick-test-copy.ts';

export const zhHans: TtsQuickTestMessages = {
  kindIntro: '介绍',
  kindNumbers: '数字',
  kindMood: '语气',

  presetSub: {
    Vivian: '女声 · 明亮',
    Serena: '女声 · 沉稳',
    Uncle_Fu: '男声 · 低沉',
    Dylan: '男声 · 青年',
    Eric: '男声 · 播音',
    Ryan: '男声 · 轻快',
    Aiden: '男声 · 叙事',
    Ono_Anna: '女声 · 日语',
    Sohee: '女声 · 韩语',
  },

  builtinVoice: {
    'zh-female': '中文女声',
    'zh-male': '中文男声',
    'en-female': '英语女声',
    'en-male': '英语男声',
    'ja-female': '日语女声',
    'ja-male': '日语男声',
    'es-female': '西班牙语女声',
    'es-male': '西班牙语男声',
  },
  builtinCredit: 'FLEURS 语料（CC BY 4.0）与 CMU ARCTIC · 经裁剪与响度归一 · 保留原始声明',

  describeWarm: '温暖女声',
  describeWarmText: '温暖、亲切的成年女声，语速适中，像在和朋友聊天',
  describeAnchor: '沉稳男声',
  describeAnchorText: '沉稳、清晰的成年男声，播音腔，节奏平稳',
  describeBright: '明快少年',
  describeBrightText: '明快、有活力的少年声音，语气轻松',

  toneUpbeat: '热情洋溢',
  toneUpbeatText: '用热情洋溢、充满活力的语气，语速略快',
  toneNatural: '自然',
  toneAnchor: '沉稳',
  toneAnchorText: '用沉稳、清晰的播音腔，节奏平稳',
  toneSoft: '轻声',
  toneSoftText: '放轻声音，语速放慢，像在近处轻声说话',

  customDescribe: '自己描述',
  defaultVoice: '默认音色',
  myVoices: '我的声音',
  fileVoice: '临时用一段',
  seconds: (n: string) => `${n} 秒`,

  textRequired: '先输入要合成的文本',
  textTooLong: (max: number) => `一次最多 ${max} 字，试听用短一点的句子`,
  describeRequired: '先用一句话描述想要的声音',
  myVoiceGone: '这只音色已经不在「我的声音」里了，换一只',
  referenceRequired: '先选一段参考录音，或换回内置音色',

  phaseSubmitting: '提交中',
  phaseQueued: '排队中',
  phaseLoading: '加载模型',
  phaseGeneratingStep: (step: number, total: number) => `生成音频 · 第 ${step}/${total} 步`,
  phaseGenerating: '生成音频',
  phaseWriting: '写出音频',
  phasePreparing: '准备中',

  sampleVoice: (name: string) => `示例 · ${name}`,
  customText: '自定义文本',
  elapsed: (seconds: string) => `用时 ${seconds} 秒`,
  audioLength: (seconds: string) => `音频 ${seconds} 秒`,
};
