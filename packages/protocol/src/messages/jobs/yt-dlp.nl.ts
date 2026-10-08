import type { JobsYtDlpMessages } from './yt-dlp.ts';

export const nl: JobsYtDlpMessages = {
  toolNotFound: (p: { code: string }) => `Kan geen uitvoerbare yt-dlp vinden (${p.code})`,
  remedyUnsupported: "De downloadtool ondersteunt deze link niet: gebruik de link naar de videopagina zelf (geen afspeellijst, livestream of zoekpagina)",
  remedyLoginRequired: "Log in op de website in je browser, selecteer daarna die browser bij ‘Website-inlog’ en download opnieuw",
  remedyCookiesUnavailable: "Kan browsercookies niet lezen: controleer of je bent ingelogd in de browser; sluit de browser volledig af (inclusief achtergrondprocessen) als de database in gebruik is; sta sleutelhangergebruik toe als toegang is geweigerd; Safari vereist Volledige schijftoegang; op Windows kan yt-dlp geen cookies lezen die Chrome, Edge of Brave beschermen met appgebonden versleuteling, dus gebruik Firefox; of probeer een andere browser",
  remedyToolUpdateRequired: "De website kan niet worden verwerkt of de tool is verouderd: werk yt-dlp bij, detecteer die opnieuw en probeer het opnieuw",
  remedyUnavailable: "De video is niet beschikbaar (verwijderd, regiobeperking of geen downloadbaar formaat)",
  remedyNetworkError: "Kan niet verbinden of de download is onderbroken: controleer het netwerk en probeer het opnieuw (gedownloade delen worden hervat)",
  remedyDiskFull: "Niet genoeg schijfruimte voor de downloadmap of Runtime Home: maak ruimte vrij en probeer het opnieuw",
  remedyDownloadFailed: "De downloadtool heeft een fout gemeld: zie details.stderr; mogelijk moet je yt-dlp bijwerken (baocut external-tools detect)",
  exited: (p: { code: number | null }) => `yt-dlp is afgesloten met ${p.code}`,
  cookieLoginRequired: (p: { browser: string }) => `${p.browser}: de website vereist nog steeds inloggen`,
  cookieUnreadable: (p: { browser: string }) => `${p.browser}: kan cookies niet lezen`,
  reasonSeparator: "; ",
  cookieAttemptsFailed: (p: { count: number; reasons: string }) => `Cookies geprobeerd uit ${p.count} browsers, geen werkten (${p.reasons})`,
  metadataUnreadable: "Kan de metadata van de downloadtool niet lezen",
  metadataNotObject: "De metadata van de downloadtool zijn geen object",
  playlist: "De link is een afspeellijst; importeer één video tegelijk",
  live: "Livestreams kunnen niet worden geïmporteerd",
};
