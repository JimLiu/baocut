function exportKindLabel(kind: string): string {
  const labels: Record<string, string> = { subtitles: 'ondertitels', transcript: 'transcript', audio: 'audio', video: 'videobestand', portable: 'draagbaar pakket', project: 'projectbestand' };
  return labels[kind] ?? kind;
}
function linkImportAfter(p: { target: string; name: string | null; transcribe: boolean; language: string | null; provider: string | null; model: string | null; captions: boolean }): string {
  const recognition = `${p.language ? `, taal ${p.language}` : ''}${p.provider ? ` (${p.provider}${p.model ? ` ${p.model}` : ''})` : ''}`;
  if (p.target === 'create') return `, video maken${p.name ? ` ‘${p.name}’` : ' (vernoemd naar de paginatitel)'} en toevoegen aan de tijdlijn${p.transcribe ? `, daarna transcriberen${recognition}${p.captions ? ' en een ondertitellaag maken' : ''}` : ''}`;
  if (p.target === 'video') return `, importeren in de video${p.transcribe ? ' en transcriberen' : ''}`;
  if (p.target === 'project') return `, opslaan in downloads/ van het project${p.transcribe ? ' en transcriberen naar TXT en SRT' : ''}`;
  if (p.target === 'download') return `, opslaan in de downloadmap${p.transcribe ? ' en transcriberen naar TXT en SRT' : ''}`;
  return '';
}
import { pluralForm } from '../../i18n.ts';
import type { RcAgentToolsMessages } from './rc-agent-tools.ts';

