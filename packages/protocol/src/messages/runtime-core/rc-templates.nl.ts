import type { RcTemplatesMessages } from './rc-templates.ts';

export const nl: RcTemplatesMessages = {
  builtinConflict: (p: { id: string }) =>
    `Een ingebouwd sjabloon met ID ‘${p.id}’ bestaat al, dus deze kopie is niet geladen. Wijzig de ID (mapnaam) en voeg die opnieuw toe`,
  templateNotFound: (p: { id: string }) => `Sjabloon niet gevonden: ${p.id}`,
  fileNotRegistered: (p: { id: string; file: string }) => `Sjabloon ‘${p.id}’ vermeldt dit bestand niet: ${p.file}`,
  dirIsSymlink: "De sjabloonmap is een symbolische link en wordt niet gevolgd. Voeg de sjabloonmap zelf toe",
  duplicateId: (p: { id: string }) => `Meer dan één sjabloon in dezelfde map heeft ID ‘${p.id}’; geen ervan is geladen`,
  templateInvalid: "Het sjabloon is ongeldig en is niet geladen",
  unsupportedSchema: "Deze versie herkent het manifestschema niet, dus het sjabloon is niet geladen",
  missingFile: (p: { file: string }) => `${p.file} ontbreekt`,
  fileOverBytes: (p: { file: string; limit: number }) => `${p.file} is groter dan ${p.limit} bytes`,
  fileOverBytesActual: (p: { file: string; limit: number; size: number }) => `${p.file} is groter dan ${p.limit} bytes (${p.size})`,
  fileNotUtf8: (p: { file: string }) => `${p.file} is geen geldige UTF-8`,
  fileNotJson: (p: { file: string }) => `${p.file} is geen geldige JSON`,
  fileEmpty: (p: { file: string }) => `${p.file} is leeg`,
  registeredFileMissing: (p: { file: string }) => `Een vermeld bestand bestaat niet: ${p.file}`,
  pathOutsideTemplate: (p: { file: string }) => `Pad loopt buiten de sjabloonmap: ${p.file}`,
  unregisteredFile: (p: { file: string }) => `De map bevat een bestand dat niet is vermeld: ${p.file}`,
  tooManyEntries: (p: { limit: number }) => `De map bevat meer dan ${p.limit} items`,
  noSymlinks: (p: { path: string }) => `Symbolische links zijn niet toegestaan: ${p.path}`,
  notRegularFile: (p: { path: string }) => `Geen regulier bestand: ${p.path}`,
  cannotReadDir: (p: { code: string }) => `Kan de sjabloonmap niet lezen (${p.code})`,
  notScene: (p: { title: string }) =>
    `‘${p.title}’ is een demonstratievoorbeeld: zet de prompt in het berichtvak en verstuur die zonder een sjabloon toe te voegen`,
  assetNotRegistered: (p: { id: string; asset: string }) => `Sjabloon ‘${p.id}’ vermeldt deze media niet: ${p.asset}`,
  translationForBaseLanguage: (p: { file: string; language: string }) => `${p.file} is in de eigen taal van het sjabloon (${p.language}); template.json en prompt.md dekken die al`,
};
