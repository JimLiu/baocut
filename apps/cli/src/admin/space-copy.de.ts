import { pluralForm } from '@baocut/protocol';
import type { SpaceMessages } from './space-copy.ts';
const entries = (n: number) => pluralForm('de', n, { one: `${n} Eintrag`, other: `${n} Einträge` });
export const de: SpaceMessages = {
 help: `Verwendung:
  baocut space rescan              Quellordner erneut durchsuchen
  baocut space rebuild             Space-Katalog aus Quellordnern und Aufzeichnungen neu aufbauen;
                                   der Inhaltsindex liest alle Videos im Hintergrund erneut.
  baocut space trash|restore <entry id>
                                   In den Papierkorb verschieben / daraus wiederherstellen. Dateien bleiben unverändert;
                                   bei Videoeinträgen wird der Videoordner in den / aus dem Papierkorb verschoben.
  baocut space purge <entry id>    Eintrag im Papierkorb endgültig löschen. Bei Nutzung durch ein Video oder
                                   eine Aufgabe wird nicht gelöscht und die Verweise werden aufgeführt.
  baocut space delete-video <entry id>
                                   Video löschen: Videoordner in den Papierkorb verschieben, innerhalb der Aufbewahrungsfrist
                                   wiederherstellbar. Originaldateien verknüpfter Materialien bleiben unverändert.
  baocut space continue <entry id> [--conversation <session id>]
                                   Sitzung von einem Eintrag aus fortsetzen: Ein Verweis (nur IDs und Metadaten) wird mit der
                                   nächsten Nachricht gesendet. Ohne Sitzung wird anhand des Speicherorts eine gewählt oder erstellt.`,
 usage: ['Verwendung: baocut space rescan | rebuild | trash <entry id> | restore <entry id> | purge <entry id> | delete-video <entry id>', '            baocut space continue <entry id> [--conversation <session id>]'].join('\n'), entryUsage: (action) => `Verwendung: baocut space ${action} <entry id>`, continueUsage: 'Verwendung: baocut space continue <entry id> [--conversation <session id>]', flagNotAccepted: (action, key) => `baocut space ${action} akzeptiert --${key} nicht`, rescanStarted: 'Erneute Suche gestartet', rebuilt: (n, pendingVideos) => `Katalog neu aufgebaut: ${entries(n)}. Der Inhaltsindex liest ${pluralForm('de', pendingVideos, { one: `${pendingVideos} Video`, other: `${pendingVideos} Videos` })} im Hintergrund erneut; bis zum Abschluss sind die Suchergebnisse unvollständig.`, purgeBlocked: (id) => `${id} wird noch von einem Video oder einer Aufgabe verwendet und wurde nicht gelöscht`, movedToTrash: (id, name) => `In den Papierkorb verschoben: ${id}  ${name}`, restoredFromTrash: (id, name) => `Aus dem Papierkorb wiederhergestellt: ${id}  ${name}`, purged: (id) => `${id} endgültig gelöscht`, notPurged: (id) => `${id} nicht gelöscht: Es bestehen noch Verweise`, videoTrashed: (name, entryId, retentionDays) => `Video „${name}“ in den Papierkorb verschoben: ${entryId} (mit baocut space restore ${entryId} wiederherstellen${retentionDays === null ? '' : `; nach ${pluralForm('de', retentionDays, { one: `${retentionDays} Tag`, other: `${retentionDays} Tagen` })} endgültig gelöscht`})`, relatedKept: (n) => pluralForm('de', n, { one: `${n} daraus exportierter oder erzeugter Eintrag bleibt erhalten`, other: `${n} daraus exportierte oder erzeugte Einträge bleiben erhalten` }), continued: (created, id, cwd) => `${created ? 'Sitzung erstellt' : 'Sitzung verwendet'} ${id}  Arbeitsordner ${cwd}`, referenceNext: (name, id) => `Ein Verweis auf den Eintrag „${name}“ wird mit der nächsten Nachricht gesendet: baocut chat "…" --conversation ${id}`,
};
