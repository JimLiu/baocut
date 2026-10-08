import type { RcSpaceMessages } from './rc-space.ts';

export const ptBR: RcSpaceMessages = {

  dirUnreadable: (p: { code: string }) => `Não foi possível ler a pasta (${p.code})`,
  tooManyDirEntries: (p: { max: number }) => `Mais de ${p.max} itens da pasta; só parte é listada`,
  tooManyFiles: (p: { max: number }) => `Mais de ${p.max} arquivos; só parte é listada`,

  entryGone: "Este item não está mais no Space",
  trashVideoUseDelete: "Para excluir vídeo, use videos.delete",
  restoreVideoUseRestore: "Para restaurar vídeo excluído, use videos.restore",
  videoDeletedRestoreFirst: "Este vídeo foi excluído. Restaure primeiro",
  videoDeleted: "Este vídeo foi excluído",
  notInSourceDir: "Este item não está em pasta de projeto ou sessão",
  stillGeneratingNoFile: "Ainda gerando; não há arquivo",
  noReadableFile: "Este item não tem arquivo legível",
  entryStillGeneratingNoFile: "Este item ainda está sendo gerado; não há arquivo",
  entryInTrash: "Este item está na Lixeira. Restaure primeiro",
  entryKindNotAccepted: (p: { kind: string }) => `Um item ${p.kind} não pode ser usado aqui`,
  notVideo: "Este item não é um vídeo",

  projectNotFound: "O projeto não existe",
  needAbsolutePath: "Informe o caminho absoluto do arquivo",
  fileNotFound: "O arquivo não existe",
  unrecognizedFileType:
    "Tipo de arquivo desconhecido. Só vídeo, imagem, áudio, legenda e documento podem ser adicionados",
  projectDirNotFound: "A pasta do projeto não existe",
  hiddenDirFile: "Arquivos em pastas ocultas ou de dependências não podem ser adicionados",
  videoDirFile: "Arquivos da pasta de vídeo pertencem a ele e não podem ser adicionados separadamente",
  tooManySameName: "Arquivos demais com o mesmo nome em imports/ do projeto",

  purgeVideoDeleteFirst:
    "Exclua o vídeo (videos.delete) para mover à Lixeira, depois exclua permanentemente dela",
  purgeTaskRunning: "A tarefa está em andamento. Cancele primeiro (jobs.cancel)",
  purgeNotTrashed: "Mova à Lixeira, depois exclua dela",
  videoSourceGone: "A origem deste vídeo não está mais disponível",
  refRunningTaskUsesVideo: (p: { jobId: string }) => `A tarefa ${p.jobId} em andamento usa este vídeo`,
  refTaskAwaitsDecision: (p: { jobId: string }) =>
    `A tarefa ${p.jobId} tem resultados aguardando sua decisão de adicionar a este vídeo`,

  refStrayFiles: (p: { names: string; total: number }) =>
    `A pasta do vídeo tem arquivos não gerenciados pelo vídeo (${new Intl.ListFormat("en", { style: "long", type: 'conjunction' }).format(p.names.split("/"))}${p.total > 3 ? `, ${p.total} no total` : ""}). Restaure o vídeo e mova os arquivos antes de excluir`,
  refRunningTaskUsesOutput: (p: { jobId: string }) => `A tarefa ${p.jobId} em andamento usa este resultado`,
  refVideoUnreadable: (p: { dir: string }) =>
    `O vídeo ${p.dir} não pode ser lido agora ou seu índice está atualizando; não é possível confirmar que não usa este arquivo`,
  refVideoAssetLinks: (p: { video: string; asset: string }) => `A mídia “${p.asset}” no vídeo “${p.video}” vincula a este arquivo`,

  importedFileGone: "O arquivo adicionado não está mais na pasta do projeto",
  resultNotApplied: "O resultado não foi aplicado ao vídeo",
  taskNotFinished: "A tarefa não terminou",
  outputFileGone: "O arquivo de resultado não existe mais",
  exportedFileGone: "O arquivo exportado não existe mais",
  labelSynthesizeSpeech: "Sintetizar voz",
  labelGenerateImage: "Gerar imagem",
  labelGenerateText: "Texto gerado",
  labelExport: "Exportar",

  engineUnavailable: "Mecanismo de vídeo indisponível",
  continueFromTrash: "Itens na Lixeira não podem ser continuados. Restaure primeiro",
  conversationCantSee:
    "A sessão não pode ver este item. Itens de projeto devem ir a uma sessão do mesmo projeto",
  serviceUsesMcp: "Serviços externos acessam o Space por ferramentas MCP",
  materialTextOnly: (p: { fileName: string }) =>
    `Só texto de documentos .txt e .md e legendas .srt e .vtt pode ser lido: ${p.fileName}`,
  materialTooLarge: (p: { fileName: string; bytes: number; limit: number }) =>
    `${p.fileName} é ${p.bytes} bytes, acima do limite de material de ${p.limit}`,
  afterMaterial: (p: { reason: string }) => `Após adicionar o material: ${p.reason}`,
  invalidParams: "Parâmetros inválidos",
};
