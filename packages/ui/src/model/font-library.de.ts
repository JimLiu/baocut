const fontsN = (n: number) => pluralForm('de', n, { one: `${n} Schrift`, other: `${n} Schriften` });
const familiesN = (n: number) => pluralForm('de', n, { one: `${n} Familie`, other: `${n} Familien` });
import type { FontFamilyState } from "@baocut/protocol";
import type { FontFamilyStatus } from "@baocut/protocol";
import type { FontCategory } from "@baocut/protocol";
import type { FontScript } from "@baocut/protocol";
import { intlLocale } from "@baocut/protocol";
import { pluralForm } from '@baocut/protocol';
import type { FontLibraryMessages } from './font-library.ts';

export const de: FontLibraryMessages = {
  state: {
    'built-in': "Eingebaut",
    installed: "Installiert",
    downloaded: "Heruntergeladen",
    downloadable: "Zum Herunterladen verfügbar",
    downloading: "Wird heruntergeladen",
    failed: "Fehlgeschlagen",
    unavailable: "Schrift nicht gefunden",
  } as Record<FontFamilyState, string>,
  source: {
    'built-in': "In der App enthalten",
    local: "Auf diesem Computer installiert",
    'google-fonts': "Google Fonts",
  } as Record<FontFamilyStatus['source'], string>,
  categories: {
    'sans-serif': "Serifenlos",
    serif: "Serifenschrift",
    display: "Anzeige",
    handwriting: "Handschrift",
    monospace: "Nichtproportional",
  } as Record<FontCategory, string>,
  scripts: {
    chinese: "Chinesisch",
    japanese: "Japanisch",
    korean: "Koreanisch",
    latin: "Lateinisch",
    cyrillic: "Kyrillisch",
    greek: "Griechisch",
    vietnamese: "Vietnamesisch",
    arabic: "Arabisch",
    hebrew: "Hebräisch",
    thai: "Thailändisch",
    devanagari: "Devanagari",
  } as Record<Exclude<FontScript, 'other'>, string>,
  privacyNote: "Von Google Fonts heruntergeladen; nur Familienname und Schriftstärken werden gesendet. In App-Daten gespeichert, nicht im Videoordner.",
  offlineNote: "Offline · herunterladbare Schriften benötigen eine Netzwerkverbindung",
  strictOfflineNote: "Strikter Offlinemodus aktiv · keine Schriftdownloads; herunterladbare Schriften erscheinen als Ersatzschrift",
  waiting: "Wartet",
  sections: { search: "Suchergebnisse", video: "In diesem Video verwendet", recent: "Zuletzt verwendet", all: "Alle Schriften" } as Record<
    'search' | 'video' | 'recent' | 'all',
    string
  >,
  cancelled: "Abgebrochen",
  downloadFailed: "Download fehlgeschlagen",
  pickToast: (family: string, fallback: string) => `„${family}“ wird dargestellt in „${fallback}“, bis Download abgeschlossen; dann automatisch gewechselt`,
  alreadyDownloaded: (family: string) => `„${family}“ ist bereits heruntergeladen`,
  detail: { status: "Status", source: "Quelle", category: "Kategorie", weights: "Schriftstärken", size: "Größe", licence: "Lizenz" },
  scriptJoin: (labels: readonly string[]) => labels.join(", "),
  withItalics: " (mit Kursiv)",
  downloadedSize: (size: string) => `${size} heruntergeladen`,
  unknownLicence: "Unbekannt (Schrift auf diesem Computer; Veröffentlichungsrechte selbst prüfen)",
  mirrorInvalid: "Keine gültige Adresse",
  mirrorHttps: "Nur Adressen mit https:// werden akzeptiert",
  mirrorCredentials: "Adresse darf keinen Benutzername oder Passwort enthalten",
  mirrorQuery: "Adresse darf keine Abfrageparameter oder # enthalten",
  italic: " kursiv",
  cleared: (removed: number, freed: string, kept: number) =>
    `Gelöscht: ${familiesN(removed)}; freigegeben: ${freed}${kept ? ` · ${kept} von Exporten verwendet: ${pluralForm('de', kept, { one: "wurde", other: "wurden" })} beibehalten` : ""}`,
  clearConfirm: (count: number, size: string, inUse: boolean) =>
    `Löschen: ${familiesN(count)}, ${size} insgesamt. Betroffene Videos zeigen Ersatzschriften, bis diese bei Bedarf erneut heruntergeladen werden.` +
    (inUse ? " Von nicht abgeschlossenen Exporten verwendete Schriften bleiben erhalten." : ""),
  barOff: (total: number) => `Dieses Video verwendet ${fontsN(total)}, die ${pluralForm('de', total, { one: "ist nicht", other: "sind nicht" })} heruntergeladen sind; Ersatzschrift wird angezeigt`,
  autoOff: "Automatischer Download ausgeschaltet",
  barRunning: "In diesem Video verwendete Schriften werden heruntergeladen",
  barReady: (total: number) => (pluralForm('de', total, { one: "Die Schrift dieses Videos ist bereit", other: `Alle ${total} Schriften dieses Videos sind bereit` })),
  barMissed: (n: number) => `${fontsN(n)} konnten nicht abgerufen werden; Ersatzschrift wird angezeigt`,
  skipped: "Übersprungen",
  notDownloaded: "Nicht heruntergeladen",

  quoteList: (names: readonly string[]) => new Intl.ListFormat(intlLocale(), { type: 'conjunction' }).format(names.map((n) => `„${n}“`)),
  exportPending: (names: string, n: number) =>
    `${names} ${pluralForm('de', n, { one: "ist", other: "sind" })} werden noch heruntergeladen · Export wartet auf ${pluralForm('de', n, { one: "sie", other: "sie" })} vor dem Rendern`,
  exportFailed: (names: string, fallbacks: string) => `${names} wurden nicht heruntergeladen · ${fallbacks} wird stattdessen im Export verwendet`,
  exportMissingAuto: (names: string, n: number) =>
    `${names} ${pluralForm('de', n, { one: "ist nicht", other: "sind nicht" })} noch nicht heruntergeladen · ${pluralForm('de', n, { one: "Wird", other: "Werden" })} bei Exportstart heruntergeladen; bei Fehler wird Ersatzschrift verwendet`,
  exportMissingOff: (names: string, n: number) =>
    `${names} ${pluralForm('de', n, { one: "ist nicht", other: "sind nicht" })} nicht heruntergeladen (automatischer Download aus) · Export verwendet Ersatzschrift`,
  actionRetry: "Erneut versuchen",
  actionDownloadNow: "Jetzt herunterladen",
  actionDownload: "Herunterladen",
  exportFallback: (family: string, fallback: string, reason: string) => `„${family}“ ersetzt durch „${fallback}“ · ${reason}`,
  exportFallbackSeparator: "; ",
  exportPhase: (detail: string | null) => (detail ? `Schriften werden heruntergeladen · ${detail}` : "Schriften werden heruntergeladen"),
  systemFont: "Systemschrift",
  errorFallback: "Die Operation wurde nicht abgeschlossen",
  removed: (family: string) => `Heruntergeladene Dateien gelöscht für „${family}“`,
  removeInUse: (family: string) => `Ein nicht abgeschlossener Export verwendet „${family}“ · nach Abschluss des Exports löschen`,
};
