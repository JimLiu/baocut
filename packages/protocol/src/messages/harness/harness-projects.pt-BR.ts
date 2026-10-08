import type { HarnessProjectsMessages } from './harness-projects.ts';

export const ptBR: HarnessProjectsMessages = {
  conversationNotFound: (p) => `Sessão não encontrada: ${p.id}`,
  projectNotFound: (p) => `Projeto não encontrado: ${p.id}`,
  folderInaccessible: (p) => `A pasta não existe ou não pode ser acessada: ${p.dir}`,
  markerReadFailed: (p) => `Não foi possível ler o marcador do projeto: ${p.error}`,
  markerNewer: (p) => `Este projeto foi criado por uma versão mais recente do BaoCut (versão do marcador do projeto ${p.version}). Atualize o BaoCut e abra novamente`,
  untitledProject: "Projeto sem título",
  createFolderFailed: (p) => `Não foi possível criar a pasta do projeto: ${p.error}`,
  tooManySameName: "Há pastas de projeto demais com este nome. Escolha outro nome",
  markerNotWritable: (p) => `Não é possível gravar na pasta do projeto, então não foi possível gravar o marcador .bcut/project.json: ${p.dir}`,
  markerWriteFailed: (p) => `Não foi possível gravar o marcador do projeto: ${p.error}`,
};
