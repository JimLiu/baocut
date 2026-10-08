import type { ToolsGalleryMessages } from './tools-gallery.ts';

export const tr: ToolsGalleryMessages = {
  transcode: 'Bu bilgisayarda ffmpeg ile kodlanır · yükleme yapılmaz',
  linkReady: 'İndirme aracı hazır',
  pipelineMissing: 'Bu Runtime sürümünde bu aracın işlem hattı henüz yok, şu anda kullanılamıyor',
  withRemedy: (message, remedy) => `${message}. ${remedy}`,
  localModels: (n) => `${n} yerel model`,
  cloudConnected: (n) => `${n} çevrimiçi sağlayıcı bağlı`,
  noSpeech: 'Henüz kullanılabilir konuşma sentezi modeli yok',
  noImage: 'Henüz kullanılabilir görsel oluşturma modeli yok',
  noText: 'Henüz kullanılabilir metin modeli yok',
};
