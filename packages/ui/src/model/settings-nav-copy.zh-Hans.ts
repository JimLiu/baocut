import type { SettingsNavMessages } from './settings-nav-copy.ts';

export const zhHans: SettingsNavMessages = {
  category: {
    asr: { label: '语音识别', description: '将语音转成文稿和字幕，并区分说话人。' },
    tts: { label: '语音合成', description: '生成语音、克隆声音，为视频配音。' },
    llm: { label: '文本生成', description: '润色文稿、翻译字幕，生成文本内容。' },
    image: { label: '图像生成', description: '生成视频所需的图片和封面。' },
    sep: { label: '音源分离', description: '分离人声、伴奏和背景声。' },
    vision: { label: '画面理解', description: '识别人像、说话人和画面内容，辅助智能裁剪。' },
  },
  page: { local: '本地模型', cloud: '云端模型', voices: '我的声音' },
  onlyPage: {
    local: '这一类只有在这台电脑上运行的本地模型，暂时没有云端模型。',
    cloud: '文本生成只有云端模型；编码 Agent 在「Agent」里设置。',
  },
  section: {
    general: '通用',
    shortcuts: '快捷键',
    fonts: '字体',
    agent: 'Agent 提供方',
    skills: 'Skills',
    glossary: '术语库',
    privacy: '隐私与权限',
    diagnostics: '诊断',
    about: '关于',
  },
  group: { preferences: '偏好设置', agents: 'Agent', app: '应用' },
};
