import type { ToolsTranscribeMessages } from './tools-transcribe.ts';

export const zhHant: ToolsTranscribeMessages = {
  mediaFormats: 'MP4、MOV、MP3、WAV、M4A',
  notInstalled: '未安裝',
  notConnected: '未連接',
  noCloud: '還沒有線上語音辨識服務',
  cloudLine: (connected, provider) => `${connected ? '已連接' : '未連接'} · ${provider} · 線上轉錄`,
  noLocal: '這台電腦上還沒有語音辨識模型',
  localReady: '已安裝 · 在本機辨識',
  localMissing: '模型尚未安裝',
};
