import type { ToolsGalleryMessages } from './tools-gallery.ts';

export const zhHant: ToolsGalleryMessages = {
  transcode: '在這台電腦上用 ffmpeg 編碼 · 不上傳',
  linkReady: '下載工具已就緒',
  pipelineMissing: '這個版本的 Runtime 還沒有這個工具的流程，暫時無法使用',
  withRemedy: (message, remedy) => `${message}。${remedy}`,
  localModels: (n) => `本機 ${n} 個模型`,
  cloudConnected: (n) => `已連接 ${n} 家線上供應商`,
  noSpeech: '還沒有可用的語音合成模型',
  noImage: '還沒有可用的影像生成模型',
  noText: '還沒有可用的文字模型',
};
