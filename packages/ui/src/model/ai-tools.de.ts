const soonTail = 'Runtime hat diesen Workflow noch nicht; kein Video-Overlay zum Anpassen des Bildausschnitts. Daher noch kein Formular verfügbar.';
const scopeOf = (o: IntentArgs) => o.scope ? `${o.scope} von ${o.p}` : o.p;
type AiToolGroup = 'frame' | 'transcript' | 'translate' | 'writing' | 'publish';
type AiToolId =
  | 'crop'
  | 'shortscut'
  | 'polish'
  | 'chapters'
  | 'speakers'
  | 'retranscribe'
  | 'cleanup'
  | 'translate'
  | 'stale'
  | 'dub'
  | 'summary'
  | 'blog'
  | 'title'
  | 'desc'
  | 'cover';
type ToolText = {
  name: string;
  desc: string;
  setup?: readonly string[];
  why?: string;
};
import type { CleanupKey } from './ai-tools.ts';
import { intlLocale } from "@baocut/protocol";
import type { WriteLength } from './ai-tools.ts';
import type { WriteStyle } from './ai-tools.ts';
import type { WriteView } from './ai-tools.ts';
import type { CoverText } from './ai-tools.ts';
type IntentArgs = {
  p: string;
  scope: string | null;
  edited: number | boolean;
  cut: number | boolean;
  count: number | null;
};
import { pluralForm } from '@baocut/protocol';
import type { AiToolsMessages } from './ai-tools.ts';

