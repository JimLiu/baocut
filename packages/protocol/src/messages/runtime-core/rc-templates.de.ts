import type { RcTemplatesMessages } from './rc-templates.ts';

export const de: RcTemplatesMessages = {
  builtinConflict: (p: { id: string }) =>
    `Eine integrierte Vorlage mit der ID „${p.id}“ ist bereits vorhanden; diese Kopie wurde nicht geladen. ID (Ordnername) ändern und erneut hinzufügen`,
  templateNotFound: (p: { id: string }) => `Vorlage nicht gefunden: ${p.id}`,
  fileNotRegistered: (p: { id: string; file: string }) => `Vorlage „${p.id}“ listet diese Datei nicht: ${p.file}`,
  dirIsSymlink: "Der Vorlagenordner ist ein symbolischer Link, dem nicht gefolgt wird. Den Vorlagenordner selbst hinzufügen",
  duplicateId: (p: { id: string }) => `Mehrere Vorlagen im selben Verzeichnis haben die ID „${p.id}“; keiner wurde geladen`,
  templateInvalid: "Die Vorlage ist ungültig und wurde nicht geladen",
  unsupportedSchema: "Diese Version erkennt das Manifest-Schema nicht; die Vorlage wurde nicht geladen",
  missingFile: (p: { file: string }) => `${p.file} fehlt`,
  fileOverBytes: (p: { file: string; limit: number }) => `${p.file} ist größer als ${p.limit} Bytes`,
  fileOverBytesActual: (p: { file: string; limit: number; size: number }) => `${p.file} ist größer als ${p.limit} Bytes (${p.size})`,
  fileNotUtf8: (p: { file: string }) => `${p.file} ist kein gültiges UTF-8`,
  fileNotJson: (p: { file: string }) => `${p.file} ist kein gültiges JSON`,
  fileEmpty: (p: { file: string }) => `${p.file} ist leer`,
  registeredFileMissing: (p: { file: string }) => `Eine gelistete Datei ist nicht vorhanden: ${p.file}`,
  pathOutsideTemplate: (p: { file: string }) => `Pfad liegt außerhalb des Vorlagenordners: ${p.file}`,
  unregisteredFile: (p: { file: string }) => `Der Ordner enthält eine nicht gelistete Datei: ${p.file}`,
  tooManyEntries: (p: { limit: number }) => `Der Ordner enthält mehr als ${p.limit} Einträge`,
  noSymlinks: (p: { path: string }) => `Symbolische Links sind nicht erlaubt: ${p.path}`,
  notRegularFile: (p: { path: string }) => `Keine reguläre Datei: ${p.path}`,
  cannotReadDir: (p: { code: string }) => `Vorlagenordner konnte nicht gelesen werden (${p.code})`,
  notScene: (p: { title: string }) =>
    `„${p.title}“ ist ein Vorführbeispiel: Prompt ohne Vorlagenanhang in das Nachrichtenfeld einfügen und senden`,
  assetNotRegistered: (p: { id: string; asset: string }) => `Vorlage „${p.id}“ listet dieses Material nicht: ${p.asset}`,
};
