import type { ToolsTranscribeMessages } from './tools-transcribe.ts';

export const zhHans: ToolsTranscribeMessages = {
  mediaFormats: 'MP4、MOV、MP3、WAV、M4A',
  notInstalled: '未安装',
  notConnected: '未连接',
  noCloud: '还没有云端语音识别服务',
  cloudLine: (connected, provider) => `${connected ? '已连接' : '未连接'} · ${provider} · 联网转录`,
  noLocal: '这台电脑上还没有语音识别模型',
  localReady: '已安装 · 在本机识别',
  localMissing: '模型尚未安装',
};
