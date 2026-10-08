import type { ModelsModelCatalogMessages } from './model-catalog.ts';

export const ru: ModelsModelCatalogMessages = {
  backendUnsupported: (p: { backend: string; platform: string; arch: string }) => `Компонент ${p.backend} — бэкенд не поддерживает ${p.platform}/${p.arch}`,
  relocating: "Папка моделей перемещается; до завершения перемещения её нельзя использовать",
  missingComponent: (p: { name: string; detail: string }) => `${p.name} (${p.detail})`,
  listSeparator: ", ",
  incomplete: (p: { names: string }) => `Отсутствуют компоненты: ${p.names}. При установке скачиваются только отсутствующие компоненты`,
  workerMissing: "Model Worker (model-worker) не найден",
  noManifest: (p: { repo: string }) => `${p.repo} не имеет манифеста`,
  wrongRevision: (p: { repo: string; revision: string }) => `Версия ${p.repo} не равна ${p.revision}`,
  missingFile: (p: { repo: string; file: string }) => `${p.repo} не содержит ${p.file}`,
  sizeMismatch: (p: { repo: string; file: string }) => `Размер ${p.file} в ${p.repo} не совпадает`,
  noBundle: (p: { bundleId: string }) => `Нет такого пакета модели: ${p.bundleId}`,
  moving: "Папка моделей перемещается",
  notInstalled: (p: { repo: string }) => `Модель ${p.repo} не установлена`,
  noFilesInSubdir: (p: { subdir: string }) => `У модели нет файлов в ${p.subdir}/`,
};
