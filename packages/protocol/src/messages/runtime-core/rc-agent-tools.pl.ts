import { pluralForm } from '../../i18n.ts';
import type { RcAgentToolsMessages } from './rc-agent-tools.ts';

function exportKindLabel(kind: string): string {
  const labels: Record<string, string> = { subtitles: 'napisy', transcript: 'transkrypcja', audio: 'audio', video: 'plik wideo', portable: 'pakiet przenośny', project: 'plik projektu' };
  return labels[kind] ?? kind;
}
function linkImportAfter(p: { target: string; name: string | null; transcribe: boolean; language: string | null; provider: string | null; model: string | null; captions: boolean; dir?: string | null }): string {
  // 文件放进指定目录：导入视频的照常说完，再说文件放在哪。
  if (p.dir && (p.target === 'create' || p.target === 'video')) return `${linkImportAfter({ ...p, dir: null })}, pobrany plik zapisz w ${p.dir}`;
  const recognition = `${p.language ? `, język ${p.language}` : ''}${p.provider ? ` (${p.provider}${p.model ? ` ${p.model}` : ''})` : ''}`;
  if (p.target === 'create') return `, utwórz wideo${p.name ? ` „${p.name}”` : ' (nazwa z tytułu strony)'} i dodaj na oś czasu${p.transcribe ? `, potem transkrybuj${recognition}${p.captions ? ' i utwórz warstwę napisów' : ''}` : ''}`;
  if (p.target === 'video') return `, importuj do wideo${p.transcribe ? ' i transkrybuj' : ''}`;
  if (p.target === 'project') return `, zapisz w downloads/ projektu${p.transcribe ? ' i transkrybuj do TXT i SRT' : ''}`;
  if (p.target === 'download') return `, zapisz w folderze „Pobrane”${p.transcribe ? ' i transkrybuj do TXT i SRT' : ''}`;
  if (p.target === 'folder') return `, zapisz w ${p.dir}${p.transcribe ? ' i transkrybuj do TXT i SRT' : ''}`;
  return '';
}

function linkImportCookies(p: { cookies: string | null }): string {
  return p.cookies ? `; użyj plików cookie logowania z ${p.cookies}` : '';
}

