import type { RcPackageMessages } from './rc-package.ts';

import { pluralForm } from '../../i18n.ts';
const s = (n: number, one: string, many: string) => pluralForm('pt-BR', n, { one, other: many });
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export const ptBR: RcPackageMessages = {

  localPathPlaceholder: "<caminho local removido>",
  assetsUnreadable: (p) => `${p.count} ${s(p.count, 'revisão de mídia não pode ser lida', 'revisões de mídia não podem ser lidas')}; o pacote ficaria incompleto. Localize ou vincule novamente, ou escolha ignorar mídias ausentes`,
  assetsUnreadableRecovery:
    "Vincule (relinkAsset) ou recupere arquivos; ou exporte com missingAssets: skip para marcá-los ausentes no manifesto",
  documentDigestMismatch: (p: { documentId: string; revision: string }) =>
    `O conteúdo do documento ${p.documentId} revisão ${p.revision} não corresponde ao hash registrado`,
  documentsContainLocalPaths: "Documentos contêm caminhos locais, incompatíveis com pacote portátil; edite primeiro",
  missingNote: (p: { reason: string }) => `Não pôde ser lido na exportação (${p.reason})`,
  localPathsRemoved: (p) => `Substituídos ${p.count} ${s(p.count, 'caminho local', 'caminhos locais')} no snapshot por marcador: ${p.places}${p.more ? '…' : ''}`,
  assetNotPackaged: (p: { key: string; reason: string }) =>
    `Não foi possível ler a revisão de mídia ${p.key} (${p.reason}); excluída do pacote e marcada ausente no manifesto`,
  filesNotArchivable: "Alguns arquivos não podem ser gravados no arquivo .baocut",
  insufficientSpace: (p: { required: string; available: string }) =>
    `Espaço insuficiente no disco de exportação: exige cerca de ${p.required}, só ${p.available} disponíveis`,
  assetReadIncomplete: (p: { name: string }) => `A mídia “${p.name}” não pôde ser lida inteira ou mudou durante a exportação`,
  assetContentChanged: (p: { name: string; linked: boolean }) =>
    `A mídia “${p.name}” não corresponde ao conteúdo registrado (${p.linked ? "o arquivo vinculado mudou" : "o arquivo no vídeo está corrompido"})`,
  diskFullWhileWriting: "O disco de exportação encheu durante a gravação",
  packageVerifyFailed: (p: { error: string }) => `O pacote gravado falhou na verificação: ${p.error}`,
  manifestReadBackMismatch: "O manifesto relido difere do gravado",

  tarFileTooLarge: "Um arquivo não pode ultrapassar 8 GiB (maiores exigem cabeçalhos pax, não aceitos nesta versão)",
  tarPathTooLong: (p: { max: number }) => `Caminho longo demais no pacote (máx. ${p.max} bytes)`,
  archivePathTooLong: (p: { path: string }) => `Caminho longo demais no pacote: ${p.path}`,
  archiveFileTooLarge: (p: { path: string }) => `Arquivo grande demais: ${p.path}`,
  entryLongerThanExpected: (p: { path: string }) => `${p.path} é maior que o esperado; mudou durante a leitura`,
  entryShorterThanExpected: (p: { path: string }) => `${p.path} é menor que o esperado; mudou durante a leitura`,
  archiveHeaderCorrupt: "Cabeçalho do arquivo corrompido",
  archiveTruncated: "Arquivo truncado",
  archiveChecksumMismatch: "Checksum do cabeçalho incorreto: arquivo corrompido ou não é pacote .baocut",
  notUstar: "Não é um arquivo POSIX ustar",
  archiveHasLink: (p: { path: string }) => `O pacote contém um link (${p.path}), que não é aceito`,
  unsafePath: (p: { path: string }) => `Caminho inseguro no pacote: ${p.path}`,
  unsupportedEntryType: (p: { path: string }) => `Tipo de entrada não aceito no pacote (${p.path})`,
  duplicateEntry: (p: { path: string }) => `${p.path} aparece duas vezes no pacote`,
  entryTooLarge: (p: { path: string }) => `${p.path} é grande demais`,

  manifestNotJson: "O manifesto não é JSON",
  notBaocutPackage: "Não é um pacote portátil BaoCut",
  invalidPackageVersion: "Versão do pacote inválida",
  packageVersionTooNew: (p: { version: number; supported: number }) =>
    `Este pacote é versão ${p.version}, mas este BaoCut só aceita ${p.supported}; abra com uma versão mais recente`,
  manifestMissingFileList: "O manifesto não tem lista de arquivos",
  manifestIncompleteFile: "O manifesto tem registro de arquivo incompleto",
  manifestUnsafePath: (p: { path: string }) => `Caminho inseguro no manifesto: ${p.path}`,
  manifestIncompleteEntry: "O manifesto tem registro de revisão incompleto",
  manifestMissingKey: (p: { key: string }) => `Falta no manifesto ${p.key}`,
  packageNoManifest: "O pacote não tem manifesto (video.manifest.json)",
  manifestDuplicate: (p: { path: string }) => `${p.path} aparece duas vezes no manifesto`,
  fileNotInManifest: (p: { path: string }) => `O pacote contém arquivo fora do manifesto: ${p.path}`,
  fileMissingFromPackage: (p: { path: string }) => `Falta arquivo listado no manifesto: ${p.path}`,
  fileLengthMismatch: (p: { path: string }) => `O tamanho de ${p.path} não corresponde ao manifesto`,
  packageNoSnapshot: "O pacote não tem snapshot de vídeo (video.snapshot.json)",
  fileDigestMismatch: (p: { path: string }) => `O conteúdo de ${p.path} não corresponde ao hash do manifesto`,
  entryAsset: (p: { ref: string }) => `mídia ${p.ref}`,
  entryDocument: (p: { ref: string }) => `documento ${p.ref}`,
  entryIncludedWithoutPath: (p: { what: string }) => `${cap(p.what)} está marcado como incluído mas não tem caminho`,
  entryDigestMismatch: (p: { what: string }) => `O hash do conteúdo de ${p.what} não corresponde ao arquivo no pacote`,
  entryFileMissing: (p: { what: string }) => `Falta no pacote o arquivo de ${p.what}`,
};
