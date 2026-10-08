const andList = (names: readonly string[]) => new Intl.ListFormat('de', { type: 'conjunction' }).format(names);
import type { LinkCookiesMessages } from './link-cookies.ts';

export const de: LinkCookiesMessages = {
  noneChecked: "Für anonymen Download keine Browser auswählen. Bei Anmelde- oder Prüfbedarf zuerst im Browser anmelden und diesen auswählen.",
  oneChecked: (name: string) => `Verwendet ${name}-Cookies für Websitezugriff.`,
  manyChecked: (names: readonly string[]) =>
    `Versucht ${names.join(" → ")} in dieser Reihenfolge: Bei unlesbaren Cookies oder weiterem Anmeldebedarf nächster Browser; endet beim ersten erfolgreichen. Ergebnis nennt den verwendeten Browser.`,
  privacy: "Nur ausgewählte Browser werden gelesen. yt-dlp verwendet Cookies dieses Computers nur für Websitezugriff; BaoCut merkt sich nur Browsernamen, niemals Cookies.",
  keychain: (names: readonly string[]) =>
    `macOS fragt einmal nach Schlüsselbundzugriff für ${names.length > 1 ? `jeden von ${andList(names)}` : names[0]}. „Immer erlauben“ wählen, um weitere Rückfragen zu vermeiden.`,
  safariAccess: "Für Safari-Cookies zuerst BaoCut unter Systemeinstellungen › Datenschutz & Sicherheit › Festplattenvollzugriff erlauben.",
  chromiumLocked: (names: readonly string[]) =>
    names.length > 1
      ? `Solange ${andList(names)} geöffnet sind, sind Cookie-Datenbanken gesperrt und nicht lesbar. Vor Download vollständig beenden, einschließlich Hintergrundprozessen.`
      : `Solange ${names[0]} geöffnet ist, ist die Cookie-Datenbank gesperrt und nicht lesbar. Vor Download vollständig beenden, auch Hintergrundprozesse.`,
  appBound: (names: readonly string[]) =>
    `Unter Windows ${andList(names)} meist ${names.length > 1 ? "schützen" : "schützt"} Cookies mit appgebundener Verschlüsselung; yt-dlp kann sie möglicherweise auch nach Browserbeendigung nicht lesen.`,

  firefoxTip: " Bei Anmeldebedarf in Firefox anmelden und stattdessen Firefox auswählen.",
  noBrowsers: "Keine Browser-Cookies auf diesem Computer gefunden; nur anonyme Downloads möglich. Nach Websiteanmeldung im Browser auf „Browser erneut erkennen“ klicken.",
  used: (name: string) => `Verwendet: ${name}-Cookies`,
};
