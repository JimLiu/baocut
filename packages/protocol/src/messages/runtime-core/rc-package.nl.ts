const s = (n: number, one: string, many: string) => pluralForm('nl', n, { one, other: many });
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
import { pluralForm } from '../../i18n.ts';
import type { RcPackageMessages } from './rc-package.ts';

export const nl: RcPackageMessages = {

  localPathPlaceholder: "<lokaal pad verwijderd>",
  assetsUnreadable: (p: { count: number }) => `${pluralForm('nl', p.count, { one: `${p.count} mediarevisie kan niet worden gelezen`, other: `${p.count} mediarevisies kunnen niet worden gelezen` })}, dus het pakket zou onvolledig zijn; zoek de bestanden of koppel ze opnieuw of kies ontbrekende media overslaan`,
  assetsUnreadableRecovery:
    "Koppel opnieuw (relinkAsset) of herstel de bestanden; of exporteer met missingAssets: skip, dan markeert het manifest ze als ontbrekend",
  documentDigestMismatch: (p: { documentId: string; revision: string }) =>
    `De inhoud van document ${p.documentId}, revisie ${p.revision} komt niet overeen met de geregistreerde digest`,
  documentsContainLocalPaths: "Sommige documenten bevatten lokale paden die een draagbaar pakket niet kan meenemen; bewerk die documenten eerst",
  missingNote: (p: { reason: string }) => `Kan niet worden gelezen bij export (${p.reason})`,
  localPathsRemoved: (p: { count: number; places: string; more: boolean }) =>
    `Vervangen: ${p.count} lokale ${s(p.count, "pad", "paden")} in de momentopname door een tijdelijke aanduiding: ${p.places}${p.more ? "…" : ""}`,
  assetNotPackaged: (p: { key: string; reason: string }) =>
    `Kan de mediarevisie niet lezen: ${p.key} (${p.reason}); die is weggelaten uit het pakket en gemarkeerd als ontbrekend in het manifest`,
  filesNotArchivable: "Sommige bestanden kunnen niet naar het .baocut-archief worden geschreven",
  insufficientSpace: (p: { required: string; available: string }) =>
    `Onvoldoende ruimte op de schijf met de exportmap: vereist ongeveer ${p.required}, slechts ${p.available} over`,
  assetReadIncomplete: (p: { name: string }) => `Media ‘${p.name}’ kunnen niet volledig worden gelezen of zijn tijdens de export gewijzigd`,
  assetContentChanged: (p: { name: string; linked: boolean }) =>
    `Media ‘${p.name}’ komen niet overeen met de geregistreerde inhoud (${p.linked ? "het gekoppelde bestand is gewijzigd" : "het bestand in de video is beschadigd"})`,
  diskFullWhileWriting: "De schijf met de exportmap is vol geraakt tijdens het schrijven van het pakket",
  packageVerifyFailed: (p: { error: string }) => `Het geschreven pakket heeft de controle niet doorstaan: ${p.error}`,
  manifestReadBackMismatch: "Het manifest dat uit het geschreven pakket is teruggelezen verschilt van wat is geschreven",

  tarFileTooLarge: "Een enkel bestand mag niet groter zijn dan 8 GiB (grotere bestanden vereisen uitgebreide pax-headers, die deze versie niet ondersteunt)",
  tarPathTooLong: (p: { max: number }) => `Een pad in het pakket is te lang (maximaal ${p.max} bytes)`,
  archivePathTooLong: (p: { path: string }) => `Een pad in het pakket is te lang: ${p.path}`,
  archiveFileTooLarge: (p: { path: string }) => `Bestand te groot: ${p.path}`,
  entryLongerThanExpected: (p: { path: string }) => `${p.path} is langer dan verwacht: het is gewijzigd tijdens het lezen`,
  entryShorterThanExpected: (p: { path: string }) => `${p.path} is korter dan verwacht: het is gewijzigd tijdens het lezen`,
  archiveHeaderCorrupt: "De archiefheader is beschadigd",
  archiveTruncated: "Het archief is afgekapt",
  archiveChecksumMismatch: "De controlesom van de archiefheader is onjuist: het bestand is beschadigd of is geen .baocut-pakket",
  notUstar: "Geen POSIX-ustar-archief",
  archiveHasLink: (p: { path: string }) => `Het pakket bevat een link (${p.path}), die niet wordt geaccepteerd`,
  unsafePath: (p: { path: string }) => `Onveilig pad in het pakket: ${p.path}`,
  unsupportedEntryType: (p: { path: string }) => `Het pakket heeft een niet-ondersteund itemtype (${p.path})`,
  duplicateEntry: (p: { path: string }) => `${p.path} staat twee keer in het pakket`,
  entryTooLarge: (p: { path: string }) => `${p.path} is te groot`,

  manifestNotJson: "Het pakketmanifest is geen JSON",
  notBaocutPackage: "Geen draagbaar BaoCut-pakket",
  invalidPackageVersion: "De pakketversie is ongeldig",
  packageVersionTooNew: (p: { version: number; supported: number }) =>
    `Dit pakket heeft versie ${p.version}, maar deze versie van BaoCut ondersteunt alleen ${p.supported}; open het met een nieuwere BaoCut`,
  manifestMissingFileList: "Het pakketmanifest heeft geen bestandenlijst",
  manifestIncompleteFile: "Het pakketmanifest heeft een onvolledige bestandsregistratie",
  manifestUnsafePath: (p: { path: string }) => `Onveilig pad in het pakketmanifest: ${p.path}`,
  manifestIncompleteEntry: "Het pakketmanifest heeft een onvolledige revisieregistratie",
  manifestMissingKey: (p: { key: string }) => `In het pakketmanifest ontbreekt ${p.key}`,
  packageNoManifest: "Het pakket heeft geen manifest (video.manifest.json)",
  manifestDuplicate: (p: { path: string }) => `${p.path} staat twee keer in het pakketmanifest`,
  fileNotInManifest: (p: { path: string }) => `Het pakket bevat een bestand dat niet in het manifest staat: ${p.path}`,
  fileMissingFromPackage: (p: { path: string }) => `Het pakket mist een bestand dat in het manifest staat: ${p.path}`,
  fileLengthMismatch: (p: { path: string }) => `De lengte van ${p.path} komt niet overeen met het manifest`,
  packageNoSnapshot: "Het pakket heeft geen videomomentopname (video.snapshot.json)",
  fileDigestMismatch: (p: { path: string }) => `De inhoud van ${p.path} komt niet overeen met de digest in het manifest`,
  entryAsset: (p: { ref: string }) => `media ${p.ref}`,
  entryDocument: (p: { ref: string }) => `document ${p.ref}`,
  entryIncludedWithoutPath: (p: { what: string }) => `${cap(p.what)} is gemarkeerd als inbegrepen maar heeft geen pad`,
  entryDigestMismatch: (p: { what: string }) => `De inhoudsdigest van ${p.what} komt niet overeen met het bestand in het pakket`,
  entryFileMissing: (p: { what: string }) => `Het pakket mist het bestand voor ${p.what}`,
};
