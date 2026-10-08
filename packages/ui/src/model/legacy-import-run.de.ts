import { pluralForm } from '@baocut/protocol';
import type { LegacyImportRunMessages } from './legacy-import-run.ts';

export const de: LegacyImportRunMessages = {
  offlineTitle: (name) => `Laufwerk „${name}“ ist nicht verbunden`,
  offlineWhy: (n, root) =>
    pluralForm('de', n, {
      one: `Die Videos dieses Projekts liegen auf diesem Laufwerk (${root}), das gerade nicht gelesen werden kann.`,
      other: `Die Videos dieser ${n} Projekte liegen auf diesem Laufwerk (${root}), das gerade nicht gelesen werden kann.`,
    }),
  offlineFix:
    'Verbinden Sie das Laufwerk und klicken Sie dann auf „Erneut versuchen“. Wenn Sie nichts tun, versucht BaoCut es beim nächsten Start erneut. Wenn Sie das Material nicht mehr brauchen, klicken Sie auf „Überspringen“; dann wird nichts importiert.',
  offlineShort: (n, name) =>
    pluralForm('de', n, {
      one: `${n} Projekt hat sein Material auf „${name}“, das nicht verbunden ist`,
      other: `${n} Projekte haben ihr Material auf „${name}“, das nicht verbunden ist`,
    }),
  missingTitle: 'Mediendateien sind nicht mehr am alten Ort',
  missingWhy:
    'Vom Projekt verwendete Dateien wurden verschoben, umbenannt oder gelöscht, daher finden die im früheren Projekt gespeicherten Pfade sie nicht mehr.',
  missingFix:
    'Legen Sie die Dateien wieder an ihren alten Ort und klicken Sie dann auf „Erneut versuchen“. Wenn das nicht möglich ist, klicken Sie auf „Überspringen“.',
  missingShort: (n) =>
    pluralForm('de', n, {
      one: `${n} Projekt hat Mediendateien, die nicht gefunden werden`,
      other: `${n} Projekte haben Mediendateien, die nicht gefunden werden`,
    }),
  unreadableTitle: 'Die frühere Projektdatei kann nicht gelesen werden',
  unreadableWhy: 'Die frühere Projektdatei ist möglicherweise beschädigt; ein erneuter Versuch hilft daher wahrscheinlich nicht.',
  unreadableFix:
    'Zeigen Sie sie im Ordner an und prüfen Sie, ob das Original noch da ist und sich in der früheren Version öffnen lässt. Wenn Sie sie nicht brauchen, klicken Sie auf „Überspringen“.',
  unreadableShort: (n) =>
    pluralForm('de', n, {
      one: `${n} Projektdatei kann nicht gelesen werden`,
      other: `${n} Projektdateien können nicht gelesen werden`,
    }),
  failedTitle: 'Import auf halbem Weg abgebrochen',
  failedWhy: 'Das Projekt wurde gelesen, aber der Import brach auf halbem Weg ab. Was passiert ist, steht im Importbericht.',
  failedFix:
    'Klicken Sie auf „Erneut versuchen“. Wenn es weiterhin fehlschlägt, zeigen Sie den Bericht im Ordner an. Wenn Sie das Projekt nicht brauchen, klicken Sie auf „Überspringen“.',
  failedShort: (n) =>
    pluralForm('de', n, {
      one: `${n} Projekt wurde mitten im Import abgebrochen`,
      other: `${n} Projekte wurden mitten im Import abgebrochen`,
    }),
  missingMany: (n, first) => `${n} Dateien fehlen, zum Beispiel ${first}`,
  missingOne: (file) => `${file} fehlt`,
  missingNone: 'Mediendateien nicht gefunden',
  failedReport: (report) => `Importbericht: ${report}`,
  failedNoReport: 'Es wurde kein Importbericht geschrieben',
  note: (parts) => `${parts.join('; ')}.`,
  hintOffline: (name) =>
    `Verbinden Sie „${name}“ und klicken Sie dann auf „Alle erneut versuchen“. Wenn Sie nichts tun, versucht BaoCut es beim nächsten Start erneut. Einzeln bearbeiten können Sie sie in den Details.`,
  hintOther: 'Grund und Lösung für jedes Projekt stehen in den Details. Nicht benötigte können Sie überspringen.',
  subProgress: (done, total) => `Importiert ${done}/${total}`,
  subImported: (n) => `Importiert ${n}`,
  subPending: (n) => `Offen ${n}`,
  subSkipped: (n) => `Übersprungen ${n}`,
  subDest: (dest) => `Nach ${dest}`,
  attention: (n) => `${n} offen`,
  phaseImporting: 'Wird importiert',
  phaseWaiting: 'Wartet auf andere Aufgaben',
  detailImporting: (title) => `„${title}“ wird importiert`,
  detailWaiting: 'Andere Aufgaben laufen, daher ist der Import pausiert. Er wird automatisch fortgesetzt, sobald sie fertig sind.',
  bannerRunning: (done, total) => `Frühere Projekte werden importiert · ${done}/${total}`,
  bannerResult: (imported, pending) => `Import früherer Projekte abgeschlossen: ${imported} importiert, ${pending} nicht importiert`,
  doneAll: (n) => pluralForm('de', n, { one: `${n} früheres Projekt importiert`, other: `${n} frühere Projekte importiert` }),
  doneSome: (imported, pending) => `Import abgeschlossen: ${imported} importiert, ${pending} nicht importiert`,
  retriedAll: (n) =>
    pluralForm('de', n, {
      one: 'Das erneut versuchte Projekt wurde importiert',
      other: `Alle ${n} erneut versuchten Projekte wurden importiert`,
    }),
  retriedSome: (n, ok) => `Von ${n} erneut versuchten: ${ok} importiert, ${n - ok} weiterhin nicht importiert`,
  retriedNone: (n) =>
    pluralForm('de', n, {
      one: 'Das erneut versuchte Projekt wurde weiterhin nicht importiert',
      other: `Die ${n} erneut versuchten Projekte wurden weiterhin nicht importiert`,
    }),
  retrying: (n) => pluralForm('de', n, { one: `${n} Projekt wird erneut importiert`, other: `${n} Projekte werden erneut importiert` }),
  skipped: (n) =>
    pluralForm('de', n, {
      one: `${n} Projekt übersprungen. Es wird nicht automatisch importiert.`,
      other: `${n} Projekte übersprungen. Sie werden nicht automatisch importiert.`,
    }),
  actionFailed: (message) => `Aktion fehlgeschlagen: ${message}`,
  undo: 'Rückgängig machen',
  viewReasons: 'Gründe anzeigen',
  viewInSpace: 'In Space anzeigen',
  viewProgress: 'Fortschritt anzeigen',
  close: 'Schließen',
  retryAll: 'Alle erneut versuchen',
  skipAll: 'Alle überspringen',
  retry: 'Erneut versuchen',
  skip: 'Überspringen',
  reveal: 'Im Ordner anzeigen',
  importInstead: 'Importieren',
  statImported: 'Importiert',
  statPending: 'Nicht importiert',
  statSkipped: 'Übersprungen',
  statLive: 'Noch nicht importiert',
  pendingSection: 'Nicht importierte Projekte',
  pendingHint: 'Wenn Sie nichts tun, versucht BaoCut es beim nächsten Start erneut. Übersprungene werden nicht importiert.',
  howTo: 'Was tun: ',
  groupTitle: (title, n) => `${title} · ${n}`,
  liveSection: 'Wird importiert',
  importingChip: 'Wird importiert',
  queuedChip: 'In Warteschlange',
  importedSection: 'Importiert',
  skippedSection: 'Übersprungen',
  skippedHint: 'Sie werden nicht automatisch importiert. Die Originaldateien bleiben an ihrem Ort.',
  expand: (n) => `${n} weitere anzeigen`,
  collapse: 'Weniger anzeigen',
};