export const de: AiToolsMessages = {
  groups: {
    frame: "Rahmen",
    transcript: "Transkript",
    translate: "Übersetzung",
    writing: "Wird geschrieben",
    publish: "Wird veröffentlicht",
  } as Record<AiToolGroup, string>,
  tools: {
    crop: {
      name: "Intelligent zuschneiden",
      desc: "Seitenverhältnis ändern; Sprecher, Whiteboards und wichtige Motive im Bild behalten",
      why: `Intelligentes Zuschneiden folgt Sprechern, Whiteboards und wichtigen Motiven im Video und schneidet anschließend auf das neue Seitenverhältnis zu. ${soonTail}`,
    },
    shortscut: {
      name: "In Kurzvideos schneiden",
      desc: "Abschnitte auswählen und jeweils in einen Hochkant-Kurzclip umwandeln",
      why: `Kurzclips erstellen bedeutet Abschnitte wählen, jeweils ins Hochformat schneiden und deren Bildausschnitt im Video anpassen. ${soonTail}`,
    },
    polish: {
      name: "Transkript verbessern",
      desc: "Tippfehler korrigieren, Zeichensetzung ergänzen und Absätze teilen, ohne Ihre Wörter umzuschreiben",
      setup: [
        "Offensichtliche Tippfehler korrigieren, fehlende Zeichensetzung ergänzen und nach Themen in Absätze teilen.",
        "Keine Umformulierung oder Entfernung; nur eindeutige Fehler werden korrigiert.",
      ],
    },
    chapters: {
      name: "Kapitel erzeugen",
      desc: "Teilt ein langes Video in betitelte Kapitel",
      setup: ["Absätze nach Themen in Kapitel gruppieren und jedem einen Titel geben.", "Export und Freigabeseite verwenden dieselben Kapitel."],
    },
    speakers: {
      name: "Sprecher erkennen",
      desc: "Sprecher zuordnen; Untertitel und Transkript mit Namen beschriften",
    },
    retranscribe: {
      name: "Neu transkribieren",
      desc: "Audio mit anderem Modell erneut verarbeiten; bei Bedarf nur ein Kapitel oder Segment",
      setup: [
        "Mit anderem Sprachmodell verarbeiten und wortweise Daten im Bereich ersetzen.",
        "Transkript, Untertitel und Übersetzungen außerhalb bleiben vollständig unverändert.",
      ],
    },
    cleanup: {
      name: "Schnitte finden",
      desc: "Füllwörter, lange Pausen und misslungene Aufnahmen finden; vor Schneiden prüfen",
      setup: [
        "Füllwörter, Pausen ab 0,8 s und wiederholte Satzanfänge suchen.",
        "Schnittvorschläge werden vor jeglichem Schnitt zur Bestätigung vorgelegt.",
      ],
    },
    translate: {
      name: "Untertitel übersetzen",
      desc: "Satzweise übersetzen und Zeitcodes mit Wortdaten ausrichten",
    },
    stale: {
      name: "Veraltete Übersetzungen erneuern",
      desc: "Nur Sätze mit bearbeiteter oder geschnittener Quelle erneut übersetzen",
      setup: [
        "Nur Sätze mit geänderter Quelle erneut übersetzen: bearbeitete Sätze und durch Schnitt teilweise entfernte.",
        "Geschnittene Quelle übersetzen; vollständig geschnittene Sätze verlieren auch ihre Übersetzung. Alles andere unverändert.",
      ],
    },
    dub: {
      name: "Übersetzte Vertonung",
      desc: "Sprache wählen und mit Original- oder muttersprachlicher Stimme vertonen; Standardwerte reichen zum Start",
    },
    summary: {
      name: "Zusammenfassung schreiben",
      desc: "Text und zeitmarkierte Kernpunkte; Zeit anklicken zum Springen",
    },
    blog: {
      name: "Blogbeitrag schreiben",
      desc: "Als Artikel aus Autoren- oder Zuschauerperspektive umschreiben",
    },
    title: {
      name: "Titel vorschlagen",
      desc: "Mehrere Kandidaten aus unterschiedlichen Blickwinkeln erhalten und einen wählen",
    },
    desc: {
      name: "Beschreibung schreiben",
      desc: "Veröffentlichungsbeschreibung mit Kapitelzeitcodes und Tags",
    },
    cover: {
      name: "Cover erstellen",
      desc: "Titelbildkandidaten aus wichtigen Frames erstellen und einen auswählen",
    },
  } as Record<AiToolId, ToolText>,
  unknownTool: (id: string) => `Kein solches KI-Werkzeug: ${id}`,
  cleanup: {
    fillers: {
      label: "Füllwörter",
      sub: "Wörter wie „um“, „uh“, „like“ und „you know“",
      off: "Füllwörter",
    },
    pauses: {
      label: "Lange Pausen ≥ 0,8 s",
      sub: "Mit wortweisem Timing gefunden",
      off: "lange Pausen",
    },
    repeats: {
      label: "Wiederholte Satzanfänge",
      sub: "Satz zweimal begonnen; späteren behalten",
      off: "wiederholte Satzanfänge",
    },
  } as Record<CleanupKey, { label: string; sub: string; off: string }>,

  cleanupOff: (offs: readonly string[]) => `Nicht suchen nach ${new Intl.ListFormat(intlLocale(), { type: 'conjunction' }).format(offs)}`,
  lengths: { short: "Kurz", medium: "Mittel", long: "Lang" } as Record<WriteLength, string>,
  styles: {
    plain: "Nur Text",
    pop: "Erklärend",
    sharp: "Bissig",
    light: "Locker",
    pro: "Fachlich",
    custom: "Maßgeschneidert…",
  } as Record<WriteStyle, string>,
  views: {
    auto: "Automatisch",
    author: "Ich bin der Autor",
    viewer: "Ich bin Zuschauer",
  } as Record<WriteView, string>,
  coverText: {
    none: "Kein Text",
    phrase: "Eine kurze Phrase",
    'phrase-sub': "Ein Ausdruck und eine Zeile kleiner Text",
  } as Record<CoverText, string>,
  viewName: { author: "Autor", viewer: "Zuschauer" } as Record<'author' | 'viewer', string>,
  extraScope: (scope: string) => `Nur konzentrieren auf ${scope}`,
  extraLength: (label: string) => `Länge: ${label}`,
  extraStyle: (style: string) => `Stil: ${style}`,
  extraLanguage: (language: string) => `Schreiben in ${language}`,
  extraView: (view: string) => `Perspektive: ${view}`,
  extraPlatform: (platform: string) => `Veröffentlichung auf: ${platform}. Regeln befolgen und mich nach Abschluss an eine Prüfung erinnern`,
  extraFrames: 'Wo ein Bild nötig ist, Schlüsselbilder aus dem Video nehmen und in den Artikel einfügen, jeweils mit einer Bildunterschrift',
  extraIdea: (idea: string) => `Kernaussage des Titelbilds: ${idea}`,
  extraRatio: (ratio: string) => `Seitenverhältnis ${ratio}`,
  extraCoverText: (label: string) => `Titelbildtext: ${label}`,

  titled: (title: string) => `„${title}“`,
  thisVideo: "dieses Video",

  sourceEdited: (n: number | null) => (n === null ? "Quelle bearbeitet" : pluralForm('de', n, { one: "1 Satz in Quelle bearbeitet", other: `${n} Sätze in Quelle bearbeitet` })),
  sourceCut: (n: number | null) => (n === null ? "Quelle geschnitten" : pluralForm('de', n, { one: "1 Satz in Quelle geschnitten", other: `${n} Sätze in Quelle geschnitten` })),
  sourceJoin: (parts: readonly string[]) => parts.join(", "),
  intents: {
    stale: (o: IntentArgs & { why: string }) =>
      `Einige Übersetzungen in ${o.p} sind veraltet${o.why ? ` (${o.why})` : " wegen bearbeiteter Quelle"}. Nur diese Sätze erneut übersetzen${o.cut ? "; geschnittene Sätze aus geschnittener Quelle erneut übersetzen und Übersetzungen vollständig geschnittener Sätze mit entfernen" : ""}. Alles andere vollständig unverändert lassen.`,
    polish: (o: IntentArgs) =>
      `Transkript überarbeiten: ${scopeOf(o)}: Tippfehler korrigieren, Zeichensetzung ergänzen und nach Themen in Absätze teilen, ohne meine Formulierungen umzuschreiben.`,
    chapters: (o: IntentArgs) => `Aufteilen: ${o.p} nach Themen in Kapitel mit kurzen Titeln.`,
    speakers: (o: IntentArgs) => `Sprecher erkennen in ${scopeOf(o)}. Ergebnisse vor Schreiben ins Video zur Bestätigung zeigen.`,
    retranscribe: (o: IntentArgs) => `Erneut transkribieren: ${scopeOf(o)} mit anderem Sprachmodell; außerhalb dieses Bereichs alles vollständig unverändert lassen.`,
    cleanup: (o: IntentArgs) =>
      `Füllwörter, lange Pausen und wiederholte Satzanfänge finden in ${scopeOf(o)}. Zuerst auflisten; vor jeglichem Schnitt bestätige ich.`,
    summary: (o: IntentArgs) => `Zusammenfassung von Kernpunkten mit Zeitcodes aus dem Transkript schreiben: ${o.p}.`,
    blog: (o: IntentArgs) => `Umschreiben: ${o.p} als veröffentlichungsreifen Blogbeitrag.`,
    title: (o: IntentArgs & { count: number }) =>
      `Vorschlagen: ${o.count} Titelkandidaten für ${o.p}, jeweils anderer Blickwinkel mit einzeiliger Begründung; einen empfehlen.`,
    desc: (o: IntentArgs) => `Veröffentlichungsbeschreibung schreiben für ${o.p} mit Kapitelzeitcodes und einer Tag-Zeile.`,
    cover: (o: IntentArgs & { count: number }) =>
      `Erstellen: ${o.count} Titelbildkandidaten für ${o.p}: zuerst wichtige Frames auswählen, je Kandidat andere Grundbildstrategie; vor Präsentation klein prüfen.`,
  },

  endSentence: (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`),
  joinPrompt: (head: string, extra: readonly string[]) => [head, ...extra].join(" "),
  groupSub: { writing: 'Für Lesende: wissen, worum es im Video geht, ohne es anzusehen', publish: 'Für alle, die das Video veröffentlichen: Lust aufs Anklicken machen und das Versprechen halten' },
  laterNote: 'Untertitel übersetzen ist noch im Untertitel-Bereich und Synchronisation übersetzen im Audio-Bereich; beide ziehen später hierher um.',
  effect: {
    polish: 'Ändert das Transkript: wird am Ende angewendet, in einem Schritt rückgängig zu machen',
    chapters: 'Ändert die Kapitel: wird am Ende angewendet, in einem Schritt rückgängig zu machen',
    speakers: 'Du bestätigst das Ergebnis zuerst; ins Video geschrieben wird es erst beim Anwenden',
    retranscribe: 'Ersetzt das Transkript in diesem Bereich: wird am Ende angewendet, in einem Schritt rückgängig zu machen',
    cleanup: 'Schlägt nur Schnitte vor; geschnitten wird erst nach deiner Bestätigung',
    stale: 'Übersetzt nur die veralteten Sätze neu; alles andere bleibt',
    summary: 'Ändert das Video nicht: Das Ergebnis ist zum Lesen und Kopieren',
    blog: 'Ändert das Video nicht: Das Ergebnis ist zum Lesen und Kopieren',
    title: 'Ändert das Video nicht: Wähle einen aus',
    desc: 'Ändert das Video nicht: Das Ergebnis ist zum Lesen und Kopieren',
    cover: 'Ändert das Video nicht: Wähle eines aus',
  },
  standMarkdown: (language) => (language ? `Schreib in Markdown, auf ${language}.` : 'Schreib in Markdown, in derselben Sprache wie das Transkript.'),
  standLanguage: (language) => (language ? `Schreib auf ${language}.` : 'Schreib in derselben Sprache wie das Transkript.'),
  standing: {
    summary: ['Beginne mit dem Fazit, dann die Kernpunkte, jeder mit Zeitmarke (mm:ss).', 'Mittlere Länge: drei bis fünf Absätze.'],
    blog: ['Wähle die Perspektive nach der Herkunft des Videos: als Autor, wenn es mein Video ist, als Zuschauer, wenn es von jemand anderem ist.', 'Schlichter Stil, kein Werbeton.'],
    title: ['Jeder Vorschlag in eine eigene Zeile.'],
    desc: ['Mit Kapitel-Zeitmarken und einer Zeile Tags.'],
    cover: ['Der Text auf dem Cover ist in der Sprache des Transkripts.'],
    polish: ['Formuliere nichts um und streiche nichts; korrigiere nur eindeutige Fehler.'],
    chapters: ['Nach Themen gruppieren, mit einem kurzen Titel pro Kapitel.'],
  },
  sessionNew: 'Neue Sitzung',
  sessionNewSub: 'Nimmt dieses Video als Kontext; eine Aufgabe pro Sitzung, ohne einen langen Verlauf neu zu senden',
  sessionCurrent: (title) => `„${title}“ fortsetzen`,
  sessionUntitled: 'die Sitzung dieses Videos',
  sessionCurrentSub: (messages) =>
    messages === null
      ? 'Sendet den Verlauf der Sitzung erneut; nach Ablauf des Prompt-Caches kostet das mehr'
      : `Bisher ${messages === 1 ? '1 Nachricht' : `${messages} Nachrichten`} · sendet den Verlauf erneut; nach Ablauf des Prompt-Caches kostet das mehr`,
  hintNew: 'Startet eine neue Sitzung mit diesem Video als Kontext. Verfolge sie dort; jede Änderung des Agenten am Video lässt sich rückgängig machen.',
  hintCurrent: 'Sendet an die aktuelle Sitzung dieses Videos, mit dem Video als Kontext. Verfolge sie dort; jede Änderung des Agenten am Video lässt sich rückgängig machen.',
};
