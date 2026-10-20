import type { ModelManagementMessages } from './model-management-copy.ts';

export const zhHans: ModelManagementMessages = {
  removeModel: "删除模型",
  removeModelBody: "从 BaoCut 删除这条手动添加的模型配置？提供方和账号保留；如果它是默认模型，对应默认值会清除。如果存在同名预置模型，删除后仍会显示该预置模型，且不能继续删除。",
  pickAudio: "选择音频或视频",
  asrTitle: "测试语音识别",
  asrNote: "请选择一段短音频或视频。音频会发送给所选提供方；TXT/SRT 结果保存在配置的保存位置，并列入 Space。",
  asrRunning: "正在发送音频并等待转写…",
  desktopOnly: "请在桌面应用选择本机文件测试语音识别。",
};
