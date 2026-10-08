import type { RcTemplatesMessages } from './rc-templates.ts';
import { pluralForm } from '../../i18n.ts';

export const ptBR: RcTemplatesMessages = {
  builtinConflict: (p) => `Já existe um template integrado com o id “${p.id}”, então esta cópia não foi carregada. Altere o id (nome da pasta) e adicione novamente`,
  templateNotFound: (p) => `Template não encontrado: ${p.id}`,
  fileNotRegistered: (p) => `O template “${p.id}” não lista este arquivo: ${p.file}`,
  dirIsSymlink: 'A pasta do template é um link simbólico e não é seguida. Adicione a própria pasta do template',
  duplicateId: (p) => `Mais de um template na mesma pasta tem o id “${p.id}”; nenhum foi carregado`,
  templateInvalid: 'O template não é válido e não foi carregado',
  unsupportedSchema: 'Esta versão não reconhece schema do manifesto, então o template não foi carregado',
  missingFile: (p) => `${p.file} está ausente`,
  fileOverBytes: (p) => `${p.file} é maior que ${p.limit} B`,
  fileOverBytesActual: (p) => `${p.file} é maior que ${p.limit} B (${p.size})`,
  fileNotUtf8: (p) => `${p.file} não é UTF-8 válido`, fileNotJson: (p) => `${p.file} não é JSON válido`, fileEmpty: (p) => `${p.file} está vazio`,
  registeredFileMissing: (p) => `Um arquivo listado não existe: ${p.file}`,
  pathOutsideTemplate: (p) => `O caminho sai da pasta do template: ${p.file}`,
  unregisteredFile: (p) => `A pasta tem um arquivo não listado: ${p.file}`,
  tooManyEntries: (p) => pluralForm('pt-BR', p.limit, { one: `A pasta tem mais de ${p.limit} entrada`, other: `A pasta tem mais de ${p.limit} entradas` }),
  noSymlinks: (p) => `Links simbólicos não são permitidos: ${p.path}`,
  notRegularFile: (p) => `Não é um arquivo comum: ${p.path}`,
  cannotReadDir: (p) => `Não é possível ler a pasta do template (${p.code})`,
  notScene: (p) => `“${p.title}” é um exemplo: coloque o prompt na caixa de mensagem e envie, sem anexar um template`,
  assetNotRegistered: (p) => `O template “${p.id}” não lista esta mídia: ${p.asset}`,
  translationForBaseLanguage: (p: { file: string; language: string }) => `${p.file} está no idioma do próprio template (${p.language}); template.json e prompt.md já cobrem esse idioma`,
};
