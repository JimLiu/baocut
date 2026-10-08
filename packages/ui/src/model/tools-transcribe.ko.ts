import type { ToolsTranscribeMessages } from './tools-transcribe.ts';

export const ko: ToolsTranscribeMessages = {
  mediaFormats: 'MP4, MOV, MP3, WAV, M4A',
  notInstalled: '설치되지 않음',
  notConnected: '연결 안 됨',
  noCloud: '아직 온라인 음성 인식 서비스가 없습니다',
  cloudLine: (connected, provider) => `${connected ? '연결됨' : '연결 안 됨'} · ${provider} · 온라인으로 전사`,
  noLocal: '이 컴퓨터에 아직 음성 인식 모델이 없습니다',
  localReady: '설치됨 · 이 컴퓨터에서 인식',
  localMissing: '모델이 아직 설치되지 않았습니다',
};
