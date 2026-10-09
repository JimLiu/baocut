import { pluralForm } from '@baocut/protocol';
import type { ThreadMessages } from './thread-copy.ts';

export const pl: ThreadMessages = {
  withDetail: (text, detail) => `${text} (${detail})`,
  copy: "Kopiuj",
  copied: "Skopiowano",
  copyFailed: "Nie udało się skopiować. Spróbuj ponownie",
  copyCode: "Kopiuj kod",
  copyReply: "Kopiuj tę odpowiedź",
  change: {
    added: (n) => `Dodano: ${n}`,
    updated: (n) => `Zmieniono: ${n}`,
    deleted: (n) => `Usunięto: ${n}`,
    duration: (clock) => `Czas trwania ${clock}`,
    durationChange: (before, after) => `Czas trwania ${before} → ${after}`,
    revision: (before, after) => `Wersja ${before} → ${after}`,
    locked: "Nie można teraz zmienić wideo",
    undoStep: (videoName, label) => `Cofnięto krok w wideo „${videoName}”: ${label}`,
    changed: (videoName, label) => `Zmieniono wideo „${videoName}”: ${label}`,
    aria: (label) => `Zmiana wideo: ${label}`,
  },
  message: {
    contextTitle: "Stan edytora wysłany z wiadomością",
    context: (videoName, revision, playhead, selected) => `„${videoName}” · wersja ${revision} · głowica odtwarzania ${playhead}${selected ? ` · ${pluralForm('pl', selected, { one: `Wybrano ${selected} klip`, few: `Wybrano ${selected} klipy`, many: `Wybrano ${selected} klipów`, other: `Wybrano ${selected} klipu` })}` : ''}`,
  },
  output: {
    aria: (name, detail) => `${name}, ${detail}`,
  },
  steps: {
    more: (n) => `w toku: ${n}`,
    failed: (n) => `${n} z niepowodzeniem`,
    thinking: "Rozumowanie",
    viewFile: (name) => `Zobacz ${name}`,
    input: "Dane wejściowe",
    error: "Błąd",
    output: "Wynik",
    waiting: "Oczekiwanie na wynik",
    noOutput: "Brak wyniku",
  },
};
