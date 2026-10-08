import type { ModelsModelCatalogMessages } from './model-catalog.ts';

export const vi: ModelsModelCatalogMessages = {
backendUnsupported: (p) => `Backend ${p.backend} không hỗ trợ ${p.platform}/${p.arch}`, relocating: 'Đang chuyển thư mục mô hình; không thể dùng đến khi chuyển xong', missingComponent: (p) => `${p.name} (${p.detail})`, listSeparator: ', ', incomplete: (p) => `Thiếu thành phần: ${p.names}. Cài đặt chỉ tải thành phần còn thiếu`, workerMissing: 'Không tìm thấy Model Worker (model-worker)', noManifest: (p) => `${p.repo} không có bản kê`, wrongRevision: (p) => `Phiên bản ${p.repo} không phải ${p.revision}`, missingFile: (p) => `${p.repo} thiếu ${p.file}`, sizeMismatch: (p) => `Kích thước ${p.file} trong ${p.repo} không khớp`, noBundle: (p) => `Không có gói mô hình này: ${p.bundleId}`, moving: 'Đang chuyển thư mục mô hình', notInstalled: (p) => `Mô hình ${p.repo} chưa được cài`, noFilesInSubdir: (p) => `Mô hình không có tệp dưới ${p.subdir}/`,
};
