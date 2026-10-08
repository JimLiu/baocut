import type { VoicePickerMessages } from './voice-picker.ts';

export const zhHant: VoicePickerMessages = {
  clonedOn: (provider) => `已在 ${provider} 上克隆 · 使用這個克隆合成`,
  defaultVoice: '預設音色',
  providerPreset: (provider, name) => `${provider} 的 ${name}`,
  loadingMine: '正在載入「我的音色」…',
  cloneNew: '克隆新音色…',
  cloneNewHint: '到「設定 › 模型 › 語音合成 › 我的音色」錄製一段，或從檔案匯入',
  myVoices: '我的音色',
  providerVoices: (provider) => `${provider} 的音色`,
  customVoice: '輸入音色 ID…',
  customVoiceHint: '供應商帳號中的音色 ID',
  tempReference: '臨時使用一段錄音…',
  tempReferenceHint: '這個版本的合成 API 還不接受臨時參考錄音 · 請先存到「我的音色」再克隆',
  other: '其他',
  voiceDeleted: '這個音色已刪除 · 請換一個，或改回預設',
  customLine: '原樣交給供應商核對；也可以先在「我的音色」中建立克隆音色再選擇',
  presetLine: (provider, voiceId) => (voiceId === null ? `${provider} 的音色` : `${provider} 的音色 · ${voiceId}`),
  defaultLine: (provider, name) => `不選擇時，使用 ${provider} 的預設音色（${name}）`,
  noDefault: '這個模型沒有預設音色，請先選擇一個',
};
