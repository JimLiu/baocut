import type { ModelsModelInstallerMessages } from './model-installer.ts';

export const vi: ModelsModelInstallerMessages = {
  noSpace: 'Đĩa chứa thư mục mô hình đã hết dung lượng',
  noManifest: (p: { repo: string; revision: string }) => `Không có bản kê có sẵn cho ${p.repo}@${p.revision}`,
  untrustedManifest: (p: { repo: string }) => `Bản kê có sẵn của ${p.repo} thiếu sha256 đáng tin cậy`,
  noBundle: (p: { bundleId: string }) => `Không có gói mô hình này: ${p.bundleId}`,
};
