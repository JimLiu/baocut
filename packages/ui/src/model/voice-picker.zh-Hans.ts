import type { VoicePickerMessages } from './voice-picker.ts';

export const zhHans: VoicePickerMessages = {
  clonedOn: (provider) => `已克隆到 ${provider} · 用这家的克隆合成`,
  defaultVoice: '默认音色',
  providerPreset: (provider, name) => `${provider} 的 ${name}`,
  loadingMine: '正在读取我的声音…',
  cloneNew: '克隆新音色…',
  cloneNewHint: '去设置 › 模型 › 语音合成 › 我的声音录一段或从文件导入',
  myVoices: '我的声音',
  providerVoices: (provider) => `${provider} 的音色`,
  customVoice: '手填音色 ID…',
  customVoiceHint: '服务商账号里的音色 ID',
  tempReference: '临时用一段录音…',
  tempReferenceHint: '这一版的合成接口还不收临时参考音频 · 先存进我的声音再克隆',
  other: '其他',
  voiceDeleted: '这只音色已经删了 · 换一只，或退回默认',
  customLine: '原样交给服务商，由它核对；克隆的音色也可以在我的声音里建好再选',
  presetLine: (provider, voiceId) => (voiceId === null ? `${provider} 的音色` : `${provider} 的音色 · ${voiceId}`),
  defaultLine: (provider, name) => `不选就用 ${provider} 的默认音色（${name}）`,
  noDefault: '这只模型没有默认音色，先选一个',
};
