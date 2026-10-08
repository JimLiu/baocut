import type { FontMessages } from './font-copy.ts';

export const ptBR: FontMessages = {
  cancelDownload: 'Cancelar download', searchFonts: 'Pesquisar fontes', searchFontsPlaceholder: 'Pesquisar fontes…',
  category: 'Categoria', allCategories: 'Todas as categorias', script: 'Sistema de escrita', allScripts: 'Todos os sistemas de escrita',
  listFailed: 'Não foi possível obter a lista de fontes', listLoading: 'Obtendo lista de fontes…', noMatch: 'Nenhuma fonte correspondente',
  downloadable: (count: string) => ` · ${count} disponíveis para baixar`,
  use: (family: string) => `Usar ${family}`, download: 'Baixar',
  downloadFamily: (family: string) => `Baixar ${family}`, cancelDownloadFamily: (family: string) => `Cancelar download de ${family}`,
  retryTip: (message: string) => `Tentar novamente · ${message}`, retryFamily: (family: string) => `Tentar baixar ${family} novamente`,
  detailsTip: 'Detalhes e licença da fonte', detailsFamily: (family: string) => `Detalhes e licença de ${family}`,
  skipThis: 'Ignorar esta', cancelAllTip: 'Cancelar tudo · usar fontes alternativas por enquanto', cancelAll: 'Cancelar tudo',
  collapse: 'Ocultar', view: 'Ver', gotIt: 'Entendi', settings: 'Configurações', progress: 'Progresso do download de fontes', retry: 'Tentar novamente',
  systemFont: 'Fonte do sistema', pingFang: 'PingFang SC', songti: 'Songti SC', kaiti: 'Kaiti SC', font: 'Fonte',
  fontValue: (label: string, font: string) => `${label}: ${font}`,
  backToList: 'Voltar à lista de fontes', deleteDownloaded: 'Excluir arquivos baixados', useThis: 'Usar esta fonte',
};
