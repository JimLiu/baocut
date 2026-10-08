import type { JobsYtDlpMessages } from './yt-dlp.ts';

export const de: JobsYtDlpMessages = {
  toolNotFound: (p: { code: string }) => `Ausführbares yt-dlp nicht gefunden (${p.code})`,
  remedyUnsupported: "Das Downloadwerkzeug unterstützt diesen Link nicht: den Link zur Videoseite selbst verwenden (keine Wiedergabeliste, Livestream- oder Suchseite)",
  remedyLoginRequired: "Im Browser bei der Website anmelden, dann diesen Browser unter „Website-Anmeldung“ auswählen und erneut herunterladen",
  remedyCookiesUnavailable: "Browser-Cookies konnten nicht gelesen werden: Prüfen Sie, ob Sie im Browser angemeldet sind; bei belegter Datenbank den Browser vollständig beenden (einschließlich Hintergrundprozessen); bei verweigertem Schlüsselbundzugriff diesen erlauben; Safari benötigt Vollzugriff auf die Festplatte; unter Windows kann yt-dlp keine Cookies lesen, die Chrome, Edge oder Brave mit appgebundener Verschlüsselung schützen, daher Firefox verwenden; oder einen anderen Browser versuchen",
  remedyToolUpdateRequired: "Die Website konnte nicht ausgewertet werden oder das Werkzeug ist veraltet: yt-dlp aktualisieren, erneut erkennen und erneut versuchen",
  remedyUnavailable: "Das Video ist nicht verfügbar (gelöscht, regional beschränkt oder ohne herunterladbares Format)",
  remedyNetworkError: "Keine Verbindung möglich oder Download unterbrochen: Netzwerk prüfen und erneut versuchen (heruntergeladene Teile werden fortgesetzt)",
  remedyDiskFull: "Nicht genug Speicherplatz für den Downloadordner oder Runtime Home: Speicher freigeben und erneut versuchen",
  remedyDownloadFailed: "Das Downloadwerkzeug hat einen Fehler gemeldet: details.stderr prüfen; möglicherweise muss yt-dlp aktualisiert werden (baocut external-tools detect)",
  exited: (p: { code: number | null }) => `yt-dlp wurde beendet mit ${p.code}`,
  cookieLoginRequired: (p: { browser: string }) => `${p.browser}: die Website erfordert weiterhin eine Anmeldung`,
  cookieUnreadable: (p: { browser: string }) => `${p.browser}: Cookies konnten nicht gelesen werden`,
  reasonSeparator: "; ",
  cookieAttemptsFailed: (p: { count: number; reasons: string }) => `Cookies wurden versucht aus ${p.count} Browsern, keine funktionierten (${p.reasons})`,
  metadataUnreadable: "Metadaten des Downloadwerkzeugs konnten nicht gelesen werden",
  metadataNotObject: "Die Metadaten des Downloadwerkzeugs sind kein Objekt",
  playlist: "Der Link ist eine Wiedergabeliste; jeweils ein Video importieren",
  live: "Livestreams können nicht importiert werden",
};
