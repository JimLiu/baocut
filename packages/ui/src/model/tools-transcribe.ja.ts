import type { ToolsTranscribeMessages } from './tools-transcribe.ts';

export const ja: ToolsTranscribeMessages = {
  mediaFormats: 'MP4、MOV、MP3、WAV、M4A',
  notInstalled: '未インストール',
  notConnected: '未接続',
  noCloud: 'オンラインの音声認識サービスがまだありません',
  cloudLine: (connected, provider) => `${connected ? '接続済み' : '未接続'} · ${provider} · オンラインで文字起こし`,
  noLocal: 'このコンピュータに音声認識モデルがまだありません',
  localReady: 'インストール済み · このコンピュータで認識',
  localMissing: 'モデルはまだインストールされていません',
};
