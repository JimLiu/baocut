import type { ToolsTranscribeMessages } from './tools-transcribe.ts';

export const vi: ToolsTranscribeMessages = {
  mediaFormats: 'MP4, MOV, MP3, WAV, M4A',
  notInstalled: 'Chưa cài',
  notConnected: 'Chưa kết nối',
  noCloud: 'Chưa có dịch vụ nhận dạng giọng nói trực tuyến',
  cloudLine: (connected, provider) => `${connected ? 'Đã kết nối' : 'Chưa kết nối'} · ${provider} · chép lời trực tuyến`,
  noLocal: 'Chưa có mô hình nhận dạng giọng nói trên máy tính này',
  localReady: 'Đã cài · nhận dạng trên máy tính này',
  localMissing: 'Mô hình chưa được cài',
};
