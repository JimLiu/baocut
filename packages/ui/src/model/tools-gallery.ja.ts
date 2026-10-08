import type { ToolsGalleryMessages } from './tools-gallery.ts';

export const ja: ToolsGalleryMessages = {
  transcode: 'このコンピュータで ffmpeg を使ってエンコード · アップロードなし',
  linkReady: 'ダウンロードツールの準備完了',
  pipelineMissing: 'このバージョンの Runtime にはこのツールのパイプラインがまだないため、今は使えません',
  withRemedy: (message, remedy) => `${message}。${remedy}`,
  localModels: (n) => `ローカルモデル ${n} 個`,
  cloudConnected: (n) => `オンラインのプロバイダ ${n} 社に接続済み`,
  noSpeech: '利用できる音声合成モデルがまだありません',
  noImage: '利用できる画像生成モデルがまだありません',
  noText: '利用できるテキストモデルがまだありません',
};
