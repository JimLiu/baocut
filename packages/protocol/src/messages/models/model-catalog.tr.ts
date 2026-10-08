import type { ModelsModelCatalogMessages } from './model-catalog.ts';

export const tr: ModelsModelCatalogMessages = {
backendUnsupported: (p) => `${p.backend} arka ucu ${p.platform}/${p.arch} desteklemiyor`, relocating: 'Modeller klasörü taşınıyor; tamamlanana kadar kullanılamaz', missingComponent: (p) => `${p.name} (${p.detail})`, listSeparator: ', ', incomplete: (p) => `Eksik bileşenler: ${p.names}. Yükleme yalnızca eksik bileşenleri indirir`, workerMissing: 'Model Worker (model-worker) bulunamadı', noManifest: (p) => `${p.repo} için bildirim yok`, wrongRevision: (p) => `${p.repo} sürümü ${p.revision} değil`, missingFile: (p) => `${p.repo} içinde ${p.file} eksik`, sizeMismatch: (p) => `${p.repo} içindeki ${p.file} boyutu eşleşmiyor`, noBundle: (p) => `Böyle bir model paketi yok: ${p.bundleId}`, moving: 'Modeller klasörü taşınıyor', notInstalled: (p) => `${p.repo} modeli yüklü değil`, noFilesInSubdir: (p) => `Modelin ${p.subdir}/ altında dosyası yok`,
};
