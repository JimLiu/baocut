import type { TtsQuickTestMessages } from './tts-quick-test-copy.ts';

export const zhHant: TtsQuickTestMessages = {
  kindIntro: '介紹',
  kindNumbers: '數字',
  kindMood: '語氣',

  presetSub: {
    Vivian: '女聲 · 明亮',
    Serena: '女聲 · 沉穩',
    Uncle_Fu: '男聲 · 低沉',
    Dylan: '男聲 · 青年',
    Eric: '男聲 · 播音',
    Ryan: '男聲 · 輕快',
    Aiden: '男聲 · 敘事',
    Ono_Anna: '女聲 · 日語',
    Sohee: '女聲 · 韓語',
  },

  builtinVoice: {
    'zh-female': '中文女聲',
    'zh-male': '中文男聲',
    'en-female': '英語女聲',
    'en-male': '英語男聲',
    'ja-female': '日語女聲',
    'ja-male': '日語男聲',
    'es-female': '西班牙語女聲',
    'es-male': '西班牙語男聲',
  },
  builtinCredit: 'FLEURS 語料庫（CC BY 4.0）與 CMU ARCTIC · 經剪裁與響度標準化 · 保留原始聲明',

  describeWarm: '溫暖女聲',
  describeWarmText: '溫暖、親切的成年女聲，語速適中，像在跟朋友聊天',
  describeAnchor: '沉穩男聲',
  describeAnchorText: '沉穩、清晰的成年男聲，播音腔調，節奏平穩',
  describeBright: '明快少年',
  describeBrightText: '明快、有活力的年輕聲音，語氣輕鬆',

  toneUpbeat: '熱情洋溢',
  toneUpbeatText: '用熱情洋溢、充滿活力的語氣說話，語速比平常稍快',
  toneNatural: '自然',
  toneAnchor: '沉穩',
  toneAnchorText: '用沉穩、清晰的播音腔調說話，節奏平穩',
  toneSoft: '輕聲',
  toneSoftText: '放輕聲音、放慢語速，像在近處輕聲說話',

  customDescribe: '自行描述',
  defaultVoice: '預設音色',
  myVoices: '我的音色',
  fileVoice: '臨時使用一段錄音',
  seconds: (n: string) => `${n} 秒`,

  textRequired: '請先輸入要合成的文字',
  textTooLong: (max: number) => `一次最多 ${max} 字，試聽請用短一點的句子`,
  describeRequired: '請先用一句話描述你想要的音色',
  myVoiceGone: '這個音色已不在「我的音色」中，請換一個',
  referenceRequired: '請先選擇一段參考錄音，或換回內建音色',

  phaseSubmitting: '送出中',
  phaseQueued: '排隊中',
  phaseLoading: '正在載入模型',
  phaseGeneratingStep: (step: number, total: number) => `正在生成音訊 · 第 ${step}/${total} 步`,
  phaseGenerating: '正在生成音訊',
  phaseWriting: '正在寫入音訊',
  phasePreparing: '準備中',

  sampleVoice: (name: string) => `範例 · ${name}`,
  customText: '自訂文字',
  elapsed: (seconds: string) => `耗時 ${seconds} 秒`,
  audioLength: (seconds: string) => `音訊 ${seconds} 秒`,
};
