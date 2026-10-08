import { pluralForm } from '@baocut/protocol';
import type { ToolRunsMessages } from './tool-runs-copy.ts';

export const de: ToolRunsMessages = {
  diarizeStep: "Sprecher erkennen",

  phaseDone: "Fertig",
  phaseQueued: "In Warteschlange",
  phaseCancelled: "Abgebrochen",
  phaseUnfinished: "Nicht abgeschlossen",
  phasePreparing: "Wird vorbereitet",
  stepAt: (cur: number, total: number) => `Schritt ${cur} von ${total}`,
  cancelledAt: (step: string, at: string) => `Abgebrochen bei „${step}“ · ${at}`,
  stoppedAt: (step: string, at: string) => `Gestoppt bei „${step}“ · ${at}`,
  runningAt: (step: string, at: string) => `${step} · ${at}`,
  stepDone: "Fertig",
  stepStopped: "Hier gestoppt",
  stepRunning: "In Arbeit",
  stepWaiting: "Wartet",

  costEstimate: (amount: number | string, currency: string) => `Etwa ${amount} ${currency}`,
  costSubscription: (recipient: string) => `In Ihrem Abonnement enthalten: ${recipient}`,
  costFree: "Kostenlos",
  costMetered: (recipient: string) => `Abgerechnet zu den Tarifen von ${recipient}; hier ist keine Schätzung verfügbar`,
  grantWhat: (kinds: readonly string[], purpose: string) => `${kinds.join(", ")} (${purpose})`,
  grantLoop: "Diese Genehmigungen wurden bereits erteilt, aber die Runtime lehnt weiterhin ab. Diese Berechtigungen unter Einstellungen › Datenschutz und Berechtigungen prüfen oder zu einem anderen Modell wechseln.",

  noStructuredOutput: "Dieses Modell unterstützt keine strukturierte Ausgabe und kann daher nicht übersetzen",

  captionsCreated: (p: { language: string | null; bilingual: boolean; disabled: boolean }) =>
    `Erstellt: ${p.language ? `eine ${p.language} Untertitel-Ebene` : "eine bearbeitbare Untertitel-Ebene"}${p.bilingual ? ", zweisprachig angezeigt" : ""}${
      p.disabled ? " (dieses Material zeigt bereits Untertitel; die neue Ebene ist daher zunächst ausgeschaltet)" : ""
    }`,
  captionsExistingTranslation: "Diese Übersetzung hat bereits eine Untertitel-Ebene. Es wurde keine neue erstellt",
  captionsExistingTranscript: "Dieses Transkript hat bereits eine Untertitel-Ebene. Es wurde keine neue erstellt",
  captionsNotOnTimeline: "Kein Clip in der Zeitleiste verwendet dieses Material. Es wurde keine Untertitel-Ebene erstellt",
  captionsEmpty: "Es gibt keine Untertitel zum Anzeigen. Es wurde keine Untertitel-Ebene erstellt",
  originalAudio: { duck: "Originalton abgesenkt", mute: "Originalton stummgeschaltet", keep: "Originalton beibehalten" },

  thisVideo: "dieses Video",
  newVideo: "Neues Video",
  fallbackVideo: "Video",
  media: "Material",
  savedFiles: (names: readonly string[]) => `Transkript und Untertitel gespeichert: ${names.join(", ")}`,
  transcriptLanguage: (language: string, model: string | null) => `Transkriptsprache: ${language}${model ? ` (${model})` : ""}`,
  createdVideoLinked: (video: string, project: string | null) =>
    `Video erstellt: „${video}“${project ? ` in „${project}“` : ""}; das Material bleibt an seinem Ort und wird nur verknüpft`,
  wroteTranscript: (video: string) => `Transkript zu „${video}“ hinzugefügt`,
  speakersFound: (n: number) => `Gefunden: ${n} ${pluralForm('de', n, { one: "Sprecher", other: "Sprecher" })}; Untertitel und Transkript sind mit Namen beschriftet`,
  wroteTranslation: (video: string, language: string, source: string | null) => `Übersetzung in ${language} zu „${video}“ hinzugefügt${source ? ` (aus dem Transkript in ${source})` : ""}; das Original bleibt unverändert`,
  unitCount: (n: number) => `${n} ${pluralForm('de', n, { one: "Satz", other: "Sätze" })}`,
  subtitleFileWritten: (file: string, dir: string) => `Übersetzte Untertiteldatei ${file} gespeichert in ${dir}; Cue-Anzahl und Zeitcodes unverändert`,
  bilingualLayout: "Zweisprachig: Original oben, Übersetzung unten",
  markupStripped: (n: number) => pluralForm('de', n, { one: `Inline-Markierungen aus ${n} ursprünglichem Cue entfernt`, other: `Inline-Markierungen aus ${n} ursprünglichen Cues entfernt` }),
  dubTranslated: (language: string) => `Übersetzt nach ${language}: zuerst eine neue Übersetzung hinzugefügt`,
  dubReusedTranslation: (language: string) => `Vorhandene Übersetzung in ${language} verwendet`,
  dubWritten: (video: string, language: string, engine: string) => `Neue Vertonung in ${language} zu „${video}“ hinzugefügt${engine ? ` (${engine})` : ""}; frühere Vertonungen bleiben erhalten`,
  dubPlaced: (placed: number, total: number) => `${placed} von ${total} Sätzen in der Zeitleiste platziert`,
  linkCreatedVideo: (video: string, project: string | null) =>
    `Video erstellt: „${video}“${project ? ` in „${project}“` : ""}; das heruntergeladene Material liegt in der Zeitleiste`,
  linkAddedTo: (file: string, video: string) => `Hinzugefügt: ${file} zu „${video}“; die Datei bleibt in Ihrem Downloadordner`,
  linkDownloaded: (file: string, dir: string | null) => `Heruntergeladen: ${file}${dir ? ` nach ${dir}` : ""}`,
  linkTranscribedFiles: "Transkription abgeschlossen; TXT-Transkript und SRT-Untertitel gespeichert",
  linkTranscribed: "Transkription abgeschlossen; Transkript hinzugefügt. Dieser Weg erstellt keine Untertitel-Ebene; sie kann im Untertitel-Bereich des Editors erzeugt werden",
  replacedTranscript: (video: string) => `Transkript von „${video}“ ersetzt: eine Änderung, die sich rückgängig machen lässt`,
  newVideoFrom: (video: string, project: string | null, original: string | null) =>
    `Video „${video}“${project ? ` in „${project}“` : ''} erstellt, verknüpft mit demselben Material; ${original ? `„${original}“` : 'das ursprüngliche Video'} und seine Übersetzungen bleiben unverändert`,
  carryTranslation: (language: string, kept: number, reviewed: number, stale: number) =>
    `Übersetzung in ${language} · behalten: ${kept} (geprüft: ${reviewed}) · veraltet: ${stale}`,
  carryPins: (reanchored: number, orphaned: number) => `Untertitel-Pins · neu verankert: ${reanchored} · orphaned: ${orphaned}`,
  carryDub: (language: string, kept: number, stale: number) => `Vertonung in ${language} · behalten: ${kept} · veraltet: ${stale}`,
  nothingToCarry: 'Dieses Video hatte keine Übersetzungen, Untertitel-Pins oder Vertonungen zum Übernehmen',
  refreshHint: 'Veraltete Sätze mit „Veraltete Übersetzungen erneuern“ neu übersetzen',
};
