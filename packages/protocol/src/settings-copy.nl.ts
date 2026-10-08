import type { SettingKey } from './settings.ts';
import { LOCALES } from './i18n.ts';
import type { SettingDescriptionMessages } from './settings-copy.ts';

export const nl: SettingDescriptionMessages = {
  'agent.defaultDriver': "Agent voor nieuwe sessies; null gebruikt de ingebouwde standaard (codex). Wordt vastgelegd bij het maken van een sessie",
  'agent.defaultModel': "Model voor nieuwe sessies; null gebruikt het aanbevolen model (Sonnet voor Claude Code, een -sol-model voor Codex), __agent-default__ geeft geen model door en volgt de eigen CLI-configuratie van de agent",
  'agent.defaultEffort': "Denkintensiteit voor nieuwe sessies; null gebruikt de eigen standaard van de agent",
  'agent.defaultAccessMode':
    "Gebruikt door sessies die nooit van toegangsmodus zijn veranderd: ask, autoAcceptEdits, auto, fullAccess of plan (de oude waarden controlled en authorized worden behandeld als ask en fullAccess)",
  'ui.language': `Interfacetaal: system volgt de systeemtaal (Engels als er geen passende taal is) of een taalcode (${LOCALES.join(", ")}). Tekst die de Runtime aan mensen toont gebruikt deze taal ook`,
  'captions.maxLineLength': "Gewenste regellengte voor automatische regeleinden (tekens): cjk voor Chinese, Japanse en Koreaanse tekst, other voor de rest",
  'transcribe.afterComplete': "Na transcriptie: open-video opent de video, notify geeft alleen een melding, nothing doet niets",
  'downloads.directory':
    "Standaardopslaglocatie voor toolresultaten zonder video, media gedownload via links en bestanden overgedragen door downloads_save (absoluut pad); null gebruikt ~/Downloads op deze host, ongeacht het project",
  'models.downloadEndpoint':
    "Downloadbron voor lokale modellen (basis-URL van spiegelserver, http(s)://); null gebruikt de openbare modelhub. De omgevingsvariabele BAOCUT_MODELS_ENDPOINT heeft voorrang",
  'models.dir':
    "Map voor lokale modellen (absoluut pad); null gebruikt models in de gegevensmap. De omgevingsvariabele BAOCUT_MODELS_DIR heeft voorrang. Wijzig die met models.setDir, niet settings set",
  'tools.downloadEndpoint':
    "Downloadbron voor beheerde externe tools (yt-dlp) (basis-URL van spiegelserver, http(s)://, bestanden op <base>/<tool>/<version>/<file>); null gebruikt de officiële release-URL. De omgevingsvariabele BAOCUT_TOOLS_ENDPOINT heeft voorrang",
  'fonts.autoDownload':
    "Download automatisch lettertypen die nodig zijn voor de lay-out, niet op deze computer staan en in de lettertypecatalogus staan (voorbeeld en export); als dit uitstaat wordt een vervangend lettertype gebruikt met een melding",
  'fonts.cssEndpoint': "Basis-URL van de lettertype-CSS-API (spiegelserver, https://); null gebruikt https://fonts.googleapis.com",
  'fonts.fileEndpoint': "Basis-URL voor lettertypebestanden (spiegelserver, https://; bestanden worden alleen daaronder opgehaald); null gebruikt https://fonts.gstatic.com",
  'space.trashRetentionDays':
    "Dagen om items in de Space-prullenmand te bewaren (1–3650): oudere niet-gebruikte items en verwijderde video’s worden periodiek definitief verwijderd",
  'resources.capacity':
    "Geavanceerd: machinecapaciteit voor middelenplanning { memoryMiB, gpuMemoryMiB, cpuThreads }; een item ingesteld op null wordt automatisch gedetecteerd; null detecteert alles (geheugen en CPU komen van het systeem, GPU-geheugen op Apple silicon wordt geschat vanuit gedeeld geheugen)",
  'runtime.idleExitMinutes':
    "Minuten dat een door de CLI gestarte Runtime inactief blijft voordat die zelf afsluit (1–1440): geen verbindingen, taken of open externe diensten. De desktop-app en handmatig gestarte Runtimes worden niet beïnvloed",
  'updates.autoCheck': "Automatisch controleren op app-updates",
  'updates.autoDownload': "Nieuwe versies op de achtergrond downloaden (zonder automatisch te installeren)",
  'diagnostics.enabled': "Anonieme gebruiksstatistieken en prestatiesamenvattingen verzenden (geen media, tekst of paden)",
  'offline.strict': "Strikte offlinemodus: niets naar onlinediensten sturen",
} satisfies Record<SettingKey, string>;
