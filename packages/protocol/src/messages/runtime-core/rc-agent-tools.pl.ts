import { pluralForm } from '../../i18n.ts';
import type { RcAgentToolsMessages } from './rc-agent-tools.ts';

function exportKindLabel(kind: string): string {
  const labels: Record<string, string> = { subtitles: 'napisy', transcript: 'transkrypcja', audio: 'audio', video: 'plik wideo', portable: 'pakiet przenośny', project: 'plik projektu' };
  return labels[kind] ?? kind;
}
function linkImportAfter(p: { target: string; name: string | null; transcribe: boolean; language: string | null; provider: string | null; model: string | null; captions: boolean }): string {
  const recognition = `${p.language ? `, język ${p.language}` : ''}${p.provider ? ` (${p.provider}${p.model ? ` ${p.model}` : ''})` : ''}`;
  if (p.target === 'create') return `, utwórz wideo${p.name ? ` „${p.name}”` : ' (nazwa z tytułu strony)'} i dodaj na oś czasu${p.transcribe ? `, potem transkrybuj${recognition}${p.captions ? ' i utwórz warstwę napisów' : ''}` : ''}`;
  if (p.target === 'video') return `, importuj do wideo${p.transcribe ? ' i transkrybuj' : ''}`;
  if (p.target === 'project') return `, zapisz w downloads/ projektu${p.transcribe ? ' i transkrybuj do TXT i SRT' : ''}`;
  if (p.target === 'download') return `, zapisz w folderze „Pobrane”${p.transcribe ? ' i transkrybuj do TXT i SRT' : ''}`;
  return '';
}

