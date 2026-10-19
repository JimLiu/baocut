import type { VideoVersionsMessages } from './video-versions-copy.ts';

export const ptBR: VideoVersionsMessages = {
  title: 'Histórico',
  close: 'Fechar histórico',
  tipRevision: (revision: string) => `Revisão ${revision}`,
  viewChanges: 'Alterações',
  tipLatest: (version: number) => `A mais recente é a versão ${version}`,
  tipNone: 'Ainda não há versões',
  tipOutside: 'Este vídeo não está em um projeto',
  loading: 'Carregando histórico de versões',
  loadFailed: (message: string) => `Não foi possível carregar o histórico de versões: ${message}`,
  stateSynced: 'Snapshot atualizado',
  stateSyncedDesc: 'O snapshot de espaço de trabalho na pasta do vídeo corresponde ao conteúdo atual.',
  statePending: 'Gravando snapshot',
  statePendingDesc: 'As alterações recentes entram no snapshot e no histórico de versões em poucos segundos.',
  stateConflict: 'Snapshot e BaoCut alterados',
  stateConflictDesc:
    'Os arquivos do snapshot foram alterados fora do BaoCut, e o BaoCut também tem alterações que ainda não estão no snapshot. O BaoCut não vai sobrescrever o snapshot até você escolher o que manter.',
  stateInvalid: 'Não é possível ler o snapshot',
  stateInvalidDesc:
    'Os arquivos do snapshot não podem ser interpretados, então o BaoCut não os importou. O BaoCut verifica de novo depois que você os corrigir, ou você pode sobrescrevê-los com o conteúdo do BaoCut.',
  stateExternal: 'Importando alterações externas',
  stateExternalDesc:
    'Os arquivos do snapshot foram alterados fora do BaoCut (git pull, uma pasta sincronizada ou uma edição manual) e o BaoCut não tem outras alterações, então está importando-os como uma versão “Alteração externa”.',
  stateMissing: 'Ainda não há snapshot',
  stateMissingDesc: 'O snapshot de espaço de trabalho ainda não foi gravado, ou o video.json não existe mais.',
  stateRebuild: 'Precisa ser reconstruído',
  stateRebuildDesc: 'Só existe o snapshot de espaço de trabalho, sem a biblioteca do vídeo. O BaoCut reconstrói o vídeo a partir dele ao abrir.',
  footer: (keep: number) =>
    `As versões ficam em .bcut-snapshot/history/ na pasta do vídeo e não dependem do git. O BaoCut mantém ${keep === 1 ? 'a versão sem nome mais recente' : `as ${keep} versões sem nome mais recentes`}, além de todas as versões salvas.`,
  save: 'Salvar versão',
  saveIntro: 'Salve o conteúdo atual como uma versão com nome. Versões salvas nunca são removidas automaticamente; só você pode excluí-las.',
  nameLabel: 'Nome',
  namePlaceholder: 'Por exemplo: Corte para aprovação',
  nameRequired: 'Dê um nome a esta versão',
  noteLabel: 'Nota (opcional)',
  cancel: 'Cancelar',
  saveSubmit: 'Salvar',
  conflictIntro:
    'Estes arquivos do snapshot foram alterados fora do BaoCut, talvez por git pull, uma pasta sincronizada ou uma edição manual, e o BaoCut também tem alterações que ainda não estão no snapshot:',
  conflictOutro:
    'Até você escolher o que manter, o BaoCut não vai sobrescrever o snapshot. Você pode continuar editando o vídeo, mas não é possível salvar versões nem voltar a uma versão.',
  invalidIntro: 'Estes arquivos do snapshot não podem ser interpretados. Eles podem conter marcadores de conflito de merge, estar truncados ou ter sido danificados manualmente:',
  invalidOutro:
    'O BaoCut não os importou. Você pode continuar editando o vídeo, mas não é possível salvar versões nem voltar a uma versão. O BaoCut verifica de novo depois que você corrigir estes arquivos, ou você pode manter o conteúdo do BaoCut e sobrescrevê-los.',
  externalIntro: 'Estes arquivos do snapshot foram alterados fora do BaoCut, talvez por git pull, uma pasta sincronizada ou uma edição manual:',
  externalOutro:
    'O BaoCut não tem alterações que ainda não estejam no snapshot, então os importa diretamente como uma versão “Alteração externa”. Você pode desfazer a importação depois.',
  stripConflict: 'O snapshot foi alterado fora do BaoCut, e o BaoCut também tem alterações novas. Escolha o que manter.',
  stripInvalid: 'Não é possível ler os arquivos do snapshot. O BaoCut não os importou.',
  view: 'Ver',
  keepVideo: 'Manter o conteúdo do BaoCut',
  useSnapshot: 'Usar o snapshot do disco',
  keepTitle: 'Manter o conteúdo do BaoCut?',
  keepConfirm: 'Sobrescrever o snapshot do disco',
  keepBody: (count: number, files: string, invalid: boolean) =>
    `O conteúdo do BaoCut é gravado no snapshot na hora, sobrescrevendo ${count === 1 ? `o arquivo ${invalid ? 'ilegível' : 'alterado'}` : `os ${count} arquivos ${invalid ? 'ilegíveis' : 'alterados'}`} no disco${files ? ` (${files})` : ''}. Essas alterações no disco não entram no histórico de versões e não podem ser recuperadas no BaoCut; se vieram do git ou de uma pasta sincronizada, você pode recuperá-las lá.`,
  diskTitle: 'Usar o snapshot do disco?',
  diskConfirm: 'Usar o snapshot do disco',
  diskBody: (files: string) =>
    `O conteúdo do vídeo é substituído pelo snapshot do disco${files ? ` (${files})` : ''} e registrado como uma versão “Alteração externa”. As alterações no BaoCut que ainda não estão no snapshot entram antes no histórico de versões: volte para antes da versão “Alteração externa” para recuperá-las. Você também pode desfazer isso.`,
  keptTitle: 'Conteúdo do BaoCut mantido',
  keptText: (version: number | null) =>
    `O snapshot no disco agora corresponde ao BaoCut${version ? `, e suas alterações recentes estão na versão ${version}` : ''}. As alterações que estavam no disco não entraram no histórico de versões.`,
  usedDiskTitle: (version: number) => `Snapshot do disco usado, registrado como versão ${version} “Alteração externa”`,
  usedDiskText: (version: number) => `Volte para antes da versão ${version} para recuperar o que havia no BaoCut. Você também pode desfazer isso.`,
  importedTitle: (version: number | null) => (version ? `Alterações externas importadas como versão ${version} “Alteração externa”` : 'Alterações externas importadas'),
  importedText:
    'Os arquivos do snapshot foram alterados fora do BaoCut e o BaoCut não tinha outras alterações, então eles foram importados diretamente. Volte para antes desta versão para ver o conteúdo de antes da importação, ou desfaça-a.',
  importUndoneTitle: 'Importação desfeita',
  importUndoneText:
    'O vídeo voltou ao conteúdo de antes da importação e é gravado de novo no snapshot em poucos segundos, o que descarta esta alteração externa. Desfazer também é uma alteração e entra em uma versão nova.',
  refusedBroken: 'Não é possível voltar a esta versão',
  refusedOther: 'Não concluído',
  refusedText: (message: string) => `${message}. O vídeo não mudou.`,
  savedTitle: (version: number, name: string) => `Salva como versão ${version} “${name}”`,
  savedText: 'Versões salvas permanecem; a regra de retenção nunca as remove.',
  restoredTitle: (version: number, before: boolean, recorded: number) =>
    before
      ? `Volta para antes da versão ${version}, registrada como versão ${recorded}`
      : `Volta à versão ${version}, registrada como versão ${recorded}`,
  restoredText: 'É uma alteração comum: você pode desfazê-la aqui ou no editor depois de fechar esta janela.',
  undo: 'Desfazer',
  undoneTitle: (version: number, before: boolean) =>
    before ? `Desfeito: voltar para antes da versão ${version}` : `Desfeito: voltar à versão ${version}`,
  undoneText: 'O vídeo voltou ao conteúdo anterior. Desfazer também é uma alteração e entra na versão mais recente.',
  noopTitle: 'Nenhuma alteração',
  noopText: (version: number, before: boolean) =>
    before
      ? `O vídeo já está no estado de antes do início da versão ${version}. Nada foi aplicado e nenhuma versão nova foi criada.`
      : `O vídeo já está no estado do fim da versão ${version}. Nada foi aplicado e nenhuma versão nova foi criada.`,
  deletedTitle: (name: string) => `Versão salva “${name}” excluída`,
  deletedText: 'O conteúdo do vídeo não mudou.',
  emptyTitle: 'Ainda não há versões',
  emptyText: (missing: boolean): string =>
    missing
      ? 'O snapshot de espaço de trabalho ainda não foi gravado. Sua próxima alteração vira a versão 1, ou você pode salvar uma versão agora.'
      : 'Sua próxima alteração vira a versão 1, ou você pode salvar uma versão agora.',
  outsideTitle: 'Este vídeo não está em um projeto',
  outsideText: 'Só vídeos em um projeto têm histórico de versões. Mova o vídeo para um projeto primeiro.',
  listLabel: 'Versões',
  versionN: (version: number) => `Versão ${version}`,
  openBadge: 'Ainda aberta',
  blockedFlag: 'Não é possível voltar',
  unreadableTitle: 'Não é possível ler este arquivo de versão',
  kindSegment: 'Edições',
  kindSave: 'Versão salva',
  kindRestore: 'Volta a uma versão',
  kindExternal: 'Alteração externa',
  kindRebuild: 'Reconstrução',
  revisions: (from: string, to: string) => (from === to ? `Revisão ${to}` : `Revisões ${from}–${to}`),
  openHint: 'A versão mais recente ainda está aberta: até passarem 5 minutos sem alterações ou ela completar 30 minutos, suas próximas alterações entram nela.',
  openHintPending: 'A versão mais recente ainda está aberta. As alterações recentes estão sendo gravadas e entram nela em poucos segundos.',
  openHintConflict: 'A versão mais recente ainda está aberta, mas as novas alterações não entram no histórico de versões até o conflito do snapshot ser resolvido.',
  openHintExternal:
    'A versão mais recente ainda está aberta. O snapshot do disco está sendo importado: esta versão é fechada primeiro, e as alterações externas viram uma versão própria.',
  externalHint:
    'Esta versão veio de fora do BaoCut: os arquivos do snapshot foram alterados por git pull, uma pasta sincronizada ou uma edição manual, e o BaoCut os importou como esta versão. Volte para antes desta versão para recuperar o que havia no BaoCut antes da importação.',
  restoreEnd: 'Voltar a esta versão',
  restoreBefore: 'Voltar para antes desta versão',
  deleteSaved: 'Excluir esta versão salva',
  whyNotFound: 'Esta versão não existe mais',
  whyUnreadable: (version: number) => `O arquivo da versão ${version} não pode ser lido, então não é possível voltar a ela nem a estados anteriores`,
  whyBroken: (version: number) => `O histórico de versões não confere na versão ${version}, então não é possível voltar a estados anteriores`,
  noopBoth: (version: number) => `O vídeo já está no estado da versão ${version} (o conteúdo é igual antes e depois), então voltar a ela não muda nada`,
  noopEnd: (version: number) => `O vídeo já está no estado do fim da versão ${version}, então voltar a ela não muda nada`,
  noopBefore: (version: number) => `O vídeo já está no estado de antes do início da versão ${version}, então voltar para lá não muda nada`,
  factActors: 'Alterado por',
  factConversations: 'Sessões',
  factFiles: 'O que mudou',
  factCheckpoint: 'Ponto de controle',
  actorYou: 'Você',
  actorAgent: 'Agente',
  actorExternal: (name: string) => `Serviço externo ${name}`,
  actorSystem: 'BaoCut',
  actionCount: (label: string, count: number) => (count > 1 ? `${label} ×${count}` : label),
  listSeparator: ', ',
  noActions: 'Nenhuma alteração registrada',
  noActionsRebuild: 'O BaoCut reconstruiu o vídeo a partir do snapshot; sem alterações de conteúdo',
  omitted: (count: number) => (count === 1 ? 'Mais 1 alteração foi apenas contada' : `Mais ${count} alterações foram apenas contadas`),
  notHere: '(não está neste computador)',
  openConversation: (title: string) => `Abrir a sessão “${title}”`,
  fileTimeline: 'Linha do tempo',
  fileDocument: 'Documento',
  changeAdd: 'Adicionado',
  changeDelete: 'Excluído',
  changeModify: 'Modificado',
  noFiles: 'Sem alterações de conteúdo',
  diffTitle: 'Alterações',
  copyDiff: 'Copiar diff',
  copied: 'Copiado',
  copyFailed: 'Não foi possível copiar. Selecione e copie manualmente.',
  diffEmpty: 'O diff desta versão está vazio: o conteúdo é o mesmo do fim da versão anterior.',
  diffLabel: (version: number) => `Diff da versão ${version}`,
  diffLoading: 'Carregando diff',
  diffFailed: (message: string) => `Não foi possível ler esta versão: ${message}`,
  diffMore: (count: number) =>
    count === 1 ? 'Mais 1 linha não é exibida. Copie o diff para ver tudo.' : `Mais ${count} linhas não são exibidas. Copie o diff para ver tudo.`,
  unreadableHeading: (file: string) => `Não é possível ler ${file}`,
  unreadableText: (why: string) =>
    `O cabeçalho ou o diff do arquivo de versão está corrompido; ele pode ter sido truncado ou editado à mão. ${why}. As versões mais novas não são afetadas.`,
  confirmRestoreTitle: (version: number, before: boolean) =>
    before ? `Voltar para antes da versão ${version}?` : `Voltar à versão ${version}?`,
  confirmRestoreBody: (version: number, before: boolean, when: string) =>
    `O conteúdo do vídeo será substituído pelo estado ${before ? `de antes do início da versão ${version}` : `do fim da versão ${version}`} (${when}). É uma alteração que pode ser desfeita, registrada como uma nova versão. As versões existentes permanecem, e os pontos de controle e as proteções não mudam.`,
  confirmDeleteTitle: (name: string) => `Excluir a versão salva “${name}”?`,
  confirmDeleteMiddle: (next: number) =>
    `Só esta versão e o ponto de controle dela são excluídos: as alterações dela se juntam à versão ${next}, logo depois. O conteúdo do vídeo não muda.`,
  confirmDeleteTop: 'Só o nome, a nota e o ponto de controle são removidos: esta versão vira um conjunto comum de edições, e as alterações seguintes entram nela. O conteúdo do vídeo não muda.',
  delete: 'Excluir',
};
