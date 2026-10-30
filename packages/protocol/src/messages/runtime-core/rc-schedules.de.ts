import type { RcSchedulesMessages } from './rc-schedules.ts';

export const de: RcSchedulesMessages = {
  notFound: (p) => `Geplante Aufgabe nicht gefunden: ${p.id}`,
  conversationNotFound: (p) => `Sitzung nicht gefunden: ${p.id}`,
  conversationArchived: 'Diese Sitzung ist archiviert. Stelle sie unter „Archivierte Sitzungen“ wieder her, bevor du sie planst.',
  noProject: 'Diese Sitzung gehört zu keinem Projekt und kann daher nicht jedes Mal eine neue Sitzung in einem Projekt öffnen.',
  invalid: 'Prüfe die geplante Aufgabe: Nachricht, Häufigkeit und Ausführungslimit müssen gültig sein.',
  notActive: 'Nur eine aktive geplante Aufgabe kann jetzt ausgeführt werden.',
  resumeArchived:
    'Die Zielsitzung ist archiviert. Stelle sie unter „Archivierte Sitzungen“ wieder her oder bearbeite die geplante Aufgabe, damit sie jedes Mal eine neue Sitzung öffnet.',
  resumeDeleted: 'Die Zielsitzung wurde gelöscht. Bearbeite die geplante Aufgabe, damit sie jedes Mal eine neue Sitzung öffnet.',
  resumeProjectRemoved: 'Das Projekt wurde aus BaoCut entfernt, daher kann darin keine neue Sitzung geöffnet werden.',
  resumeCompleted: 'Die maximale Anzahl an Ausführungen ist erreicht. Erhöhe zuerst das Limit.',
  runStopped: 'Vor dem Ende gestoppt',
};
