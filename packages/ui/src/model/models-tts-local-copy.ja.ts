import type { TtsLocalMessages } from './models-tts-local-copy.ts';

const LANG_SHORT: Record<string, string> = {
  zh: '中国語',
  en: '英語',
  ja: '日本語',
  ko: '韓国語',
  de: 'ドイツ語',
  fr: 'フランス語',
  es: 'スペイン語',
  it: 'イタリア語',
  pt: 'ポルトガル語',
  ru: 'ロシア語',
  ar: 'アラビア語',
};

export const ja: TtsLocalMessages = {
  languageShort: (code) => LANG_SHORT[code] ?? code,
  languagesAny: 'すべての言語',
  languagesMore: (shown, total) => `${shown.join(' / ')} など ${total} 言語`,
  summaryCloneDescribe: (builtins, byDuration) =>
    `${builtins} 種類の内蔵の声を使うか、録音から声をクローンするか、性別・年齢・ピッチを選んで新しい声を作成できます${
      byDuration ? '。目標の長さに合わせて読み上げることもできます' : ''
    }`,
  summaryClone: (builtins, style) =>
    `${builtins} 種類の内蔵の声を使うか、録音から声をクローンできます${style ? '。スタイルは一文の指示で指定できます' : ''}`,
  summaryDescribe: (builtins) =>
    builtins
      ? `ほしい声を一文で説明すると、モデルがその声を作成します。${builtins} 種類の内蔵の声をそのまま使うこともできます`
      : 'ほしい声を一文で説明すると、モデルがその声を作成します',
  summaryPreset: (speakers, style) =>
    `${speakers} 種類のプリセットの声から選ぶだけで読み上げます${style ? '。口調は一文の指示で指定できます' : ''}`,
  modeCloneDescribe: '内蔵の声 / クローン / 説明',
  modeClone: '内蔵の声 / クローン',
  modeDescribe: '説明から声を作成',
  modePreset: 'プリセットの声',
  factStyle: 'スタイル指示',
  factSlow: 'やや遅い',
  nonCommercialChip: '非商用のみ',
  licenseCommercial: (name) => `${name} · 商用利用可`,
  licenseNonCommercial: (name, owner) => `${name} · 非商用利用のみ · 商用利用には ${owner} への別途申請が必要`,
  familyDesc: {
    'qwen3-tts':
      'Qwen3-TTS：CustomVoice には 9 人のプリセット話者がいて、一文の指示で口調を指定できます。Base は参考録音からクローンします。1.7B VoiceDesign は説明だけで新しい声を作成します。1.7B は音質が良い分、速度は遅くなります。',
    indextts2:
      'IndexTTS：8 種類の内蔵の声を使うか、ご自身の録音からクローンできます。録音からは声質だけを取り込み、その文字起こしは読みません。IndexTTS 2.5 では話す速さも調整できます。',
    'gpt-sovits':
      'GPT-SoVITS：8 種類の内蔵の声を使うか、ご自身の録音からクローンできます。参考録音の文字起こしも渡すとより似た声になります。その場合、参考録音は 3〜10 秒にしてください。',
    voxcpm2:
      'VoxCPM2：8 種類の内蔵の声を使うか、ご自身の録音からクローンできます。録音の文字起こしを渡すと最もよく似ます。一文の指示で話し方のスタイルも指定できます。48 kHz で出力します。',
    omnivoice:
      'OmniVoice：8 種類の内蔵の声を使うか、ご自身の録音からクローンするか、単語リストから性別・年齢・ピッチを選んで新しい声を作成できます。対応言語が最も多いモデルです。非商用のみ。',
  },
  quickDescribe: '声はこの説明だけで決まります。説明を変えると別人の声になります',
  quickVoxcpm: 'ほぼリアルタイム：一文の生成には読み上げと同じくらいの時間がかかり、初回の読み込みには約 5 秒かかります',
  quickNonCommercial: (license) => `非商用のみ（${license}）：商用で使うコンテンツには別のモデルに切り替えてください`,
  quickSlow: '大きなモデル：同種のモデルより合成が遅く、初回の読み込みにも少し時間がかかります',
};
