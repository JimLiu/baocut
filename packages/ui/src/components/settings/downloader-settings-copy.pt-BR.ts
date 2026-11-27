import type { DownloaderSettingsMessages } from './downloader-settings-copy.ts';

export const ptBR: DownloaderSettingsMessages = {
  lead: 'O download de vídeos a partir de links usa o yt-dlp. Baixar vídeo, transcrever a partir de um link e o agente baixam com estas configurações.',
  toolGroup: 'Ferramenta de download',
  cookiesLead: 'Os downloads usam seu login do navegador, então vídeos que exigem login também podem ser baixados. Por padrão, todos os navegadores detectados são usados.',
  autoUpdate: "Atualizar o yt-dlp automaticamente",
  autoUpdateDesc:
    "Procura uma nova versão estável uma vez por dia. Se houver, a cópia que o BaoCut baixou é substituída depois que a soma de verificação é conferida; até lá, você pode continuar baixando com a cópia atual. Um yt-dlp que você instalou não é alterado.",
  autoUpdateChecked: (when: string, version: string) => `Última verificação: ${when} · versão mais recente ${version}`,
};
