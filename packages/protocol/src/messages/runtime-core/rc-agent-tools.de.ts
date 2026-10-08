function exportKindLabel(kind: string): string {
  const labels: Record<string, string> = { subtitles: 'Untertitel', transcript: 'Transkript', audio: 'Audio', video: 'Videodatei', portable: 'portables Paket', project: 'Projektdatei' };
  return labels[kind] ?? kind;
}
function linkImportAfter(p: { target: string; name: string | null; transcribe: boolean; language: string | null; provider: string | null; model: string | null; captions: boolean }): string {
  const recognition = `${p.language ? `, Sprache ${p.language}` : ''}${p.provider ? ` (${p.provider}${p.model ? ` ${p.model}` : ''})` : ''}`;
  if (p.target === 'create') return `, Video erstellen${p.name ? ` „${p.name}“` : ' (nach dem Seitentitel benannt)'} und in die Zeitleiste einfügen${p.transcribe ? `, dann transkribieren${recognition}${p.captions ? ' und eine Untertitel-Ebene erstellen' : ''}` : ''}`;
  if (p.target === 'video') return `, ins Video importieren${p.transcribe ? ' und transkribieren' : ''}`;
  if (p.target === 'project') return `, im Projektordner downloads/ speichern${p.transcribe ? ' und in TXT und SRT transkribieren' : ''}`;
  if (p.target === 'download') return `, im Downloadordner speichern${p.transcribe ? ' und in TXT und SRT transkribieren' : ''}`;
  return '';
}
import { pluralForm } from '../../i18n.ts';
import type { RcAgentToolsMessages } from './rc-agent-tools.ts';

