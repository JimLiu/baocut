import type { ModelsModelCatalogMessages } from './model-catalog.ts';

export const ptBR: ModelsModelCatalogMessages = {
  backendUnsupported: (p: { backend: string; platform: string; arch: string }) => `${p.backend} não oferece suporte como backend a ${p.platform}/${p.arch}`,
  relocating: "A pasta de modelos está sendo movida; não pode ser usada até o fim da movimentação",
  missingComponent: (p: { name: string; detail: string }) => `${p.name} (${p.detail})`,
  listSeparator: ", ",
  incomplete: (p: { names: string }) => `Componentes ausentes: ${p.names}. A instalação baixa apenas os componentes ausentes`,
  workerMissing: "Model Worker (model-worker) não foi encontrado",
  noManifest: (p: { repo: string }) => `${p.repo} não tem manifesto`,
  wrongRevision: (p: { repo: string; revision: string }) => `${p.repo} tem uma versão diferente de ${p.revision}`,
  missingFile: (p: { repo: string; file: string }) => `${p.repo} não tem ${p.file}`,
  sizeMismatch: (p: { repo: string; file: string }) => `${p.repo}: ${p.file} tem tamanho incompatível`,
  noBundle: (p: { bundleId: string }) => `Não existe este pacote de modelo: ${p.bundleId}`,
  moving: "A pasta de modelos está sendo movida",
  notInstalled: (p: { repo: string }) => `O modelo ${p.repo} não está instalado`,
  noFilesInSubdir: (p: { subdir: string }) => `O modelo não tem arquivos em ${p.subdir}/`,
};
