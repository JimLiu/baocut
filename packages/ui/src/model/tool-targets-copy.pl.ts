import type { ToolTargetsMessages } from './tool-targets-copy.ts';

export const pl: ToolTargetsMessages = {
  unknownLanguage: "Nieznany język",
  langCount: (label, count) => `${label} ×${count}`,
  joinLangs: (labels) => labels.join(", "),
  tagTranscript: (langs) => `Transkrypcja · ${langs}`,
  tagTranslation: (langs) => `Tłumaczenie · ${langs}`,
  tagDub: (langs) => `Dubbing · ${langs}`,
  tagPending: "Trwa odczyt treści; transkrypcja zostanie wybrana przy rozpoczęciu",
  blockTranscribing: 'Trwa transkrypcja; po ukończeniu możesz transkrybować ponownie',
  blockQueued: 'Już w kolejce do transkrypcji',
  blockTranscribingWait: 'Trwa transkrypcja; możesz wybrać po ukończeniu',
  blockQueuedWait: 'W kolejce do transkrypcji; możesz wybrać po jej ukończeniu',
  blockFailed: 'Ostatnia transkrypcja nie powiodła się; najpierw transkrybuj ponownie',
  blockNoTranscript: 'Nie ma jeszcze transkrypcji; najpierw transkrybuj',
  duplicateTranscript: (langs) =>
    `To wideo ma już transkrypcję (${langs}). Domyślnie powstaje nowe wideo, a to wideo i jego tłumaczenia się nie zmieniają. „Zastąp transkrypcję tego wideo” podmienia bieżącą transkrypcję: tłumaczenia są przenoszone przez dopasowanie oryginału, zdania ze zmienionym oryginałem są oznaczane jako nieaktualne, a całość to jedna zmiana, którą można cofnąć.`,
  duplicateTranslation: (lang) =>
    `To wideo ma już ${lang} – tłumaczenie. Zostanie dodane kolejne, a istniejące zostanie zachowane; wybierz używane w edytorze.`,
  duplicateDub: (lang) => `To wideo ma już ${lang} – dubbing. Zostanie dodany kolejny zestaw, a istniejący zostanie zachowany.`,
  duplicateTitle: {
    transcribe: 'To wideo ma już transkrypcję',
    'translate-subtitles': "Istniejące tłumaczenia zostają zachowane",
    dub: "Istniejący dubbing zostaje zachowany",
  },
  translationOption: (lang, nth) => `${lang} – tłumaczenie${nth === null ? "" : ` #${nth}`}`,
  translatedFrom: (lang) => `Z transkrypcji: ${lang}`,
  destNewVideo: 'Nowe wideo',
  destNewVideoNote: 'Nowe wideo w tym samym projekcie, połączone z tym samym materiałem; to wideo i jego tłumaczenia się nie zmieniają',
  destReplace: 'Zastąp transkrypcję tego wideo',
  destReplaceNote: 'Podmienia bieżącą transkrypcję; tłumaczenia, napisy i dubbing są przenoszone w tej samej zmianie, którą można cofnąć',
  newVideoName: (name) => `${name} · Ponowna transkrypcja`,
  impactTranslation: (lang, units) => `${lang} · zdań: ${units}`,
  impactDub: (lang, groups) =>
    `${lang} · zestawów: ${groups} · dubbing zdań z niezmienionym tłumaczeniem zostaje i jest oznaczany jako możliwie niezsynchronizowany`,
  impactRule:
    'Zdania z niezmienionym oryginałem zachowują tłumaczenie i status sprawdzenia, wyrównanie na poziomie zdań; zmienione lub niedopasowane są oznaczane jako nieaktualne, do ponownego przetłumaczenia przez „Odśwież nieaktualne tłumaczenia”. Dokładne liczby są w wyniku.',
  impactUndo: 'Jedna zmiana, którą można cofnąć',
};
