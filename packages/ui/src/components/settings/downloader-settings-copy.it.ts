import type { DownloaderSettingsMessages } from './downloader-settings-copy.ts';

export const it: DownloaderSettingsMessages = {
  lead: 'Per scaricare video dai link si usa yt-dlp. Scarica video, la trascrizione da un link e l’agente scaricano tutti con queste impostazioni.',
  toolGroup: 'Strumento di download',
  cookiesLead: 'I download usano l’accesso del browser, così puoi scaricare anche i video che richiedono l’accesso. Per impostazione predefinita si usano tutti i browser rilevati.',
  autoUpdate: "Aggiorna yt-dlp automaticamente",
  autoUpdateDesc:
    "Cerca una nuova versione stabile una volta al giorno. Se c’è, la copia scaricata da BaoCut viene sostituita dopo la verifica del checksum; fino ad allora puoi continuare a scaricare con la copia attuale. Uno yt-dlp installato da te non viene modificato.",
  autoUpdateChecked: (when: string, version: string) => `Ultimo controllo: ${when} · ultima versione ${version}`,
};
