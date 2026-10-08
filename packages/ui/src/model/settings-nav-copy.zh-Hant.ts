import type { SettingsNavMessages } from './settings-nav-copy.ts';

export const zhHant: SettingsNavMessages = {
  category: {
    asr: { label: '語音辨識', description: '將語音轉成逐字稿和字幕，並區分說話者。' },
    tts: { label: '語音合成', description: '生成語音、克隆音色，並為影片配音。' },
    llm: { label: '文字生成', description: '潤飾逐字稿、翻譯字幕，並生成文字。' },
    image: { label: '影像生成', description: '生成影片所需的圖片和封面。' },
    sep: { label: '音源分離', description: '分離人聲、伴奏和背景音。' },
    vision: { label: '視覺理解', description: '辨識人物、說話者和畫面內容，協助智慧裁切。' },
  },
  page: { local: '本機模型', cloud: '雲端模型', voices: '我的音色' },
  onlyPage: {
    local: '這一類只有在這台電腦上執行的本機模型，目前還沒有雲端模型。',
    cloud: '文字生成只有雲端模型。程式設計 Agent 在「Agent」中設定。',
  },
  section: {
    general: '一般',
    shortcuts: '快速鍵',
    fonts: '字型',
    agent: 'Agent 供應商',
    skills: 'Skills',
    glossary: '術語表',
    privacy: '隱私與權限',
    diagnostics: '診斷',
    about: '關於',
  },
  group: { preferences: '偏好設定', agents: 'Agent', app: '應用程式' },
};
