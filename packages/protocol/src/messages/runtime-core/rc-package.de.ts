const s = (n: number, one: string, many: string) => pluralForm('de', n, { one, other: many });
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
import { pluralForm } from '../../i18n.ts';
import type { RcPackageMessages } from './rc-package.ts';

export const de: RcPackageMessages = {

  localPathPlaceholder: "<lokaler Pfad entfernt>",
  assetsUnreadable: (p: { count: number }) => `${pluralForm('de', p.count, { one: `${p.count} Materialrevision kann nicht gelesen werden`, other: `${p.count} Materialrevisionen können nicht gelesen werden` })}; das Paket wäre unvollständig. Dateien finden oder erneut verknüpfen oder fehlendes Material überspringen`,
  assetsUnreadableRecovery:
    "Dateien mit relinkAsset erneut verknüpfen oder wiederherstellen; oder mit missingAssets: skip exportieren, dann markiert das Manifest sie als fehlend",
  documentDigestMismatch: (p: { documentId: string; revision: string }) =>
    `Der Inhalt des Dokuments ${p.documentId}, Revision ${p.revision} stimmt nicht mit der gespeicherten Prüfsumme überein`,
  documentsContainLocalPaths: "Einige Dokumente enthalten lokale Pfade, die ein portables Paket nicht mitnehmen kann; diese Dokumente zuerst bearbeiten",
  missingNote: (p: { reason: string }) => `Beim Export nicht lesbar (${p.reason})`,
  localPathsRemoved: (p: { count: number; places: string; more: boolean }) => `${pluralForm('de', p.count, { one: `${p.count} lokaler Pfad wurde`, other: `${p.count} lokale Pfade wurden` })} im Snapshot durch einen Platzhalter ersetzt: ${p.places}${p.more ? '…' : ''}`,
  assetNotPackaged: (p: { key: string; reason: string }) =>
    `Materialrevision nicht lesbar: ${p.key} (${p.reason}); wurde aus dem Paket weggelassen und im Manifest als fehlend markiert`,
  filesNotArchivable: "Einige Dateien können nicht ins .baocut-Archiv geschrieben werden",
  insufficientSpace: (p: { required: string; available: string }) =>
    `Nicht genug Speicherplatz auf der Festplatte mit dem Exportordner: benötigt etwa ${p.required}, nur ${p.available} verfügbar`,
  assetReadIncomplete: (p: { name: string }) => `Material „${p.name}“ konnte nicht vollständig gelesen werden oder wurde während des Exports geändert`,
  assetContentChanged: (p: { name: string; linked: boolean }) =>
    `Material „${p.name}“ entspricht nicht dem gespeicherten Inhalt (${p.linked ? "die verknüpfte Datei wurde geändert" : "die Datei im Video ist beschädigt"})`,
  diskFullWhileWriting: "Die Festplatte mit dem Exportordner wurde beim Schreiben des Pakets voll",
  packageVerifyFailed: (p: { error: string }) => `Das geschriebene Paket hat die Prüfung nicht bestanden: ${p.error}`,
  manifestReadBackMismatch: "Das zurückgelesene Manifest unterscheidet sich vom geschriebenen Manifest",

  tarFileTooLarge: "Eine einzelne Datei darf 8 GiB nicht überschreiten (größere Dateien benötigen erweiterte pax-Header, die diese Version nicht unterstützt)",
  tarPathTooLong: (p: { max: number }) => `Ein Pfad im Paket ist zu lang (höchstens ${p.max} Bytes)`,
  archivePathTooLong: (p: { path: string }) => `Ein Pfad im Paket ist zu lang: ${p.path}`,
  archiveFileTooLarge: (p: { path: string }) => `Datei zu groß: ${p.path}`,
  entryLongerThanExpected: (p: { path: string }) => `${p.path} ist länger als erwartet: während des Lesens geändert`,
  entryShorterThanExpected: (p: { path: string }) => `${p.path} ist kürzer als erwartet: während des Lesens geändert`,
  archiveHeaderCorrupt: "Der Archivkopf ist beschädigt",
  archiveTruncated: "Das Archiv ist abgeschnitten",
  archiveChecksumMismatch: "Die Prüfsumme des Archivkopfs ist falsch: Datei beschädigt oder kein .baocut-Paket",
  notUstar: "Kein POSIX-ustar-Archiv",
  archiveHasLink: (p: { path: string }) => `Das Paket enthält einen Link (${p.path}), der nicht akzeptiert wird`,
  unsafePath: (p: { path: string }) => `Unsicherer Pfad im Paket: ${p.path}`,
  unsupportedEntryType: (p: { path: string }) => `Das Paket enthält einen nicht unterstützten Eintragstyp (${p.path})`,
  duplicateEntry: (p: { path: string }) => `${p.path} erscheint zweimal im Paket`,
  entryTooLarge: (p: { path: string }) => `${p.path} ist zu groß`,

  manifestNotJson: "Das Paketmanifest ist kein JSON",
  notBaocutPackage: "Kein portables BaoCut-Paket",
  invalidPackageVersion: "Die Paketversion ist ungültig",
  packageVersionTooNew: (p: { version: number; supported: number }) =>
    `Dieses Paket hat Version ${p.version}, aber diese BaoCut-Version unterstützt nur ${p.supported}; mit neuerem BaoCut öffnen`,
  manifestMissingFileList: "Das Paketmanifest enthält keine Dateiliste",
  manifestIncompleteFile: "Das Paketmanifest enthält einen unvollständigen Dateieintrag",
  manifestUnsafePath: (p: { path: string }) => `Unsicherer Pfad im Paketmanifest: ${p.path}`,
  manifestIncompleteEntry: "Das Paketmanifest enthält einen unvollständigen Revisionseintrag",
  manifestMissingKey: (p: { key: string }) => `Im Paketmanifest fehlt ${p.key}`,
  packageNoManifest: "Das Paket hat kein Manifest (video.manifest.json)",
  manifestDuplicate: (p: { path: string }) => `${p.path} erscheint zweimal im Paketmanifest`,
  fileNotInManifest: (p: { path: string }) => `Das Paket enthält eine Datei, die nicht im Manifest steht: ${p.path}`,
  fileMissingFromPackage: (p: { path: string }) => `Im Paket fehlt eine Datei aus dem Manifest: ${p.path}`,
  fileLengthMismatch: (p: { path: string }) => `Die Länge von ${p.path} stimmt nicht mit dem Manifest überein`,
  packageNoSnapshot: "Das Paket hat keinen Video-Snapshot (video.snapshot.json)",
  fileDigestMismatch: (p: { path: string }) => `Der Inhalt von ${p.path} stimmt nicht mit der Manifest-Prüfsumme überein`,
  entryAsset: (p: { ref: string }) => `Material ${p.ref}`,
  entryDocument: (p: { ref: string }) => `Dokument ${p.ref}`,
  entryIncludedWithoutPath: (p: { what: string }) => `${cap(p.what)} ist als enthalten markiert, hat aber keinen Pfad`,
  entryDigestMismatch: (p: { what: string }) => `Die Inhaltsprüfsumme von ${p.what} stimmt nicht mit der Datei im Paket überein`,
  entryFileMissing: (p: { what: string }) => `Im Paket fehlt die Datei für ${p.what}`,
};