export const de: RcAgentToolsMessages = {
  instructionsNotSet: "Sitzungsanweisungen wurden nicht festgelegt: falsche Runtime-Zusammenstellungsreihenfolge",


  listSeparator: ", ",

  clauseSeparator: "; ",

  createVideoSummary: (p: { name: string }) => `Video erstellen: „${p.name}“`,
  editsSummary: (p: { label: string; count: number; types: string }) =>
    `${p.label} (${`${p.count} ${pluralForm('de', p.count, { one: "Operation", other: "Operationen" })}`}: ${p.types})`,
  captionsSummary: (p: { documentId: string; bilingual: boolean }) =>
    `Hinzufügen: ${p.bilingual ? "zweisprachige " : ""}Untertitel-Ebene für Dokument ${p.documentId}`,

  captionsLabel: "Untertitel-Ebene hinzufügen",
  undoSummary: (p: { transactionId: string }) => `Bearbeitung rückgängig machen: ${p.transactionId}`,
  undoLatestSummary: "Letzte Bearbeitung rückgängig machen",
  deleteVideoSummary: (p: { name: string; path: string; days: number }) =>
    `Video löschen: „${p.name}“ (${p.path}): in den Papierkorb verschieben; Wiederherstellung in Space möglich für ${`${p.days} ${pluralForm('de', p.days, { one: "Tag", other: "Tage" })}`}. Originaldateien verknüpfter Materialien bleiben an ihrem Speicherort`,
  importPackageSummary: (p: { file: string }) => `Portables Paket öffnen: ${p.file}`,

  renameVideoLabel: "Video umbenennen",
  putDocumentSummary: (p: { documentId: string }) => `Neue Version des Dokuments schreiben: ${p.documentId}`,
  newDocumentSummary: (p: { kind: string }) => `Dokument erstellen (${p.kind})`,

  updateDocumentLabel: (p: { name: string }) => `Dokument aktualisieren: „${p.name}“`,
  newDocumentLabel: (p: { name: string }) => `Dokument erstellen: „${p.name}“`,

  translationDocumentName: (p: { language: string }) => `${p.language} Übersetzung`,
  importAssetSummary: (p: { name: string; place: boolean }) => `Material importieren: ${p.name}${p.place ? " und in die Zeitleiste einfügen" : ""}`,

  importAssetLabel: (p: { name: string; place: boolean }) => `Importieren: ${p.name}${p.place ? " und in die Zeitleiste einfügen" : ""}`,
  replaceCompositionSummary: (p: { name: string; clip: string }) =>
    `${p.name} importieren und Clip ${p.clip} in der Zeitleiste damit ersetzen`,
  replaceCompositionLabel: (p: { name: string }) => `Motion-Grafik ersetzen durch ${p.name}`,
  pruneAssetsSummary: (p) => `Nicht verwendetes Material aus dem Video entfernen (${p.count}): ${p.names}`,
  pruneAssetsLabel: (p) => `Nicht verwendetes Material entfernen (${p.count})`,
  adoptChaptersSummary: (p) =>
    `Kapitel aus der Quelle von ${p.asset} übernehmen (${p.count})${p.existing ? `, ersetzt die vorhandenen Kapitel (${p.existing})` : ''}`,
  adoptChaptersLabel: 'Kapitel aus der Quelle übernehmen',

  transcribePurpose: (p: { assetId: string }) => `Material transkribieren: ${p.assetId}`,
  transcribeSummary: (p: { assetId: string; provider: string | null; model: string | null }) =>
    `Material transkribieren: ${p.assetId}${p.provider ? ` (${p.provider}${p.model ? ` ${p.model}` : ""})` : ""}`,
  speechPurpose: (p: { chars: number }) => `Sprache synthetisieren (${`${p.chars} ${pluralForm('de', p.chars, { one: "Zeichen", other: "Zeichen" })}`})`,
  speechSummary: (p: { chars: number; provider: string | null; voice: string | null }) =>
    `Sprache synthetisieren (${`${p.chars} ${pluralForm('de', p.chars, { one: "Zeichen", other: "Zeichen" })}`}${p.provider ? `, ${p.provider}` : ""}${p.voice ? `, Stimme ${p.voice}` : ""})`,
  imagePurpose: (p: { prompt: string }) => `Bild erzeugen: ${p.prompt}`,
  imageSummary: (p: { count: number; size: string | null; provider: string | null; prompt: string }) =>
    `Erzeugen: ${`${p.count} ${pluralForm('de', p.count, { one: "Bild", other: "Bilder" })}`}${p.size ? `, ${p.size}` : ""}${p.provider ? `, ${p.provider}` : ""}: ${p.prompt}`,
  cancelJobSummary: (p: { jobId: string }) => `Aufgabe abbrechen: ${p.jobId}`,
  retryPipelineSummary: (p: { jobId: string; pipeline: string; attempt: number }) =>
    `Pipeline erneut ausführen: ${p.jobId} (${p.pipeline}, Versuch ${p.attempt}) ab dem fehlgeschlagenen Schritt`,
  saveArtifactSummary: (p: { artifactId: string; path: string }) => `Ergebnis speichern: ${p.artifactId} als ${p.path}`,
  overwriteArtifactSummary: (p: { artifactId: string; path: string }) =>
    `Vorhandene Datei überschreiben: ${p.path} mit Ergebnis ${p.artifactId}`,

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
      p.rangeStart !== null ? `, ${p.rangeStart}–${p.rangeEnd}s` : p.rangeCount !== null ? `, ${`${p.rangeCount} ${pluralForm('de', p.rangeCount, { one: "Bereich", other: "Bereiche" })}`}` : "";
    const size =
      p.width !== null && p.height !== null
        ? `, ${p.width}×${p.height}`
        : p.width !== null
          ? `, Breite ${p.width}`
          : p.height !== null
            ? `, Höhe ${p.height}`
            : "";
    const source = p.originalOnly ? ", nur Originalton" : p.dubGroupId ? `, Vertonung ${p.dubGroupId} allein` : "";
    return `Exportieren: ${exportKindLabel(p.kind)} (${p.format}${range}${size}${source})${p.fileName ? ` als ${p.fileName}` : ""}${p.overwrite ? ", vorhandene Datei überschreiben" : ""}`;
  },

  installToolSummary: (p: { tool: string; version: string; size: string; estimated: boolean; license: string; url: string; host: string }) =>
    `Installieren: ${p.tool} ${p.version} (${p.estimated ? `etwa ${p.size}` : p.size}, ${p.license}) von ${p.url} zum Herunterladen von Videos aus Links; Download von ${p.host} benötigt dies`,
  linkImportSummary: (p: { tool: string; version: string; host: string; url: string; target: string; name: string | null; transcribe: boolean; language: string | null; provider: string | null; model: string | null; captions: boolean }) =>
    `Herunterladen von ${p.host} mit ${p.tool}${p.version ? ` ${p.version}` : ""}: ${p.url}${linkImportAfter(p)}`,
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
    `BaoCut die Nutzung erlauben von ${p.tool}${p.version ? ` ${p.version}` : ""} auf diesem Computer${p.path ? ` (${p.path})` : ""} zum Herunterladen von Videos von Websites und Download von ${p.host}: ${p.url}${linkImportAfter(p)}`,

  downloadSaveSummary: (p: { source: string; size: string; target: string }) =>
    `Kopieren: ${p.source} (${p.size}) aus dem Arbeitsordner in den Downloadordner: ${p.target} (bei vergebenem Namen nummeriert, niemals überschrieben)`,

  grantSummary: (p: { recipients: string; items: string }) => `Daten weitergeben an ${p.recipients}: ${p.items}`,
  grantSummaryItem: (p: { purpose: string; maxCalls: number | null }) =>
    `${p.purpose} (${p.maxCalls === null ? "kein Aufruflimit" : `bis zu ${`${p.maxCalls} ${pluralForm('de', p.maxCalls, { one: "Aufruf", other: "Aufrufe" })}`}`})`,

  testModelSummary: (p: { bundleId: string }) => `Lokales Modellpaket prüfen: ${p.bundleId}: mit einer festen Probe vollständig ausführen`,
  installModelSummary: (p: { bundleId: string; size: string; estimated: boolean; resumed: string | null; source: string; parts: string }) =>
    `Lokales Modell herunterladen: ${p.bundleId}: ${p.estimated ? `etwa ${p.size} (Größe unbekannt, geschätzt)` : p.size}${p.resumed ? `, fortsetzen mit ${p.resumed} bereits heruntergeladen` : ""}, von ${p.source} (${p.parts})`,

  registerProjectSummary: (p: { path: string; name: string | null }) =>
    `Vorhandenen Ordner registrieren: ${p.path} als Projekt${p.name ? ` (${p.name})` : ""}`,
  createProjectSummary: (p: { path: string; name: string | null }) => `Projektordner erstellen: ${p.path}${p.name ? ` (${p.name})` : ""}`,
  adoptSessionSummary: (p: { name: string | null }) =>
    `Projekt ${p.name ? `„${p.name}“` : 'mit dem Namen des ersten Videos'} erstellen und die Videos und Dateien dieser Sitzung dorthin verschieben`,
};
