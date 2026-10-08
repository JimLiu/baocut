import { pluralForm } from '@baocut/protocol';
import type { DubGroupMessages } from './dub-group-copy.ts';

export const pl: DubGroupMessages = {
  track: "Pokaż tę ścieżkę na osi czasu",
  trackGone: "Ta grupa dubbingu nie jest już na osi czasu",
  regen: (n: number) => pluralForm('pl', n, { one: `Wygeneruj ponownie ${n} zdanie…`, few: `Wygeneruj ponownie ${n} zdania…`, many: `Wygeneruj ponownie ${n} zdań…`, other: `Wygeneruj ponownie ${n} zdania…` }),
  regenNote: "Zdania niezsyntetyzowane lub niedopasowane · przejrzyj je, w razie potrzeby edytuj tłumaczenie, a potem ponów tylko te",
  download: "Pobierz grupę",
  downloadNote: "Nie można jeszcze pobierać całych grup; aby uzyskać miks tej grupy, wybierz „Tylko ta grupa dubbingu” podczas eksportu audio",
  redub: "Powtórz ten język",
  redubNote: "Otwiera tłumaczony dubbing",
  remove: "Usuń tę grupę dubbingu",
  removeNote: "Usuwa klipy tej grupy z osi czasu i przywraca oryginalne audio; można cofnąć. Pusta ścieżka dubbingu i plan zostają zachowane",
  removeLoading: "Wczytywanie planu dubbingu…",
  readOnly: "Wideo jest tylko do odczytu",
  removed: (title: string) => `Usunięto „${title}”`,
  rowOnTimeline: (label: string) => `Wiersz „${label}” na osi czasu`,
  undo: "Cofnij",
  stateOn: "Na osi czasu",
  stateOff: "Ścieżka wyłączona",
  stateGone: "Poza osią czasu",
  groupMenu: "Ta grupa dubbingu",
  actionsOf: (title: string) => `Działania dla „${title}”`,
  clickToSelect: (text: string) => `${text} · kliknij, aby wybrać na osi czasu`,
};
