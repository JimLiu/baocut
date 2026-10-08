import type { MainMessages } from './main-copy.ts';

export const ptBR: MainMessages = {
  about: (app: string) => `Sobre ${app}`, services: 'Serviços', hide: (app: string) => `Ocultar ${app}`, hideOthers: 'Ocultar outros', showAll: 'Mostrar tudo', quit: (app: string) => `Sair de ${app}`, exit: 'Sair',
  fileMenu: 'Arquivo', closeWindow: 'Fechar janela', close: 'Fechar', editMenu: 'Editar', undo: 'Desfazer', redo: 'Refazer', cut: 'Cortar', copy: 'Copiar', paste: 'Colar', pasteAndMatchStyle: 'Colar com o mesmo estilo', delete: 'Excluir', selectAll: 'Selecionar tudo',
  speech: 'Fala', startSpeaking: 'Começar a falar', stopSpeaking: 'Parar de falar', viewMenu: 'Exibir', reload: 'Recarregar', forceReload: 'Forçar recarregamento', toggleDevTools: 'Alternar ferramentas de desenvolvedor', actualSize: 'Tamanho real', zoomIn: 'Ampliar', zoomOut: 'Reduzir', toggleFullScreen: 'Alternar tela cheia', windowMenu: 'Janela', minimize: 'Minimizar', zoom: 'Zoom', bringAllToFront: 'Trazer tudo para frente',
  openProjectTitle: 'Abrir pasta do projeto', open: 'Abrir', choose: 'Escolher', importAssetsTitle: 'Importar mídias', importButton: 'Importar', mediaFilter: 'Vídeos, áudio e imagens', allFilesFilter: 'Todos os arquivos', openFileTitle: 'Abrir arquivo', save: 'Salvar',
  runtimeNoDiscovery: 'O Runtime iniciou, mas não gravou seu arquivo de descoberta', runtimeTimeout: 'O Runtime demorou demais para iniciar',
  runtimeExited: (code: number | null) => `O Runtime não iniciou (código de saída ${code})`,
  runtimeQuitting: 'O app está sendo encerrado',
  webCreateNotWindow: 'Somente janelas do aplicativo podem criar abas web', webTooManyTabs: 'Há abas web demais abertas', webTabMissing: 'Esta aba web não existe mais', webClearNotWindow: 'Somente janelas do aplicativo podem limpar dados web', webOpenNotWindow: 'Somente janelas do aplicativo podem abrir links externos', webOpenScheme: 'Somente URLs http e https podem ser abertas',
};