export const pl: RcAgentToolsMessages = {
  instructionsNotSet: "Instrukcje sesji nieustawione: błędna kolejność składania Runtime",

  listSeparator: ", ",
  clauseSeparator: "; ",

  createVideoSummary: (p) => `Utwórz wideo „${p.name}"`,
  editsSummary: (p) => `${p.label} (${pluralForm('pl', p.count, { one: `${p.count} operacja`, few: `${p.count} operacje`, many: `${p.count} operacji`, other: `${p.count} operacji` })}: ${p.types})`,
  captionsSummary: (p) => `Dodaj: ${p.bilingual ? "dwujęzyczną " : ""}warstwę napisów dokumentu ${p.documentId}`,
  captionsLabel: "Dodaj warstwę napisów",
  undoSummary: (p) => `Cofnij zmianę ${p.transactionId}`,
  undoLatestSummary: "Cofnij ostatnią zmianę",
  deleteVideoSummary: (p) => `Usuń wideo „${p.name}" (${p.path}): przenieś do kosza, skąd można przywrócić w Space przez ${pluralForm('pl', p.days, { one: `${p.days} dzień`, few: `${p.days} dni`, many: `${p.days} dni`, other: `${p.days} dnia` })}. Oryginalne pliki powiązanych materiałów zostają na miejscu`,
  importPackageSummary: (p) => `Otwórz pakiet przenośny ${p.file}`,
  renameVideoLabel: "Zmień nazwę wideo",
  putDocumentSummary: (p) => `Zapisz nową wersję dokumentu ${p.documentId}`,
  newDocumentSummary: (p) => `Utwórz dokument (${p.kind})`,
  updateDocumentLabel: (p) => `Zaktualizuj dokument „${p.name}"`,
  newDocumentLabel: (p) => `Utwórz dokument „${p.name}"`,
  translationDocumentName: (p) => `${p.language} – tłumaczenie`,
  importAssetSummary: (p) => `Importuj materiał ${p.name}${p.place ? " i dodaj na oś czasu" : ""}`,
  importAssetLabel: (p) => `Importuj ${p.name}${p.place ? " i dodaj na oś czasu" : ""}`,
  replaceCompositionSummary: (p) => `Importuj ${p.name} i zastąp nim klip ${p.clip} na osi czasu`,
  replaceCompositionLabel: (p) => `Zastąp grafikę animowaną przez ${p.name}`,
  pruneAssetsSummary: (p) => `Usuń z wideo nieużywane materiały (${p.count}): ${p.names}`,
  pruneAssetsLabel: (p) => `Usuń nieużywane materiały (${p.count})`,
  adoptChaptersSummary: (p) =>
    `Użyj rozdziałów ze źródła ${p.asset} (${p.count})${p.existing ? `, zastępując obecne rozdziały (${p.existing})` : ''}`,
  adoptChaptersLabel: 'Użyj rozdziałów ze źródła',

  transcribePurpose: (p) => `Transkrybuj materiał ${p.assetId}`,
  transcribeSummary: (p) => `Transkrybuj materiał ${p.assetId}${p.provider ? ` (${p.provider}${p.model ? ` ${p.model}` : ""})` : ""}`,
  speechPurpose: (p) => `Syntezuj mowę (${pluralForm('pl', p.chars, { one: `${p.chars} znak`, few: `${p.chars} znaki`, many: `${p.chars} znaków`, other: `${p.chars} znaku` })})`,
  speechSummary: (p) => `Syntezuj mowę (${pluralForm('pl', p.chars, { one: `${p.chars} znak`, few: `${p.chars} znaki`, many: `${p.chars} znaków`, other: `${p.chars} znaku` })}${p.provider ? `, ${p.provider}` : ""}${p.voice ? `, głos ${p.voice}` : ""})`,
  imagePurpose: (p) => `Generuj obraz: ${p.prompt}`,
  imageSummary: (p) => `Generuj ${pluralForm('pl', p.count, { one: `${p.count} obraz`, few: `${p.count} obrazy`, many: `${p.count} obrazów`, other: `${p.count} obrazu` })}${p.size ? `, ${p.size}` : ""}${p.provider ? `, ${p.provider}` : ""}: ${p.prompt}`,
  cancelJobSummary: (p) => `Anuluj zadanie ${p.jobId}`,
  retryPipelineSummary: (p) => `Ponów potok ${p.jobId} (${p.pipeline}, próba ${p.attempt}) od nieudanego kroku`,
  saveArtifactSummary: (p) => `Zapisz wynik ${p.artifactId} jako ${p.path}`,
  overwriteArtifactSummary: (p) => `Nadpisz istniejący plik ${p.path} wynikiem ${p.artifactId}`,

  exportSummary: (p) => {
    const range =
      p.rangeStart !== null ? `, ${p.rangeStart}–${p.rangeEnd}s` : p.rangeCount !== null ? `, ${pluralForm('pl', p.rangeCount, { one: `${p.rangeCount} zakres`, few: `${p.rangeCount} zakresy`, many: `${p.rangeCount} zakresów`, other: `${p.rangeCount} zakresu` })}` : "";
    const size =
      p.width !== null && p.height !== null
        ? `, ${p.width}×${p.height}`
        : p.width !== null
          ? `, szerokość ${p.width}`
          : p.height !== null
            ? `, wysokość ${p.height}`
            : "";
    const source = p.originalOnly ? ", tylko oryginalne audio" : p.dubGroupId ? `, dubbing ${p.dubGroupId} – tylko` : "";
    return `Eksportuj ${exportKindLabel(p.kind)} (${p.format}${range}${size}${source})${p.fileName ? ` jako ${p.fileName}` : ""}${p.overwrite ? ", nadpisując istniejący plik" : ""}`;
  },

  installToolSummary: (p) => `Zainstaluj ${p.tool} ${p.version} (${p.estimated ? `około ${p.size}` : p.size}, ${p.license}) z ${p.url} dla pobierania wideo z linków; pobieranie z ${p.host} wymaga go`,
  linkImportSummary: (p) => `Pobierz z ${p.host} przez ${p.tool}${p.version ? ` ${p.version}` : ""}: ${p.url}${linkImportAfter(p)}`,
  linkImportConsentSummary: (p) => `Zezwól BaoCut używać ${p.tool}${p.version ? ` ${p.version}` : ""} na tym komputerze${p.path ? ` (${p.path})` : ""} dla pobierania wideo ze stron i pobierz z ${p.host}: ${p.url}${linkImportAfter(p)}`,

  downloadSaveSummary: (p) => `Skopiuj ${p.source} (${p.size}) z folderu roboczego do „Pobrane”: ${p.target} (z numerem przy zajętej nazwie, bez nadpisywania)`,

  grantSummary: (p) => `Udostępnij dane ${p.recipients}: ${p.items}`,
  grantSummaryItem: (p) => `${p.purpose} (${p.maxCalls === null ? "bez limitu wywołań" : `do ${pluralForm('pl', p.maxCalls, { one: `${p.maxCalls} wywołanie`, few: `${p.maxCalls} wywołania`, many: `${p.maxCalls} wywołań`, other: `${p.maxCalls} wywołania` })}`})`,

  testModelSummary: (p) => `Sprawdź lokalny pakiet modelu ${p.bundleId}: wykonaj w całości na stałej próbce`,
  installModelSummary: (p) => `Pobierz model lokalny ${p.bundleId}: ${p.estimated ? `około ${p.size} (rozmiar nieznany, szacunek)` : p.size}${p.resumed ? `, wznawiając ${p.resumed} już pobrane` : ""}, z ${p.source} (${p.parts})`,

  registerProjectSummary: (p) => `Zarejestruj istniejący folder ${p.path} jako projekt${p.name ? ` (${p.name})` : ""}`,
  createProjectSummary: (p) => `Utwórz folder projektu ${p.path}${p.name ? ` (${p.name})` : ""}`,
};
