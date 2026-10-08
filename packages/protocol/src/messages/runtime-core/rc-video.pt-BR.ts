import type { RcVideoMessages } from './rc-video.ts';

export const ptBR: RcVideoMessages = {
  engineExited: 'O mecanismo de vídeo saiu, então a alteração pode não ter sido registrada. Tente novamente com o mesmo comando',
  engineStartFailed: (p) => `Não foi possível iniciar o mecanismo de vídeo: ${p.reason}`,
  engineNotRunning: 'O mecanismo de vídeo não está em execução', engineRequestFailed: (p) => `O mecanismo falhou ao processar ${p.method}`,
  engineRestarting: 'O mecanismo de vídeo está reiniciando. Tente novamente com o mesmo comando em instantes', runtimeStopping: 'O Runtime está parando',
  engineNotFound: 'O mecanismo de vídeo (engine-host) não foi encontrado. Execute npm run build:engine primeiro',
  defaultDirName: 'Vídeo', untitledVideo: 'Vídeo sem título', sourceDirNotFound: 'A pasta de origem não existe', reservedDirOutsideSource: 'A pasta reservada não está na pasta de origem', videoInUse: 'Este vídeo está aberto',
  videoNotOpenOpenFirst: 'O vídeo não está aberto. Abra primeiro', assetVersionNotFound: 'A mídia ou esta versão não existe', videoNotFound: 'O vídeo não existe', onlyWorkspaceVideos: 'Só é possível abrir vídeos na pasta de trabalho',
  videoDeletedRestoreFromTrash: 'Este vídeo foi excluído. Restaure da Lixeira primeiro', dirNotVideo: 'Esta pasta não é um vídeo', linkedPreviewUnsupported: 'Só é possível visualizar imagens, áudio, vídeo, fontes e animações Lottie vinculados',
  packageNotFound: 'O pacote portátil não existe', packageNotFile: 'O pacote portátil deve ser um arquivo .baocut', videoInTrash: 'Este vídeo está na Lixeira. Restaure primeiro', videoNotInSourceDir: 'O vídeo não está em uma pasta de projeto ou sessão',
  cantCreateInSession: 'Este Runtime não pode criar vídeos em uma sessão', targetLocationIncomplete: 'O local do vídeo de destino está incompleto', reservedDirOutsideProject: 'A pasta reservada não está nesta pasta de projeto ou sessão', pipelinePrincipalName: 'Fluxo',
  openElsewhere: 'Este vídeo está aberto em outra janela ou conexão. Feche ali primeiro', videoBusy: 'Este vídeo ainda tem tarefas ou exportações em andamento. Cancele primeiro',
  crossDevice: 'A pasta do vídeo e a de origem não estão no mesmo disco, então não é possível mover para a Lixeira',
  videoEntryNotFound: 'Não é possível encontrar este vídeo (não está no Space ou o Space ainda está verificando)',
  notDeletedVideo: 'Este item não é um vídeo excluído', restoreRootGone: 'O projeto ou sessão deste vídeo não existe mais, então não é possível restaurar', trashDirGone: 'A pasta do vídeo na Lixeira não existe mais',
  sourceRootInTrash: 'Esta pasta de vídeo é uma pasta de projeto ou uma pasta de trabalho de sessão (ou contém uma), então não pode ser movida para a Lixeira',
  sourceRootRemedy: 'No BaoCut, remova primeiro o projeto ou sessão que usa esta pasta e depois exclua este vídeo do projeto pai',
  compositionImportFailed: (p) => `Não foi possível importar o gráfico animado (${p.code})`,
  compositionPreviewFailed: (p) => `Não foi possível visualizar o gráfico animado (${p.code})`,
};
