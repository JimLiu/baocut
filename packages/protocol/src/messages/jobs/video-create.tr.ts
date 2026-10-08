import type { JobsVideoCreateMessages } from './video-create.ts';

export const tr: JobsVideoCreateMessages = {
  videoClosed: 'Video kapatıldı, hiçbir şey içe aktarılmadı: videoyu açıp yeniden deneyin',
  noAsset: 'İçe aktarma medya döndürmedi',
  notCompleted: (p: { state: string }) => `Yazıya dökme tamamlanmadı (${p.state})`,
};
