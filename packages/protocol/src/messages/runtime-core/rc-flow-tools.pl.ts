import { pluralForm } from '../../i18n.ts';
import type { RcFlowToolsMessages } from './rc-flow-tools.ts';

function providerNote(p: { provider: string | null; model: string | null }): string {
  return p.provider ? ` (${p.provider}${p.model ? ` ${p.model}` : ''})` : '';
}

function originalAction(original: string): string {
  switch (original) {
    case 'mute':
      return 'wycisz';
    case 'keep':
      return 'zachowaj';
    default:
      return 'przycisz';
  }
}

function transcodeAction(action: string, count: number): string {
  switch (action) {
    case 'merge':
      return "Połącz w kolejności: " + pluralForm('pl', count, { one: `${count} plik`, few: `${count} pliki`, many: `${count} plików`, other: `${count} pliku` });
    case 'extract-audio':
      return "Wyodrębnij audio: " + pluralForm('pl', count, { one: `${count} plik`, few: `${count} pliki`, many: `${count} plików`, other: `${count} pliku` });
    default:
      return "Skompresuj: " + pluralForm('pl', count, { one: `${count} plik`, few: `${count} pliki`, many: `${count} plików`, other: `${count} pliku` });
  }
}

export const pl: RcFlowToolsMessages = {
  listSeparator: ", ",

  transcribeVideoSummary: (p) => `Transkrybuj ${p.asset ? `materiał ${p.asset}` : "materiał na głównej ścieżce"}${providerNote(p)}${p.captions ? " i dodaj warstwę napisów" : ""}`,
  transcribeFileSummary: (p) => `Transkrybuj ${p.file}${providerNote(p)} i zapisz transkrypcje TXT i SRT w ${p.outDir ?? "folderze „Pobrane”"}`,
  transcribeCreateSummary: (p) => `Utwórz wideo${p.name ? ` „${p.name}”` : ""}, importuj ${p.file} i dodaj na oś czasu, a potem transkrybuj${providerNote(p)}${p.captions ? " i dodaj warstwę napisów" : ""}`,

  translateVideoSummary: (p) => `Przetłumacz transkrypcję na ${p.to} przez model tekstowy${providerNote(p)}${p.captions ? ` i dodaj ${p.bilingual ? "dwujęzyczną " : ""}warstwę napisów` : ""}`,
  translateFileSummary: (p) => `Przetłumacz plik napisów ${p.input} na ${p.to} przez model tekstowy${providerNote(p)} i zapisz nowy plik w ${p.outDir ?? "folderze „Pobrane”"}`,

  dubSummary: (p) => `Tłumaczony dubbing${p.to ? ` (${p.to})` : ""}: ${p.translation ? `użyj tłumaczenia ${p.translation}` : "najpierw przetłumacz przez model tekstowy"}, syntezuj zdanie po zdaniu${providerNote(p)}${p.voice ? ` głosem ${p.voice}` : ""}, dodaj nową ścieżkę dubbingu i ${originalAction(p.original)} oryginalne audio`,

  transcodeSummary: (p) => `${transcodeAction(p.action, p.count)} (${p.files}${p.truncated ? "…" : ""}) i zapisz w ${p.outDir ?? "folderze „Pobrane”"}`,
  transcribeReplaceSummary: (p) =>
    `Ponownie transkrybuj ${p.asset ? `materiał ${p.asset}` : 'materiał z głównej ścieżki'}${providerNote(p)} i zastąp bieżącą transkrypcję wideo z przeniesieniem tłumaczeń, napisów i dubbingu (jedna operacja, którą można cofnąć)`,
};
