import type { VideoVersionsMessages } from './video-versions-copy.ts';

export const de: VideoVersionsMessages = {
  title: 'Verlauf',
  close: 'Verlauf schließen',
  tipRevision: (revision: string) => `Revision ${revision}`,
  viewChanges: 'Änderungen',
  tipLatest: (version: number) => `Neueste Version: ${version}`,
  tipNone: 'Noch keine Versionen',
  tipOutside: 'Dieses Video ist in keinem Projekt',
  loading: 'Versionsverlauf wird geladen',
  loadFailed: (message: string) => `Versionsverlauf konnte nicht geladen werden: ${message}`,
  stateSynced: 'Snapshot aktuell',
  stateSyncedDesc: 'Der Arbeitsbereich-Snapshot im Videoordner entspricht dem aktuellen Inhalt.',
  statePending: 'Snapshot wird geschrieben',
  statePendingDesc: 'Die letzten Änderungen gelangen innerhalb weniger Sekunden in den Snapshot und den Versionsverlauf.',
  stateConflict: 'Snapshot und BaoCut beide geändert',
  stateConflictDesc:
    'Die Snapshot-Dateien wurden außerhalb von BaoCut geändert, und BaoCut hat ebenfalls Änderungen, die noch nicht im Snapshot sind. BaoCut überschreibt den Snapshot erst, wenn Sie gewählt haben, was erhalten bleiben soll.',
  stateInvalid: 'Snapshot nicht lesbar',
  stateInvalidDesc:
    'Die Snapshot-Dateien lassen sich nicht einlesen, daher hat BaoCut sie nicht importiert. BaoCut prüft erneut, sobald Sie sie korrigiert haben, oder Sie überschreiben sie mit dem Inhalt aus BaoCut.',
  stateExternal: 'Externe Änderungen werden importiert',
  stateExternalDesc:
    'Die Snapshot-Dateien wurden außerhalb von BaoCut geändert (git pull, ein Sync-Laufwerk oder eine manuelle Bearbeitung), und BaoCut hat keine anderen Änderungen. Daher werden sie als Version „Externe Änderung“ importiert.',
  stateMissing: 'Noch kein Snapshot',
  stateMissingDesc: 'Der Arbeitsbereich-Snapshot wurde noch nicht geschrieben, oder video.json fehlt.',
  stateRebuild: 'Neuaufbau nötig',
  stateRebuildDesc: 'Es gibt nur den Arbeitsbereich-Snapshot, aber keine Videobibliothek. BaoCut baut das Video beim Öffnen daraus neu auf.',
  footer: (keep: number) =>
    `Versionen liegen im Ordner .bcut-snapshot/history/ des Videos und hängen nicht von git ab. BaoCut behält die neuesten ${keep} unbenannten Versionen sowie alle gespeicherten Versionen.`,
  save: 'Version speichern',
  saveIntro: 'Speichern Sie den aktuellen Inhalt als benannte Version. Gespeicherte Versionen werden nie automatisch bereinigt; nur Sie können sie löschen.',
  nameLabel: 'Name',
  namePlaceholder: 'Zum Beispiel: Schnitt zur Abnahme',
  nameRequired: 'Geben Sie dieser Version einen Namen',
  noteLabel: 'Notiz (optional)',
  cancel: 'Abbrechen',
  saveSubmit: 'Speichern',
  conflictIntro:
    'Diese Snapshot-Dateien wurden außerhalb von BaoCut geändert, etwa durch git pull, ein Sync-Laufwerk oder eine manuelle Bearbeitung, und BaoCut hat ebenfalls Änderungen, die noch nicht im Snapshot sind:',
  conflictOutro:
    'Bis Sie gewählt haben, was erhalten bleiben soll, überschreibt BaoCut den Snapshot nicht. Sie können das Video weiter bearbeiten, aber weder Versionen speichern noch zu einer Version zurückkehren.',
  invalidIntro: 'Diese Snapshot-Dateien lassen sich nicht einlesen. Sie enthalten möglicherweise Merge-Konfliktmarker, sind abgeschnitten oder wurden von Hand beschädigt:',
  invalidOutro:
    'BaoCut hat sie nicht importiert. Sie können das Video weiter bearbeiten, aber weder Versionen speichern noch zu einer Version zurückkehren. BaoCut prüft erneut, sobald Sie diese Dateien korrigiert haben, oder Sie behalten den Inhalt aus BaoCut und überschreiben sie.',
  externalIntro: 'Diese Snapshot-Dateien wurden außerhalb von BaoCut geändert, etwa durch git pull, ein Sync-Laufwerk oder eine manuelle Bearbeitung:',
  externalOutro:
    'BaoCut hat keine Änderungen, die noch nicht im Snapshot sind, und importiert sie daher direkt als Version „Externe Änderung“. Sie können den Import anschließend rückgängig machen.',
  stripConflict: 'Der Snapshot wurde außerhalb von BaoCut geändert, und BaoCut hat ebenfalls neue Änderungen. Wählen Sie, was erhalten bleiben soll.',
  stripInvalid: 'Die Snapshot-Dateien sind nicht lesbar. BaoCut hat sie nicht importiert.',
  view: 'Ansehen',
  keepVideo: 'Inhalt aus BaoCut behalten',
  useSnapshot: 'Snapshot auf der Festplatte verwenden',
  keepTitle: 'Inhalt aus BaoCut behalten?',
  keepConfirm: 'Snapshot auf der Festplatte überschreiben',
  keepBody: (count: number, files: string, invalid: boolean) =>
    `Der Inhalt aus BaoCut wird sofort in den Snapshot geschrieben und überschreibt ${count === 1 ? `die ${invalid ? 'nicht lesbare' : 'geänderte'} Datei` : `die ${count} ${invalid ? 'nicht lesbaren' : 'geänderten'} Dateien`} auf der Festplatte${files ? ` (${files})` : ''}. Diese Änderungen auf der Festplatte gelangen nicht in den Versionsverlauf und lassen sich in BaoCut nicht zurückholen; stammen sie aus git oder einem Sync-Laufwerk, können Sie sie dort zurückholen.`,
  diskTitle: 'Snapshot auf der Festplatte verwenden?',
  diskConfirm: 'Snapshot auf der Festplatte verwenden',
  diskBody: (files: string) =>
    `Der Inhalt des Videos wird durch den Snapshot auf der Festplatte${files ? ` (${files})` : ''} ersetzt und als Version „Externe Änderung“ erfasst. Änderungen in BaoCut, die noch nicht im Snapshot sind, gelangen zuerst in den Versionsverlauf: Kehren Sie zum Stand vor der Version „Externe Änderung“ zurück, um sie zurückzuholen. Sie können das auch rückgängig machen.`,
  keptTitle: 'Inhalt aus BaoCut behalten',
  keptText: (version: number | null) =>
    `Der Snapshot auf der Festplatte entspricht jetzt BaoCut${version ? `, und Ihre letzten Änderungen sind in Version ${version}` : ''}. Die Änderungen, die auf der Festplatte waren, sind nicht in den Versionsverlauf gelangt.`,
  usedDiskTitle: (version: number) => `Snapshot auf der Festplatte verwendet, erfasst als Version ${version} „Externe Änderung“`,
  usedDiskText: (version: number) =>
    `Kehren Sie zum Stand vor Version ${version} zurück, um den bisherigen Inhalt aus BaoCut zurückzuholen. Sie können das auch rückgängig machen.`,
  importedTitle: (version: number | null) => (version ? `Externe Änderungen als Version ${version} „Externe Änderung“ importiert` : 'Externe Änderungen importiert'),
  importedText:
    'Die Snapshot-Dateien wurden außerhalb von BaoCut geändert, und BaoCut hatte keine anderen Änderungen, daher wurden sie direkt importiert. Kehren Sie zum Stand vor dieser Version zurück, um den Inhalt vor dem Import zu sehen, oder machen Sie den Import rückgängig.',
  importUndoneTitle: 'Import rückgängig gemacht',
  importUndoneText:
    'Das Video hat wieder seinen Inhalt von vor dem Import und wird innerhalb weniger Sekunden zurück in den Snapshot geschrieben; damit wird diese externe Änderung verworfen. Das Rückgängigmachen ist selbst eine Änderung und fließt in eine neue Version ein.',
  refusedBroken: 'Zu dieser Version kann nicht zurückgekehrt werden',
  refusedOther: 'Nicht ausgeführt',
  refusedText: (message: string) => `${message}. Das Video ist unverändert.`,
  savedTitle: (version: number, name: string) => `Als Version ${version} „${name}“ gespeichert`,
  savedText: 'Gespeicherte Versionen bleiben erhalten; die Aufbewahrungsregel entfernt sie nie.',
  restoredTitle: (version: number, before: boolean, recorded: number) =>
    before
      ? `Zum Stand vor Version ${version} zurückgekehrt, erfasst als Version ${recorded}`
      : `Zu Version ${version} zurückgekehrt, erfasst als Version ${recorded}`,
  restoredText: 'Das ist eine gewöhnliche Änderung: Sie können sie hier rückgängig machen oder nach dem Schließen dieses Dialogs im Editor.',
  undo: 'Rückgängig machen',
  undoneTitle: (version: number, before: boolean) =>
    before ? `Rückgängig gemacht: Rückkehr zum Stand vor Version ${version}` : `Rückgängig gemacht: Rückkehr zu Version ${version}`,
  undoneText: 'Das Video hat wieder seinen vorherigen Inhalt. Das Rückgängigmachen ist selbst eine Änderung und fließt in die neueste Version ein.',
  noopTitle: 'Keine Änderungen',
  noopText: (version: number, before: boolean) =>
    before
      ? `Das Video ist bereits im Stand vor Beginn von Version ${version}. Es wurde nichts übernommen und keine neue Version angelegt.`
      : `Das Video ist bereits im Stand am Ende von Version ${version}. Es wurde nichts übernommen und keine neue Version angelegt.`,
  deletedTitle: (name: string) => `Gespeicherte Version „${name}“ gelöscht`,
  deletedText: 'Der Videoinhalt hat sich nicht geändert.',
  emptyTitle: 'Noch keine Versionen',
  emptyText: (missing: boolean): string =>
    missing
      ? 'Der Arbeitsbereich-Snapshot wurde noch nicht geschrieben. Ihre nächste Änderung wird zu Version 1, oder Sie speichern jetzt eine Version.'
      : 'Ihre nächste Änderung wird zu Version 1, oder Sie speichern jetzt eine Version.',
  outsideTitle: 'Dieses Video ist in keinem Projekt',
  outsideText: 'Nur Videos in einem Projekt haben einen Versionsverlauf. Verschieben Sie das Video zuerst in ein Projekt.',
  listLabel: 'Versionen',
  versionN: (version: number) => `Version ${version}`,
  openBadge: 'Noch offen',
  blockedFlag: 'Kein Zurück möglich',
  unreadableTitle: 'Diese Versionsdatei ist nicht lesbar',
  kindSegment: 'Bearbeitungen',
  kindSave: 'Gespeicherte Version',
  kindRestore: 'Rückkehr zu einer Version',
  kindExternal: 'Externe Änderung',
  kindRebuild: 'Neuaufbau',
  revisions: (from: string, to: string) => (from === to ? `Revision ${to}` : `Revisionen ${from}–${to}`),
  openHint: 'Die neueste Version ist noch offen: Bis 5 ruhige Minuten vergangen sind oder sie 30 Minuten umfasst, fließen Ihre nächsten Änderungen in sie ein.',
  openHintPending: 'Die neueste Version ist noch offen. Die letzten Änderungen werden gerade geschrieben und fließen innerhalb weniger Sekunden in sie ein.',
  openHintConflict: 'Die neueste Version ist noch offen, aber neue Änderungen gelangen erst in den Versionsverlauf, wenn der Snapshot-Konflikt geklärt ist.',
  openHintExternal:
    'Die neueste Version ist noch offen. Der Snapshot auf der Festplatte wird gerade importiert: Diese Version wird zuerst abgeschlossen, und die externen Änderungen werden zu einer eigenen Version.',
  externalHint:
    'Diese Version stammt von außerhalb von BaoCut: Die Snapshot-Dateien wurden durch git pull, ein Sync-Laufwerk oder eine manuelle Bearbeitung geändert, und BaoCut hat sie als diese Version importiert. Kehren Sie zum Stand vor dieser Version zurück, um den Inhalt zurückzuholen, der vor dem Import in BaoCut war.',
  restoreEnd: 'Zu dieser Version zurückkehren',
  restoreBefore: 'Zum Stand vor dieser Version zurückkehren',
  deleteSaved: 'Diese gespeicherte Version löschen',
  whyNotFound: 'Diese Version existiert nicht mehr',
  whyUnreadable: (version: number) =>
    `Die Datei von Version ${version} ist nicht lesbar, daher lässt sich weder zu ihr noch zu früheren Ständen zurückkehren`,
  whyBroken: (version: number) => `Der Versionsverlauf stimmt bei Version ${version} nicht überein, daher lässt sich nicht zu früheren Ständen zurückkehren`,
  noopBoth: (version: number) =>
    `Das Video ist bereits im Stand von Version ${version} (ihr Inhalt ist davor und danach gleich), eine Rückkehr ändert also nichts`,
  noopEnd: (version: number) => `Das Video ist bereits im Stand am Ende von Version ${version}, eine Rückkehr ändert also nichts`,
  noopBefore: (version: number) => `Das Video ist bereits im Stand vor Beginn von Version ${version}, eine Rückkehr ändert also nichts`,
  factActors: 'Geändert von',
  factConversations: 'Sitzungen',
  factFiles: 'Was sich geändert hat',
  factCheckpoint: 'Sicherungspunkt',
  actorYou: 'Sie',
  actorAgent: 'Agent',
  actorExternal: (name: string) => `Externer Dienst ${name}`,
  actorSystem: 'BaoCut',
  actionCount: (label: string, count: number) => (count > 1 ? `${label} ×${count}` : label),
  listSeparator: ', ',
  noActions: 'Keine Änderungen aufgezeichnet',
  noActionsRebuild: 'BaoCut hat das Video aus seinem Snapshot neu aufgebaut; keine inhaltlichen Änderungen',
  omitted: (count: number) => (count === 1 ? '1 weitere Änderung wurde nur gezählt' : `${count} weitere Änderungen wurden nur gezählt`),
  notHere: '(nicht auf diesem Computer)',
  openConversation: (title: string) => `Sitzung „${title}“ öffnen`,
  fileTimeline: 'Zeitleiste',
  fileDocument: 'Dokument',
  changeAdd: 'Hinzugefügt',
  changeDelete: 'Gelöscht',
  changeModify: 'Geändert',
  noFiles: 'Keine inhaltlichen Änderungen',
  diffTitle: 'Änderungen',
  copyDiff: 'Diff kopieren',
  copied: 'Kopiert',
  copyFailed: 'Kopieren fehlgeschlagen. Text auswählen und manuell kopieren.',
  diffEmpty: 'Der Diff dieser Version ist leer: Der Inhalt entspricht dem Ende der vorherigen Version.',
  diffLabel: (version: number) => `Diff von Version ${version}`,
  diffLoading: 'Diff wird geladen',
  diffFailed: (message: string) => `Diese Version konnte nicht gelesen werden: ${message}`,
  diffMore: (count: number) =>
    count === 1
      ? '1 weitere Zeile wird nicht angezeigt. Kopieren Sie den Diff, um alles zu sehen.'
      : `${count} weitere Zeilen werden nicht angezeigt. Kopieren Sie den Diff, um alles zu sehen.`,
  unreadableHeading: (file: string) => `${file} kann nicht gelesen werden`,
  unreadableText: (why: string) =>
    `Der Kopfbereich oder der Diff der Versionsdatei ist beschädigt; sie wurde möglicherweise abgeschnitten oder von Hand bearbeitet. ${why}. Neuere Versionen sind nicht betroffen.`,
  confirmRestoreTitle: (version: number, before: boolean) =>
    before ? `Zum Stand vor Version ${version} zurückkehren?` : `Zu Version ${version} zurückkehren?`,
  confirmRestoreBody: (version: number, before: boolean, when: string) =>
    `${
      before
        ? `Der Inhalt des Videos wird durch seinen Stand vor Beginn von Version ${version} (${when}) ersetzt.`
        : `Der Inhalt des Videos wird durch seinen Stand am Ende von Version ${version} (${when}) ersetzt.`
    } Das ist eine Änderung, die Sie rückgängig machen können; sie wird als neue Version erfasst. Bestehende Versionen bleiben erhalten, Sicherungspunkte und Schutz ändern sich nicht.`,
  confirmDeleteTitle: (name: string) => `Gespeicherte Version „${name}“ löschen?`,
  confirmDeleteMiddle: (next: number) =>
    `Nur diese Version und ihr Sicherungspunkt werden gelöscht; die Änderungen dieser Version gehen in die direkt folgende Version ${next} ein. Der Videoinhalt ändert sich nicht.`,
  confirmDeleteTop:
    'Nur Name, Notiz und Sicherungspunkt werden entfernt: Diese Version wird zu einer gewöhnlichen Reihe von Bearbeitungen, und spätere Änderungen fließen in sie ein. Der Videoinhalt ändert sich nicht.',
  delete: 'Löschen',
};
