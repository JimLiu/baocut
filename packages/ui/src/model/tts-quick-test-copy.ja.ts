import type { TtsQuickTestMessages } from './tts-quick-test-copy.ts';

export const ja: TtsQuickTestMessages = {
  kindIntro: '紹介',
  kindNumbers: '数字',
  kindMood: 'トーン',

  presetSub: {
    Vivian: '女性 · 明るい',
    Serena: '女性 · 落ち着いた',
    Uncle_Fu: '男性 · 低い',
    Dylan: '男性 · 若い',
    Eric: '男性 · アナウンス',
    Ryan: '男性 · 軽快',
    Aiden: '男性 · 語り',
    Ono_Anna: '女性 · 日本語',
    Sohee: '女性 · 韓国語',
  },

  builtinVoice: {
    'zh-female': '中国語の女声',
    'zh-male': '中国語の男声',
    'en-female': '英語の女声',
    'en-male': '英語の男声',
    'ja-female': '日本語の女声',
    'ja-male': '日本語の男声',
    'es-female': 'スペイン語の女声',
    'es-male': 'スペイン語の男声',
  },
  builtinCredit: 'FLEURS コーパス（CC BY 4.0）と CMU ARCTIC · トリミングとラウドネス正規化済み · 元の表記を保持',

  describeWarm: '温かい女声',
  describeWarmText: '温かく親しみやすい大人の女性の声。ほどよいペースで、友人とおしゃべりしているように',
  describeAnchor: '落ち着いた男声',
  describeAnchorText: '落ち着いてはっきりした大人の男性の声。アナウンサー調で、リズムは一定',
  describeBright: '明るい若者',
  describeBrightText: '明るく元気な若者の声。リラックスした口調',

  toneUpbeat: '元気',
  toneUpbeatText: '明るく元気なエネルギーで、普段より少し速めに話して',
  toneNatural: '自然',
  toneAnchor: '落ち着き',
  toneAnchorText: '落ち着いたはっきりしたアナウンサー調で、一定のペースで話して',
  toneSoft: 'ソフト',
  toneSoftText: '近くで話しかけるように、そっと、ゆっくり話して',

  customDescribe: '自分で説明',
  defaultVoice: '既定の声',
  myVoices: 'マイボイス',
  fileVoice: 'クリップを一度だけ使う',
  seconds: (n: string) => `${n} 秒`,

  textRequired: '先に合成するテキストを入力してください',
  textTooLong: (max: number) => `一度に最大 ${max} 文字です。試聴には短い文を使ってください`,
  describeRequired: '先に希望の声を一文で説明してください',
  myVoiceGone: 'この声はもうマイボイスにありません。別の声を選んでください',
  referenceRequired: '先に参照録音を選ぶか、内蔵の声に戻してください',

  phaseSubmitting: '送信中',
  phaseQueued: '待機中',
  phaseLoading: 'モデルを読み込み中',
  phaseGeneratingStep: (step: number, total: number) => `音声を生成中 · ステップ ${step}/${total}`,
  phaseGenerating: '音声を生成中',
  phaseWriting: '音声を書き込み中',
  phasePreparing: '準備中',

  sampleVoice: (name: string) => `サンプル · ${name}`,
  customText: 'カスタムテキスト',
  elapsed: (seconds: string) => `所要 ${seconds} 秒`,
  audioLength: (seconds: string) => `音声 ${seconds} 秒`,
};
