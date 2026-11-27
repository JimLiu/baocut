import type { DownloaderSettingsMessages } from './downloader-settings-copy.ts';

export const es: DownloaderSettingsMessages = {
  lead: 'Para descargar vídeos desde enlaces se usa yt-dlp. Descargar vídeo, transcribir desde un enlace y el agente descargan con estos ajustes.',
  toolGroup: 'Herramienta de descarga',
  cookiesLead: 'Las descargas usan tu sesión del navegador, así que también se pueden descargar vídeos que requieren iniciar sesión. De forma predeterminada se usan todos los navegadores detectados.',
  autoUpdate: "Actualizar yt-dlp automáticamente",
  autoUpdateDesc:
    "Busca una nueva versión estable una vez al día. Si la hay, reemplaza la copia que descargó BaoCut después de verificar su suma de comprobación; hasta entonces puedes seguir descargando con la copia actual. No cambia un yt-dlp que hayas instalado tú.",
  autoUpdateChecked: (when: string, version: string) => `Última comprobación: ${when} · versión más reciente ${version}`,
};
