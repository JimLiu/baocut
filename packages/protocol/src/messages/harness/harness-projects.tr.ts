import type { HarnessProjectsMessages } from './harness-projects.ts';

export const tr: HarnessProjectsMessages = {
conversationNotFound: (p) => `Oturum bulunamadı: ${p.id}`, projectNotFound: (p) => `Proje bulunamadı: ${p.id}`, folderInaccessible: (p) => `Klasör yok veya erişilemiyor: ${p.dir}`, markerReadFailed: (p) => `Proje işaretçisi okunamadı: ${p.error}`, markerNewer: (p) => `Bu proje daha yeni BaoCut sürümüyle oluşturuldu (proje işaretçisi sürümü ${p.version}). BaoCut uygulamasını güncelleyip yeniden açın`, untitledProject: 'Adsız proje', recoveredVideos: 'Kurtarılan videolar', createFolderFailed: (p) => `Proje klasörü oluşturulamadı: ${p.error}`, tooManySameName: 'Bu adı taşıyan çok fazla proje klasörü var. Başka ad seçin', markerNotWritable: (p) => `Proje klasörüne yazılamıyor; .bcut/project.json proje işaretçisi yazılamadı: ${p.dir}`, markerWriteFailed: (p) => `Proje işaretçisi yazılamadı: ${p.error}`,
sessionVideosOpen: (p) => `Bu oturumdaki bazı videolar hâlâ açık: ${p.names}. Kapatıp yeniden deneyin`,
projectFolderMissing: (p) => `Proje klasörü artık yok: ${p.dir}. Yerine geri koyun, yeni konumundan açın veya projeyi BaoCut'tan kaldırın`,
projectVideosOpen: (p) => `Bu projedeki bazı videolar hâlâ açık: ${p.names}. Kapatıp yeniden deneyin`,
};
