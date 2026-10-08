import type { ToolsGalleryMessages } from './tools-gallery.ts';

export const zhHans: ToolsGalleryMessages = {
  transcode: '在这台电脑上用 ffmpeg 编码 · 不上传',
  linkReady: '下载工具就绪',
  pipelineMissing: '这一版 Runtime 还没有这个工具的流程，暂时不能用',
  withRemedy: (message, remedy) => `${message}。${remedy}`,
  localModels: (n) => `本机 ${n} 个模型`,
  cloudConnected: (n) => `${n} 家云端已连接`,
  noSpeech: '还没有可用的语音合成模型',
  noImage: '还没有可用的生图模型',
  noText: '还没有可用的文本模型',
};
