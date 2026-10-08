import type { SettingKey } from './settings.ts';
import { LOCALES } from './i18n.ts';
import type { SettingDescriptionMessages } from './settings-copy.ts';

export const de: SettingDescriptionMessages = {
  'agent.defaultDriver': "Agent für neue Sitzungen; null verwendet den integrierten Standard (codex). Wird beim Erstellen einer Sitzung festgelegt",
  'agent.defaultModel': "Modell für neue Sitzungen; null verwendet das empfohlene Modell (Sonnet für Claude Code, ein -sol-Modell für Codex), __agent-default__ übergibt kein Modell und folgt der CLI-Konfiguration des Agenten",
  'agent.defaultEffort': "Denkaufwand für neue Sitzungen; null verwendet den Standard des Agenten",
  'agent.defaultAccessMode':
    "Für Sitzungen, die ihren Zugriffsmodus noch nie geändert haben: ask, autoAcceptEdits, auto, fullAccess oder plan (alte Werte controlled und authorized gelten als ask und fullAccess)",
  'ui.language': `Oberflächensprache: system folgt der Systemsprache (Englisch bei keiner passenden Sprache) oder ein Sprachcode (${LOCALES.join(", ")}). Auch die an Menschen gerichteten Runtime-Texte verwenden sie`,
  'captions.maxLineLength': "Zielzeilenlänge für automatische Zeilenumbrüche (Zeichen): cjk für Chinesisch, Japanisch und Koreanisch, other für alles andere",
  'transcribe.afterComplete': "Nach der Transkription: open-video öffnet das Video, notify benachrichtigt nur, nothing tut nichts",
  'downloads.directory':
    "Standard-Speicherort für Werkzeugergebnisse ohne Video, über Links heruntergeladene Medien und Dateien von downloads_save (absoluter Pfad); null verwendet ~/Downloads auf diesem Host, unabhängig vom Projekt",
  'models.downloadEndpoint':
    "Downloadquelle für lokale Modelle (Spiegelserver-Basis-URL, http(s)://); null verwendet den öffentlichen Modell-Hub. BAOCUT_MODELS_ENDPOINT hat Vorrang",
  'models.dir':
    "Ordner für lokale Modelle (absoluter Pfad); null verwendet models im Datenordner. BAOCUT_MODELS_DIR hat Vorrang. Mit models.setDir ändern, nicht mit settings set",
  'tools.downloadEndpoint':
    "Downloadquelle für verwaltete externe Werkzeuge (yt-dlp) (Spiegelserver-Basis-URL, http(s)://, Dateien unter <base>/<tool>/<version>/<file>); null verwendet die offizielle Release-URL. BAOCUT_TOOLS_ENDPOINT hat Vorrang",
  'fonts.autoDownload':
    "Für Layout benötigte Schriften automatisch herunterladen, wenn sie auf diesem Computer fehlen und im Schriftkatalog stehen (Vorschau und Export); ausgeschaltet wird eine Ersatzschrift mit Hinweis verwendet",
  'fonts.cssEndpoint': "Basis-URL der Schrift-CSS-API (Spiegelserver, https://); null verwendet https://fonts.googleapis.com",
  'fonts.fileEndpoint': "Basis-URL für Schriftdateien (Spiegelserver, https://; Dateien werden nur darunter abgerufen); null verwendet https://fonts.gstatic.com",
  'space.trashRetentionDays':
    "Aufbewahrungstage für Einträge im Space-Papierkorb (1–3650): ältere nicht referenzierte Einträge und gelöschte Videos werden regelmäßig dauerhaft gelöscht",
  'cache.maxSizeMiB': 'Größenlimit für den Cache im Datenordner, in MiB (256–1048576): Wird es überschritten, werden die ältesten Cache-Dateien (Medienanalyse, Wiedergabekopien) gelöscht, bis 90 % erreicht sind. Der videoübergreifende Suchindex wird nie gelöscht',
  'resources.capacity':
    "Erweitert: Computerkapazität für Ressourcenplanung { memoryMiB, gpuMemoryMiB, cpuThreads }; null für einen Eintrag erkennt ihn automatisch; null erkennt alles (Speicher und CPU stammen vom System; GPU-Speicher bei Apple silicon wird aus gemeinsamem Speicher geschätzt)",
  'runtime.idleExitMinutes':
    "Minuten, die eine von der CLI gestartete Runtime untätig bleibt, bevor sie sich beendet (1–1440): keine Verbindungen, Aufgaben oder offenen externen Dienste. Desktop-App und manuell gestartete Runtimes sind nicht betroffen",
  'updates.autoCheck': "Automatisch nach App-Updates suchen",
  'updates.autoDownload': "Neue Versionen im Hintergrund herunterladen (ohne automatische Installation)",
  'diagnostics.enabled': "Anonyme Nutzungsstatistiken und Leistungszusammenfassungen senden (keine Medien, Texte oder Pfade)",
  'offline.strict': "Strikter Offlinemodus: nichts an Onlinedienste senden",
} satisfies Record<SettingKey, string>;
