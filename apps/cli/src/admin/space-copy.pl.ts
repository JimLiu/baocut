import { pluralForm } from '@baocut/protocol';
import type { SpaceMessages } from './space-copy.ts';

export const pl: SpaceMessages = {
  help: "Użycie:\n  baocut space rescan              Ponownie skanuj foldery źródłowe\n  baocut space rebuild             Przebuduj katalog Space z folderów źródłowych i zapisów;\n                                   indeks treści ponownie odczytuje wszystkie wideo w tle\n  baocut space trash|restore <entry id>\n                                   Przenieś do kosza / przywróć (pliki bez zmian;\n                                   dla wpisów wideo folder wideo trafia do kosza lub wraca z niego)\n  baocut space purge <entry id>    Trwale usuń wpis z kosza; nie usuwany, dopóki\n                                   wideo lub zadanie go używa, odwołania są wyświetlane\n  baocut space delete-video <entry id>\n                                   Usuń wideo: folder trafia do kosza, można przywrócić\n                                   w okresie przechowywania; oryginalne pliki powiązanych materiałów bez zmian\n  baocut space continue <entry id> [--conversation <session id>]\n                                   Kontynuuj sesję z wpisu: odwołanie (tylko ID i metadane) dołączone\n                                   do kolejnej wiadomości; bez sesji wybiera ją według lokalizacji wpisu lub tworzy",
  usage: [
    "Użycie: baocut space rescan | rebuild | trash <entry id> | restore <entry id> | purge <entry id> | delete-video <entry id>",
    "       baocut space continue <entry id> [--conversation <session id>]",
  ].join("\n"),
  entryUsage: (action) => `Użycie: baocut space ${action} <entry id>`,
  continueUsage: "Użycie: baocut space continue <entry id> [--conversation <session id>]",
  flagNotAccepted: (action, key) => `baocut space ${action} nie przyjmuje --${key}`,
  rescanStarted: "Ponowne skanowanie rozpoczęte",
  rebuilt: (entries, pendingVideos) => `Przebudowano katalog: ${pluralForm('pl', entries, { one: `${entries} wpis`, few: `${entries} wpisy`, many: `${entries} wpisów`, other: `${entries} wpisu` })}; indeks treści odczytuje ponownie ${pluralForm('pl', pendingVideos, { one: `${pendingVideos} wideo`, few: `${pendingVideos} wideo`, many: `${pendingVideos} wideo`, other: `${pendingVideos} wideo` })} w tle, więc do ukończenia wyniki wyszukiwania są niepełne`,
  purgeBlocked: (id) => `${id} jest nadal używany przez wideo lub zadanie; nie usunięto`,
  movedToTrash: (id, name) => `Przeniesiono do kosza: ${id}  ${name}`,
  restoredFromTrash: (id, name) => `Przywrócono z kosza: ${id}  ${name}`,
  purged: (id) => `Trwale usunięto: ${id}`,
  notPurged: (id) => `Nie usunięto: ${id}: nadal są odwołania`,
  videoTrashed: (name, entryId, retentionDays) => `Wideo „${name}” przeniesiono do kosza: ${entryId} (przywróć przez baocut space restore ${entryId}${retentionDays === null ? '' : `; trwale usunięte po ${pluralForm('pl', retentionDays, { one: `${retentionDays} dzień`, few: `${retentionDays} dni`, many: `${retentionDays} dni`, other: `${retentionDays} dnia` })}`})`,
  relatedKept: (n) => `${pluralForm('pl', n, { one: `${n} wpis`, few: `${n} wpisy`, many: `${n} wpisów`, other: `${n} wpisu` })} wyeksportowane lub wygenerowane z wideo pozostają na miejscu`,
  continued: (created, id, cwd) => `${created ? "Utworzono sesję" : "Używana sesja"} ${id}  folder roboczy ${cwd}`,
  referenceNext: (name, id) => `Odwołanie do wpisu „${name}” zostanie dodane do kolejnej wiadomości: baocut chat "…" --conversation ${id}`,
};