export const nl: RcAgentToolsMessages = {
  instructionsNotSet: "Sessie-instructies zijn niet ingesteld: de samenstellingsvolgorde van de Runtime is onjuist",


  listSeparator: ", ",

  clauseSeparator: "; ",

  createVideoSummary: (p: { name: string }) => `Video maken: ‘${p.name}’`,
  editsSummary: (p: { label: string; count: number; types: string }) =>
    `${p.label} (${`${p.count} ${pluralForm('nl', p.count, { one: "actie", other: "acties" })}`}: ${p.types})`,
  captionsSummary: (p: { documentId: string; bilingual: boolean }) =>
    `Toevoegen: ${p.bilingual ? "tweetalige " : ""}ondertitellaag voor document ${p.documentId}`,

  captionsLabel: "Ondertitellaag toevoegen",
  undoSummary: (p: { transactionId: string }) => `Bewerking ongedaan maken: ${p.transactionId}`,
  undoLatestSummary: "Laatste bewerking ongedaan maken",
  deleteVideoSummary: (p: { name: string; path: string; days: number }) =>
    `Video verwijderen: ‘${p.name}’ (${p.path}): verplaatsen naar de prullenmand; herstellen in Space kan gedurende ${`${p.days} ${pluralForm('nl', p.days, { one: "dag", other: "dagen" })}`}. De oorspronkelijke bestanden van gekoppelde media blijven staan`,
  importPackageSummary: (p: { file: string }) => `Draagbaar pakket openen: ${p.file}`,

  renameVideoLabel: "Video hernoemen",
  putDocumentSummary: (p: { documentId: string }) => `Nieuwe versie van document schrijven: ${p.documentId}`,
  newDocumentSummary: (p: { kind: string }) => `Document maken (${p.kind})`,

  updateDocumentLabel: (p: { name: string }) => `Document bijwerken: ‘${p.name}’`,
  newDocumentLabel: (p: { name: string }) => `Document maken: ‘${p.name}’`,

  translationDocumentName: (p: { language: string }) => `${p.language} vertaling`,
  importAssetSummary: (p: { name: string; place: boolean }) => `Media importeren: ${p.name}${p.place ? " en toevoegen aan de tijdlijn" : ""}`,

  importAssetLabel: (p: { name: string; place: boolean }) => `Importeren: ${p.name}${p.place ? " en toevoegen aan de tijdlijn" : ""}`,
  replaceCompositionSummary: (p: { name: string; clip: string }) => `${p.name} importeren en clip ${p.clip} op de tijdlijn ermee vervangen`,
  replaceCompositionLabel: (p: { name: string }) => `Bewegende graphic vervangen door ${p.name}`,
  pruneAssetsSummary: (p) => `Ongebruikt materiaal uit de video verwijderen (${p.count}): ${p.names}`,
  pruneAssetsLabel: (p) => `Ongebruikt materiaal verwijderen (${p.count})`,
  adoptChaptersSummary: (p) =>
    `Hoofdstukken uit de bron van ${p.asset} overnemen (${p.count})${p.existing ? `, vervangt de huidige hoofdstukken (${p.existing})` : ''}`,
  adoptChaptersLabel: 'Hoofdstukken uit de bron overnemen',

  transcribePurpose: (p: { assetId: string }) => `Media transcriberen: ${p.assetId}`,
  transcribeSummary: (p: { assetId: string; provider: string | null; model: string | null }) =>
    `Media transcriberen: ${p.assetId}${p.provider ? ` (${p.provider}${p.model ? ` ${p.model}` : ""})` : ""}`,
  speechPurpose: (p: { chars: number }) => `Spraak synthetiseren (${`${p.chars} ${pluralForm('nl', p.chars, { one: "teken", other: "tekens" })}`})`,
  speechSummary: (p: { chars: number; provider: string | null; voice: string | null }) =>
    `Spraak synthetiseren (${`${p.chars} ${pluralForm('nl', p.chars, { one: "teken", other: "tekens" })}`}${p.provider ? `, ${p.provider}` : ""}${p.voice ? `, stem ${p.voice}` : ""})`,
  imagePurpose: (p: { prompt: string }) => `Afbeelding genereren: ${p.prompt}`,
  imageSummary: (p: { count: number; size: string | null; provider: string | null; prompt: string }) =>
    `Genereren: ${`${p.count} ${pluralForm('nl', p.count, { one: "afbeelding", other: "afbeeldingen" })}`}${p.size ? `, ${p.size}` : ""}${p.provider ? `, ${p.provider}` : ""}: ${p.prompt}`,
  cancelJobSummary: (p: { jobId: string }) => `Taak annuleren: ${p.jobId}`,
  retryPipelineSummary: (p: { jobId: string; pipeline: string; attempt: number }) =>
    `Pipeline opnieuw uitvoeren: ${p.jobId} (${p.pipeline}, poging ${p.attempt}) vanaf de mislukte stap`,
  saveArtifactSummary: (p: { artifactId: string; path: string }) => `Uitvoer opslaan: ${p.artifactId} als ${p.path}`,
  overwriteArtifactSummary: (p: { artifactId: string; path: string }) =>
    `Bestaand bestand overschrijven: ${p.path} met uitvoer ${p.artifactId}`,

  exportSummary: (p: {
    kind: string;
    format: string;
    rangeStart: number | null;
    rangeEnd: number | null;
    rangeCount: number | null;
    width: number | null;
    height: number | null;
    originalOnly: boolean;
    dubGroupId: string | null;
    fileName: string | null;
    overwrite: boolean;
  }) => {
    const range =
      p.rangeStart !== null ? `, ${p.rangeStart}–${p.rangeEnd}s` : p.rangeCount !== null ? `, ${`${p.rangeCount} ${pluralForm('nl', p.rangeCount, { one: "bereik", other: "bereiken" })}`}` : "";
    const size =
      p.width !== null && p.height !== null
        ? `, ${p.width}×${p.height}`
        : p.width !== null
          ? `, breedte ${p.width}`
          : p.height !== null
            ? `, hoogte ${p.height}`
            : "";
    const source = p.originalOnly ? ", alleen oorspronkelijke audio" : p.dubGroupId ? `, nasynchronisatie ${p.dubGroupId} alleen` : "";
    return `Exporteren: ${exportKindLabel(p.kind)} (${p.format}${range}${size}${source})${p.fileName ? ` als ${p.fileName}` : ""}${p.overwrite ? ", het bestaande bestand overschrijven" : ""}`;
  },

  installToolSummary: (p: { tool: string; version: string; size: string; estimated: boolean; license: string; url: string; host: string }) =>
    `Installeren: ${p.tool} ${p.version} (${p.estimated ? `ongeveer ${p.size}` : p.size}, ${p.license}) van ${p.url} om video’s te downloaden via links; downloaden van ${p.host} vereist dit`,
  linkImportSummary: (p: { tool: string; version: string; host: string; url: string; target: string; name: string | null; transcribe: boolean; language: string | null; provider: string | null; model: string | null; captions: boolean }) =>
    `Downloaden van ${p.host} met ${p.tool}${p.version ? ` ${p.version}` : ""}: ${p.url}${linkImportAfter(p)}`,
  linkImportConsentSummary: (p: {
    tool: string;
    version: string;
    path: string;
    host: string;
    url: string;
    target: string;
    name: string | null;
    transcribe: boolean;
    language: string | null;
    provider: string | null;
    model: string | null;
    captions: boolean;
  }) =>
    `BaoCut toestemming geven voor het gebruik van ${p.tool}${p.version ? ` ${p.version}` : ""} op deze computer${p.path ? ` (${p.path})` : ""} om video’s van websites te downloaden en downloaden van ${p.host}: ${p.url}${linkImportAfter(p)}`,

  downloadSaveSummary: (p: { source: string; size: string; target: string }) =>
    `Kopiëren: ${p.source} (${p.size}) vanuit de werkmap naar de downloadmap: ${p.target} (genummerd als de naam al bestaat, nooit overschreven)`,

  grantSummary: (p: { recipients: string; items: string }) => `Gegevens delen met ${p.recipients}: ${p.items}`,
  grantSummaryItem: (p: { purpose: string; maxCalls: number | null }) =>
    `${p.purpose} (${p.maxCalls === null ? "geen aanroeplimiet" : `tot ${`${p.maxCalls} ${pluralForm('nl', p.maxCalls, { one: "aanroep", other: "aanroepen" })}`}`})`,

  testModelSummary: (p: { bundleId: string }) => `Lokaal modelpakket controleren: ${p.bundleId}: volledig uitvoeren op een vast voorbeeld`,
  installModelSummary: (p: { bundleId: string; size: string; estimated: boolean; resumed: string | null; source: string; parts: string }) =>
    `Lokaal model downloaden: ${p.bundleId}: ${p.estimated ? `ongeveer ${p.size} (grootte onbekend, geschat)` : p.size}${p.resumed ? `, hervatten met ${p.resumed} al gedownload` : ""}, van ${p.source} (${p.parts})`,

  registerProjectSummary: (p: { path: string; name: string | null }) =>
    `Bestaande map registreren: ${p.path} als project${p.name ? ` (${p.name})` : ""}`,
  createProjectSummary: (p: { path: string; name: string | null }) => `Projectmap maken: ${p.path}${p.name ? ` (${p.name})` : ""}`,
  adoptSessionSummary: (p: { name: string | null }) =>
    `Project ${p.name ? `‘${p.name}’` : 'met de naam van de eerste video'} maken en de video’s en bestanden van deze sessie erheen verplaatsen`,
};
