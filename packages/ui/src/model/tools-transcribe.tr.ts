import type { ToolsTranscribeMessages } from './tools-transcribe.ts';

export const tr: ToolsTranscribeMessages = {
  mediaFormats: 'MP4, MOV, MP3, WAV, M4A',
  notInstalled: 'Yüklü değil',
  notConnected: 'Bağlı değil',
  noCloud: 'Henüz çevrimiçi konuşma tanıma hizmeti yok',
  cloudLine: (connected, provider) => `${connected ? 'Bağlı' : 'Bağlı değil'} · ${provider} · çevrimiçi yazıya döker`,
  noLocal: 'Bu bilgisayarda henüz konuşma tanıma modeli yok',
  localReady: 'Yüklü · bu bilgisayarda tanır',
  localMissing: 'Model henüz yüklü değil',
};
