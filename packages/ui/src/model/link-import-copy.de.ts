import type { LinkIssueText } from './link-import-copy.ts';
const endSentence = (text: string): string => /[.!?。！？]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;
const joinSentences = (parts: readonly (string | null | undefined)[]): string => parts.filter((p): p is string => !!p?.trim()).map(endSentence).join(' ');
import type { JobRecord } from "@baocut/protocol";
import type { ExternalToolStatus } from "@baocut/protocol";
import type { LinkImportMessages } from './link-import-copy.ts';

export const de: LinkImportMessages = {
  title: (name: string | null) => (name ? `Import über Link · ${name}` : "Import über Link"),

  phase: {
    starting: "Wird vorbereitet",
    probing: "Link wird gelesen",
    downloading: "Video wird heruntergeladen",
    validating: "Abspielbarkeit wird geprüft",
    publishing: "Wird in Downloadordner verschoben",
    applying: "Video wird importiert",
    transcribing: "Transkription wird gestartet",
  } as Partial<Record<JobRecord['phase'], string>>,
  phaseFallback: "Verarbeitung",
  downloaded: (bytes: string) => `${bytes} heruntergeladen`,

  stageDownload: "Video herunterladen",
  stageVideo: "Medien prüfen und Video erstellen",
  stageSubs: "Untertitel erzeugen",

  issue: {
    TOOL_NOT_INSTALLED: {
      title: "Einmal einrichten, dann nur einfügen",
      body: "BaoCut benötigt yt-dlp zum Lesen dieser Website. Installieren, dann diesen Import erneut starten.",
    },
    TOOL_CONSENT_REQUIRED: {
      title: "Einwilligung zur Nutzung des Downloadwerkzeugs erforderlich",
      body: "Downloadwerkzeug bereits vorhanden. BaoCut lädt Websitevideos damit nur nach Ihrer Zustimmung herunter.",
    },
    TOOL_UNAVAILABLE: {
      title: "Downloadwerkzeug nicht ausführbar",
      body: "Downloadwerkzeug gefunden, aber nicht ausführbar. Erneut installieren oder eine funktionierende Kopie auswählen.",
    },
    TOOL_OUTDATED: {
      title: "Downloadwerkzeug benötigt Aktualisierung",
      body: "Diese Version ist zu alt und kann die Website möglicherweise nicht lesen. Aktualisieren und erneut versuchen.",
    },
    OFFLINE_STRICT: {
      title: "Keine Linkdownloads im strikten Offlinemodus",
      body: "Im strikten Offlinemodus geht BaoCut nicht online. Video zuerst im Browser herunterladen, dann lokale Datei auswählen.",
    },
    LINK_UNSUPPORTED: {
      title: "Diese Quelle wird noch nicht unterstützt",
      body: "Downloadwerkzeug erkennt Website oder Seite nicht. Direkte Videoseite verwenden (keine Wiedergabeliste, Livestream- oder Suchseite) oder lokale Datei.",
    },
    LINK_LOGIN_REQUIRED: {
      title: "Dieses Video benötigt Anmeldung",
      body: "Zuerst im Browser auf der Website anmelden. Unter Video herunterladen diesen Browser bei „Website-Anmeldung“ auswählen und erneut herunterladen.",
    },
    LINK_COOKIES_UNAVAILABLE: {
      title: "Browser-Cookies konnten nicht gelesen werden",
      body: "Browseranmeldung prüfen. Bei gesperrter Datenbank Browser vollständig beenden, auch Hintergrundprozesse; Schlüsselbundberechtigungen prüfen (für Safari BaoCut Festplattenvollzugriff erlauben). Unter Windows sind appgebunden verschlüsselte Chrome-, Edge- und Brave-Cookies nicht lesbar; Firefox wählen. Oder anderen Browser auswählen und erneut herunterladen.",
    },
    LINK_TOOL_UPDATE_REQUIRED: {
      title: "yt-dlp benötigt Aktualisierung",
      body: "Die Website hat ihre Videobereitstellung geändert. yt-dlp nach Installationsart aktualisieren, erneut prüfen und versuchen.",
    },
    LINK_UNAVAILABLE: {
      title: "Dieses Video ist nicht verfügbar",
      body: "Möglicherweise entfernt, regional beschränkt oder ohne Downloadformat. Anderen Link oder lokale Datei verwenden.",
    },
    LINK_NETWORK_ERROR: {
      title: "Verbindung unterbrochen",
      body: "Netzwerk prüfen und erneut versuchen; heruntergeladene Teile werden fortgesetzt.",
    },
    LINK_DISK_FULL: {
      title: "Nicht genug Speicherplatz",
      body: "Festplatte mit Downloadordner voll. Speicher freigeben und erneut versuchen.",
    },
    LINK_DOWNLOAD_FAILED: {
      title: "Downloadwerkzeug hat einen Fehler gemeldet",
      body: "Website möglicherweise geändert oder vorübergehend begrenzt. Zuerst erneut versuchen; bei weiterem Fehler Aktualisierungsbedarf prüfen oder lokale Datei verwenden.",
    },
    LINK_DOWNLOAD_UNREADABLE: {
      title: "Heruntergeladene Datei nicht verwendbar",
      body: "Datei unvollständig, ohne Audiospur oder nicht decodierbar; möglicherweise lieferte die Website einen Platzhalter. Erneut herunterladen oder anderen Link bzw. lokale Datei verwenden.",
    },
    LINK_DESTINATION_UNAVAILABLE: {
      title: "Downloadordner nicht beschreibbar",
      body: "Existenz und Schreibberechtigung des Downloadordners prüfen; anderen Ordner wählen und Import erneut starten.",
    },
    MEDIA_TOOL_UNAVAILABLE: {
      title: "Heruntergeladene Datei kann nicht geprüft werden",
      body: "Medienprüfung benötigt ffprobe (mit ffmpeg), das fehlt. ffmpeg installieren und erneut versuchen.",
    },
    LINK_SOURCE_EXPIRED: {
      title: "Ursprünglicher Link nicht mehr vorhanden",
      body: "Nach Neustart behält Runtime nur den bereinigten Link, nicht den vollständigen. Link zum erneuten Import einfügen.",
    },
    INTERRUPTED: {
      title: "Import unterbrochen",
      body: "Runtime vor Abschluss gestoppt oder neu gestartet. Erneuter Versuch setzt am gestoppten Schritt fort.",
    },
  } as Readonly<Record<string, LinkIssueText>>,
  issueUnknownTitle: "Import nicht abgeschlossen",
  issueUnknownBody: (message: string | null, remedy: string | null) => joinSentences([message, remedy]) || "Ein Fehler ist aufgetreten.",

  headingStopped: "Import gestoppt",
  headingFailed: "Import nicht abgeschlossen",
  headingRunning: "Dieser Link wird in ein bearbeitbares Video umgewandelt",
  headingDownloaded: "Video heruntergeladen",
  headingVideoFailed: "Datei heruntergeladen; Video nicht erstellt",
  headingCreatingVideo: "Datei heruntergeladen; Video wird erstellt",
  headingTranscribing: "Video bereit; Untertitel werden erzeugt",
  headingTranscribeFailed: "Video bereit; Transkription erfordert Aufmerksamkeit",
  headingReady: "Video bereit",
  headingSubsReady: "Untertitel bereit",

  toolSource: {
    system: "Im System installiert",
    user: "Von dir gewählt",
    managed: "Von BaoCut heruntergeladen",
    env: "Durch Umgebungsvariable festgelegt",
  } as Record<NonNullable<ExternalToolStatus['source']>, string>,
  factVersion: (version: string, size: string | null) => (size ? `Version ${version} · etwa ${size}` : `Version ${version}`),
  factFrom: (host: string) => `Heruntergeladen von ${host}`,
  factLicense: (license: string) => `${license}-Lizenz`,
  factIsolated: "In BaoCuts eigenem Ordner; Ausführung erst nach Prüfsummenprüfung. System unverändert",
  factInstalledWith: (method: string) => `Installiert mit ${method}`,

  cardChecking: "Downloadwerkzeug wird geprüft…",
  cardCheckingBody: "Prüft nur lokale Version; keine Internetverbindung.",
  cardUnknown: "Downloadwerkzeug nicht registriert",
  cardUnknownBody: "Diese Runtime kennt yt-dlp nicht; Linkimport derzeit nicht verfügbar.",
  cardInstalling: "Downloadwerkzeug wird vorbereitet…",
  cardInstallingBody: "Herunterladen → prüfen → Testausführung. Nach Abschluss steht „Bereit“.",
  cardUpdating: "Downloadwerkzeug wird aktualisiert…",
  cardUpdatingBody: "Ausgabe unter dem Befehl; nach Abschluss erneute Versionsprüfung.",
  cardBlockedWhy: "BaoCut kann es auf diesem Computer nicht herunterladen.",
  cardMissing: "Downloadwerkzeug nicht installiert",
  cardMissingBody: (why: string) => `${endSentence(why)} yt-dlp manuell installieren und dann „Erneut prüfen“ oder Speicherort auswählen.`,
  cardInstall: "Einmal einrichten, dann nur einfügen",
  cardInstallBody: "BaoCut benötigt yt-dlp für Videowebsites. Nach Zustimmung wird es heruntergeladen und Ihre Einwilligung gespeichert; Linkimporte fragen nicht erneut.",
  cardInstallAction: "Zustimmen und installieren",
  cardOutdatedReason: (reason: string | null, version: string | null, minVersion: string | null) =>
    endSentence(reason ?? `Version ${version ?? "unbekannt"} ist älter als erforderliche Version ${minVersion ?? ""}`),
  cardOutdated: "Downloadwerkzeug benötigt Aktualisierung",
  cardOutdatedBlocked: (reason: string, why: string) => `${reason} ${why}`,
  cardOutdatedRunnable: "Nicht von BaoCut heruntergeladen; mit folgendem Befehl nach Installationsart aktualisieren.",
  cardOutdatedManual: "Nicht von BaoCut heruntergeladen. Nach folgender Anleitung im Terminal aktualisieren, dann „Erneut prüfen“ wählen.",
  cardOutdatedUpdate: (reason: string) => `${reason} Vor Start aktualisieren.`,
  cardUpdateAction: "Zustimmen und aktualisieren",
  cardBroken: "Downloadwerkzeug nicht ausführbar",
  cardBrokenBody: (reason: string | null, remedy: string | null) => joinSentences([reason, remedy]) || "Gefunden, aber nicht ausführbar.",
  cardReinstallAction: "Zustimmen und neu installieren",
  cardConsentRevoked: "Einwilligung für das Downloadwerkzeug zurückgezogen",
  cardConsent: "Einwilligung zur Nutzung des Downloadwerkzeugs erforderlich",
  cardConsentBody: "BaoCut lädt damit Websitevideos nur nach Zustimmung herunter. Runtime speichert die Einwilligung; Linkimporte fragen nicht erneut.",
  cardConsentAction: "Zustimmen und verwenden",
  cardReady: "Downloadwerkzeug bereit",
  cardReadyBody: "Beim Start prüft BaoCut zuerst den Link und holt Videoinformationen; anschließend Download.",
};
