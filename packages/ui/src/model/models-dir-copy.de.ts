const and = (items: readonly string[]) => new Intl.ListFormat('de', { type: 'conjunction' }).format(items);
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const models = (n: number) => pluralForm('de', n, { one: `${n} Modell`, other: `${n} Modelle` });
import { pluralForm } from '@baocut/protocol';
import type { ModelsDirMessages } from './models-dir-copy.ts';

export const de: ModelsDirMessages = {

  dir: {
    title: "Modellordner",
    defaultChip: "Standard",
    envChip: "Umgebungsvariable",
    change: "Ändern…",
    restore: "Standard wiederherstellen",
    envNote: "Durch BAOCUT_MODELS_DIR festgelegt. Zum Ändern die Umgebungsvariable anpassen und BaoCut neu starten.",
    shareHint:
      "Bei Nutzung dieses Ordners durch andere Apps löscht das Entfernen eines Modells seine Dateien auch für diese Apps.",
    blockedPrefix: "Derzeit nicht änderbar:",
    viewTasks: "Aufgaben anzeigen",
    changeTitle: "Modellordner ändern",
    restoreTitle: "Standard-Speicherort wiederherstellen",
    restoreLead: "Modellordner zurücksetzen auf",
    checking: "Ordner wird geprüft…",
    cancel: "Abbrechen",
    howTo: "Umgang mit vorhandenen Modellen",
    moveOption: "Vorhandene Modelle dorthin verschieben",
    switchOption: "Nur den Speicherort wechseln",
    confirmMove: "Verschieben und ändern",
    confirmSwitch: "Speicherort ändern",
    movingLabel: "Modelle werden verschoben",
    stayOpen: "BaoCut währenddessen nicht beenden",
    missingDir:
      "Ordner nicht vorhanden (auch bei getrenntem externem Laufwerk). Nach Verbindung funktionieren Modelle wieder; alternativ anderen Speicherort wählen.",
    notWritableDir: "BaoCut hat keine Schreibberechtigung für diesen Ordner; Modelle können nicht darin heruntergeladen werden.",
    loading: "Modellordner wird gelesen…",
    pickFailed: (message: string) => `Ordner konnte nicht ausgewählt werden: ${message}`,
    same: "Dies ist bereits der aktuelle Modellordner",
  },

  stats: (used: string, free: string | null, count: number) =>
    [`${used} verwendet`, ...(free !== null ? [`${free} frei auf Festplatte`] : []), `${models(count)} gefunden`].join(" · "),

  blocker: (downloading: readonly string[], testing: readonly string[], tasks: number) => {
    const parts: string[] = [];
    if (downloading.length) parts.push(`Download von ${and(downloading)}`);
    if (testing.length) parts.push(`Prüfung von ${and(testing)}`);
    if (tasks) parts.push(`${tasks} ${pluralForm('de', tasks, { one: "Aufgabe verwendet", other: "Aufgaben verwenden" })} lokale Modelle`);
    return `${capitalize(parts.join("; "))}. Vor Änderung auf Abschluss warten, damit keine verwendeten Dateien verschoben werden.`;
  },
  missingTitle: "Dieser Ordner wurde nicht gefunden",
  missingText: "Ordner nicht vorhanden, möglicherweise externes Laufwerk getrennt. Verbinden und erneut auswählen.",
  notWritableTitle: "Dieser Ordner ist nicht beschreibbar",
  notWritableText:
    "BaoCut hat keine Schreibberechtigung; Modelle können nicht dort heruntergeladen werden. Beschreibbaren Ort wählen oder Berechtigungen ändern.",
  nestedTitle: "Hier nicht möglich",
  nestedText:
    "Neuer Speicherort und aktueller Modellordner enthalten einander. Ordner wählen, der weder darin liegt noch ihn enthält.",

  found: (count: number, bytes: string, free: string | null) =>
    `${
      count
        ? `Gefunden: ${count} heruntergeladene ${pluralForm('de', count, { one: "Modell", other: "Modelle" })} (${bytes}), einsatzbereit.`
        : "Noch keine Modelle im Ordner. Spätere Downloads gelangen hierher."
    }${free !== null ? ` ${free} frei auf Festplatte.` : ""}`,
  moveNoFit: (required: string, free: string, short: string) =>
    `Verschieben benötigt ${required}, Ziellaufwerk hat nur ${free} frei (${short} fehlen). Passt nicht.`,
  moveSameVolume: (size: string) => `Verschiebt ${size} auf demselben Laufwerk; daher schnell. Dateien bleiben danach nicht am alten Ort.`,
  moveOther: (size: string) => `Verschiebt ${size}. Dateien bleiben danach nicht am alten Ort.`,

  switchDescription: (count: number) =>
    `Dateien am alten Ort bleiben erhalten. Nur die ${count ? `${models(count)} ` : "Modelle "}am neuen Speicherort sind nutzbar; übrige erscheinen als nicht installiert.`,
  appliedMoving: (where: string) => `Modellverschiebung gestartet nach ${where}`,
  appliedKept: (where: string) => `Modellordner geändert nach ${where} · Dateien am alten Ort bleiben erhalten`,
  applied: (where: string) => `Modellordner geändert nach ${where}`,

  moveWaiting: (to: string | null) => `Wartet auf Verschiebungsstart${to ? ` zu ${to}` : ""}…`,
  moveValidating: (amount: string | null) => `Kopierte Dateien werden geprüft${amount ? ` (${amount})` : ""}…`,
  movePublishing: "Verschiebung wird abgeschlossen…",
  moving: (amount: string | null, to: string | null) => `Wird verschoben${amount ? ` ${amount}` : ""}${to ? ` zu ${to}` : ""}…`,
};
