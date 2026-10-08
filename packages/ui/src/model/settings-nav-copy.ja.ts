import type { SettingsNavMessages } from './settings-nav-copy.ts';

export const ja: SettingsNavMessages = {
  category: {
    asr: { label: '音声認識', description: '音声を文字起こしや字幕に変換し、話者を区別します。' },
    tts: { label: '音声合成', description: '音声を生成し、声をクローンして、動画の吹き替えを作成します。' },
    llm: { label: 'テキスト生成', description: '文字起こしを整え、字幕を翻訳し、テキストを生成します。' },
    image: { label: '画像生成', description: '動画に必要な画像や表紙を生成します。' },
    sep: { label: '音源分離', description: 'ボーカル、伴奏、背景音を分離します。' },
    vision: { label: '映像理解', description: '人物、話者、画面の内容を認識して、スマートクロップを補助します。' },
  },
  page: { local: 'ローカルモデル', cloud: 'クラウドモデル', voices: 'マイボイス' },
  onlyPage: {
    local: 'このカテゴリには、このコンピュータで実行するローカルモデルしかありません。クラウドモデルはまだありません。',
    cloud: 'テキスト生成にはクラウドモデルしかありません。コーディング用の Agent は「Agent」で設定します。',
  },
  section: {
    general: '一般',
    shortcuts: 'ショートカット',
    fonts: 'フォント',
    agent: 'Agent プロバイダ',
    skills: 'Skills',
    glossary: '用語集',
    privacy: 'プライバシーと権限',
    diagnostics: '診断',
    about: '情報',
  },
  group: { preferences: '環境設定', agents: 'Agent', app: 'アプリ' },
};