export const pl: RcAgentToolsMessages = {
  instructionsNotSet: "Instrukcje sesji nieustawione: błędna kolejność składania Runtime",

  listSeparator: ", ",
  clauseSeparator: "; ",

  createVideoSummary: (p) => `Utwórz wideo „${p.name}"`,
  slidesImportAssetSummary: (p) => `Zaimportuj „${p.file}” do slajdów „${p.deck}”`,
  designImportAssetSummary: (p) => `Zaimportuj „${p.file}” do projektu „${p.canvas}”`,
  designSystemImportAssetSummary: (p) => `Zaimportuj „${p.file}” do systemu projektowego „${p.system}”`,
  docsEditSummary: (p: { doc: string }) => `Edytuj dokument „${p.doc}”`,
  docsCreateSummary: (p: { doc: string }) => `Utwórz dokument „${p.doc}”`,
  docsCommentSummary: (p: { doc: string }) => `Skomentuj w dokumencie „${p.doc}”`,
  docsDeleteSummary: (p: { doc: string }) => `Usuń z dokumentu „${p.doc}”`,
  docsUploadSummary: (p: { file: string; doc: string }) => `Zaimportuj „${p.file}” do dokumentu „${p.doc}”`,
  docsExportSummary: (p: { file: string; doc: string }) => `Wyeksportuj dokument „${p.doc}” jako Markdown do „${p.file}”`,
  editsSummary: (p) => `${p.label} (${pluralForm('pl', p.count, { one: `${p.count} operacja`, few: `${p.count} operacje`, many: `${p.count} operacji`, other: `${p.count} operacji` })}: ${p.types})`,
  captionsSummary: (p) => `Dodaj: ${p.bilingual ? "dwujęzyczną " : ""}warstwę napisów dokumentu ${p.documentId}`,
  captionsLabel: "Dodaj warstwę napisów",
  undoSummary: (p) => `Cofnij zmianę ${p.transactionId}`,
  undoLatestSummary: "Cofnij ostatnią zmianę",
  saveVersionSummary: (p) => `Zapisz bieżący stan jako wersję „${p.name}”`,
  restoreVersionSummary: (p) => `Wróć do wersji ${p.version}`,
  restoreBeforeVersionSummary: (p) => `Wróć do stanu sprzed wersji ${p.version}`,
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
  openMediaSaveSummary: (p) => `Pobierz „${p.title}” z ${p.source} (${p.license}) do ${p.target} (z numerem przy zajętej nazwie, bez nadpisywania)`,
  openMediaDownloadSummary: (p) => `Pobierz „${p.title}” z ${p.source} (${p.license}) i zaimportuj${p.place ? " na oś czasu" : ""}`,
  sfxSummary: (p) => `Wygeneruj efekt dźwiękowy „${p.recipe}” i zaimportuj go${p.place ? ' na oś czasu' : ''}`,
 
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
  imageInputsSpaceUnavailable: 'Katalog Space nie jest jeszcze gotowy, więc nie można podać obrazów wejściowych jako pozycji Space',
  imageInputsPurpose: (p) => `Generuj obraz (obrazy wejściowe: ${p.inputs}): ${p.prompt}`,
  imagePurpose: (p) => `Generuj obraz: ${p.prompt}`,
  musicPurpose: (p: { style: string }) => `Wygeneruj muzykę: ${p.style}`,
  musicSummary: (p: { mode: string; seconds: number | null; provider: string | null; style: string }) => `Wygeneruj ${p.mode === 'song' ? 'piosenkę' : 'muzykę instrumentalną'}${p.seconds ? `, do ${p.seconds} s` : ''}${p.provider ? `, ${p.provider}` : ''}: ${p.style}`,
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
  linkImportSummary: (p) => `Pobierz z ${p.host} przez ${p.tool}${p.version ? ` ${p.version}` : ""}: ${p.url}${linkImportAfter(p)}${linkImportCookies(p)}`,
  linkImportConsentSummary: (p) => `Zezwól BaoCut używać ${p.tool}${p.version ? ` ${p.version}` : ""} na tym komputerze${p.path ? ` (${p.path})` : ""} dla pobierania wideo ze stron i pobierz z ${p.host}: ${p.url}${linkImportAfter(p)}${linkImportCookies(p)}`,

  downloadSaveSummary: (p) => `Skopiuj ${p.source} (${p.size}) z folderu roboczego do „Pobrane”: ${p.target} (z numerem przy zajętej nazwie, bez nadpisywania)`,

  grantSummary: (p) => `Udostępnij dane ${p.recipients}: ${p.items}`,
  grantSummaryItem: (p) => `${p.purpose} (${p.maxCalls === null ? "bez limitu wywołań" : `do ${pluralForm('pl', p.maxCalls, { one: `${p.maxCalls} wywołanie`, few: `${p.maxCalls} wywołania`, many: `${p.maxCalls} wywołań`, other: `${p.maxCalls} wywołania` })}`})`,

  testModelSummary: (p) => `Sprawdź lokalny pakiet modelu ${p.bundleId}: wykonaj w całości na stałej próbce`,
  installModelSummary: (p) => `Pobierz model lokalny ${p.bundleId}: ${p.estimated ? `około ${p.size} (rozmiar nieznany, szacunek)` : p.size}${p.resumed ? `, wznawiając ${p.resumed} już pobrane` : ""}, z ${p.source} (${p.parts})`,

  registerProjectSummary: (p) => `Zarejestruj istniejący folder ${p.path} jako projekt${p.name ? ` (${p.name})` : ""}`,
  createProjectSummary: (p) => `Utwórz folder projektu ${p.path}${p.name ? ` (${p.name})` : ""}`,
  adoptSessionSummary: (p) => `Utwórz projekt ${p.name ? `„${p.name}”` : 'o nazwie pierwszego wideo'} i przenieś do niego wideo i pliki tej sesji`,
  deriveVideoSummary: (p) => `Utwórz wideo pochodne „${p.name}” z fragmentu ${p.from}–${p.to} tego wideo`,
  deriveVideoLabel: (p) => `Pochodne od „${p.name}”`,
  derivationDocumentName: 'Źródło wideo pochodnego',
  deriveRangeEmpty: 'Po wyrównaniu do klatek zakres jest pusty',
  deriveUnsupportedItem: (p) => `Zakres zawiera klip, którego nie można skopiować do wideo pochodnego (${p.kind})`,
  deriveParentUnplaced: 'To wideo nie znajduje się w folderze projektu ani sesji, więc nie można obok niego utworzyć wideo pochodnego',
  shotsRangeEmpty: 'Po wyrównaniu do klatek zakres jest pusty',
  shotsRangeTooLong: (p) => `Zakres jest dłuższy niż ${p.minutes} min; wykrywaj ujęcia w krótszych częściach`,
};
