import { pluralForm } from '@baocut/protocol';
import type { MainMessages } from './main-copy.ts';

export const ptBR: MainMessages = {
  about: (app: string) => `Sobre ${app}`, services: 'Serviços', hide: (app: string) => `Ocultar ${app}`, hideOthers: 'Ocultar outros', showAll: 'Mostrar tudo', quit: (app: string) => `Sair de ${app}`, exit: 'Sair',
  fileMenu: 'Arquivo', closeWindow: 'Fechar janela', close: 'Fechar', editMenu: 'Editar', undo: 'Desfazer', redo: 'Refazer', cut: 'Cortar', copy: 'Copiar', paste: 'Colar', pasteAndMatchStyle: 'Colar com o mesmo estilo', delete: 'Excluir', selectAll: 'Selecionar tudo',
  speech: 'Fala', startSpeaking: 'Começar a falar', stopSpeaking: 'Parar de falar', viewMenu: 'Exibir', reload: 'Recarregar', forceReload: 'Forçar recarregamento', toggleDevTools: 'Alternar ferramentas de desenvolvedor', actualSize: 'Tamanho real', zoomIn: 'Ampliar', zoomOut: 'Reduzir', toggleFullScreen: 'Alternar tela cheia', windowMenu: 'Janela', minimize: 'Minimizar', zoom: 'Zoom', bringAllToFront: 'Trazer tudo para frente',
  openProjectTitle: 'Abrir pasta do projeto', open: 'Abrir', choose: 'Escolher', importAssetsTitle: 'Importar mídias', importButton: 'Importar', mediaFilter: 'Vídeos, áudio e imagens', allFilesFilter: 'Todos os arquivos', openFileTitle: 'Abrir arquivo', save: 'Salvar',
  runtimeNoDiscovery: 'O Runtime iniciou, mas não gravou seu arquivo de descoberta', runtimeTimeout: 'O Runtime demorou demais para iniciar',
  runtimeExited: (code: number | null) => `O Runtime não iniciou (código de saída ${code})`,
  runtimeQuitting: 'O app está sendo encerrado',
  quitBusyTitle: (count: number) => pluralForm('pt-BR', count, { one: `${count} tarefa ainda está em andamento`, other: `${count} tarefas ainda estão em andamento` }),
  quitBusyDetail: 'Se você sair agora, elas serão interrompidas. Você também pode deixá-las continuar em segundo plano; o BaoCut para sozinho quando elas terminarem.',
  quitKeepRunning: 'Continuar em segundo plano',
  quitStop: 'Parar e sair',
  relaunchBusyDetail: 'Reiniciar agora as interrompe, mas é necessário para que a nova permissão entre em vigor.', relaunchStop: 'Parar e reiniciar',
  cancel: 'Cancelar',
  remoteHeading: 'Estas chamadas já foram enviadas. Parar não as cancela no provedor, e elas ainda podem ser cobradas:',
  remoteMore: (count: number) => `e mais ${count}`,
  callKind: { agent: 'Tarefa do agente', task: 'Tarefa', transcribe: 'Transcrever', synthesizeSpeech: 'Gerar fala', generateImage: 'Gerar imagem', generateMusic: 'Gerar música', generateText: 'Gerar texto', modelTest: 'Verificar modelo', voiceClone: 'Clonar voz', agentTranslate: 'Traduzir' },
  webCreateNotWindow: 'Somente janelas do aplicativo podem criar abas web', webTooManyTabs: 'Há abas web demais abertas', webTabMissing: 'Esta aba web não existe mais', webClearNotWindow: 'Somente janelas do aplicativo podem limpar dados web', webOpenNotWindow: 'Somente janelas do aplicativo podem abrir links externos', webOpenScheme: 'Somente URLs http e https podem ser abertas',
  runtimeOlderCliBusy: (version: string, jobs: number | null) =>
    `Um Runtime do BaoCut mais antigo (${version}), iniciado pela linha de comando, ${jobs === null ? 'ainda está em execução' : `ainda tem trabalhos em andamento: ${jobs}`}. O BaoCut muda para esta versão sozinho quando ele terminar`,
};
