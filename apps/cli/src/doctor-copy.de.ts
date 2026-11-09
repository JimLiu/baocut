import type { DoctorMessages } from './doctor-copy.ts';

export const de: DoctorMessages = {
  help: [
    'baocut doctor',
    '',
    'Warum BaoCut nicht startet oder etwas nicht lesen kann: welches baocut Terminals finden, welche Runtime die',
    'CLI starten würde und mit welchem Verzeichnis, ob der Anmeldedatenspeicher antwortet, und der',
    'Festplattenvollzugriff unter macOS. Jede Prüfung ist ok, warn, fail oder skip, mit einem Befehl zur Behebung,',
    'wo es einen gibt; next ist die Behebung des ersten Problems. Nur lesend: startet nie eine Runtime und liest',
    'nie einen Schlüssel (die Prüfung des Schlüsselbunds fragt nur, ob ein erfundener Schlüssel existiert). Fragen',
    'Sie den Benutzer, bevor Sie die Behebungen ausführen.',
    'Aus einem Repository-Checkout führt er außerdem den Selbsttest der Runtime aus, der jedes native Programm einmal startet und die Builds mit dem Quellcode vergleicht.',
    '',
    'Flags: --json',
  ].join('\n'),
  checkName: {
    entry: 'Befehlszeile',
    runtime: 'Runtime',
    credentials: 'Anmeldedaten',
    fullDiskAccess: 'Festplattenvollzugriff',
    build: 'Build',
  },
  remedyLabel: 'Behebung',

  entryApp: (found, version) => `Terminals verwenden ${found}, die Befehlszeile der BaoCut-App${version ? ` ${version}` : ''}`,
  entryOtherApp: (found, target, app) =>
    `Terminals verwenden ${found} (${target}), nicht die Befehlszeile der BaoCut-App unter ${app}`,
  entryNoApp: (found, target) => `Terminals verwenden ${found} (${target}); keine BaoCut-App gefunden`,
  entryMissing: 'Terminals finden baocut nicht. Installieren Sie es aus der BaoCut-App (keine Administratorrechte nötig).',
  entryMissingNoApp: 'Terminals finden baocut nicht, und an den üblichen Orten wurde keine BaoCut-App gefunden',

  runtimeRunning: (version, pid, by) =>
    `Läuft: Version ${version}, Prozess ${pid}, gestartet von ${by === 'cli' ? 'der Befehlszeile' : 'der BaoCut-App'}`,
  runtimeStopped: (entry) => `Läuft nicht. Der nächste Befehl startet sie im Hintergrund mit ${entry}`,
  runtimeUnreachable: (pid, reason) => `Eine Runtime läuft (Prozess ${pid}), antwortet aber nicht: ${reason}`,
  runtimeNoLaunch:
    'Läuft nicht, und es gibt keine Runtime zum Starten: Installieren Sie die BaoCut-App, führen Sie den Befehl aus dem Repository aus oder setzen Sie BAOCUT_RUNTIME_ENTRY auf den Runtime-Einstiegspunkt.',

  credentialsFile: (file) => `Diese Version speichert Schlüssel in einer Datei: ${file}`,
  credentialsKeychain: (platform) =>
    platform === 'win32' ? 'Die Windows-Anmeldeinformationsverwaltung antwortet' : 'Der macOS-Schlüsselbund antwortet',
  credentialsDenied:
    'Der Schlüsselbund hat den Zugriff verweigert. Über SSH oder ohne Anmeldung am Desktop kann macOS ihn gesperrt halten: Führen Sie baocut in einem Terminal auf dem Desktop aus, oder entsperren Sie den Schlüsselbund „Anmeldung“.',
  credentialsNoHelper: (file) =>
    `Das Hilfsprogramm für Anmeldedaten fehlt${file ? ` (${file})` : ''}, daher lassen sich keine Schlüssel lesen. Installieren Sie die BaoCut-App neu.`,
  credentialsUnavailable: (reason) => `Der Anmeldedatenspeicher war nicht erreichbar: ${reason}`,
  credentialsUnknown: 'BAOCUT_RUNTIME_ENTRY bestimmt, wo Schlüssel liegen; nicht geprüft',
  credentialsTimedOut: (seconds) => `das Hilfsprogramm hat nicht innerhalb von ${seconds} s geantwortet`,

  fdaGranted: 'Festplattenvollzugriff ist aktiviert',
  fdaMissingApp:
    'Festplattenvollzugriff ist für BaoCut.app deaktiviert, daher sind Dateien an geschützten Orten (Schreibtisch, Dokumente, Downloads, andere Laufwerke) möglicherweise nicht lesbar. Aktivieren Sie BaoCut unter Systemeinstellungen › Datenschutz & Sicherheit › Festplattenvollzugriff und führen Sie dann baocut doctor erneut aus.',
  fdaMissingCli: (app) =>
    `Festplattenvollzugriff ist für die Runtime deaktiviert, die die Befehlszeile gestartet hat; macOS richtet sich dabei nach der Berechtigung von ${app ?? 'der App, die den Befehl ausgeführt hat (Ihrem Terminal oder der App, in der der Agent läuft)'}. Aktivieren Sie diese App unter Systemeinstellungen › Datenschutz & Sicherheit › Festplattenvollzugriff und öffnen Sie sie neu, oder beenden Sie diese Runtime (baocut runtime stop) und öffnen Sie die BaoCut-App; führen Sie danach baocut doctor erneut aus.`,
  fdaNotRunning: 'Wird nur geprüft, während eine Runtime läuft',
  buildOk: (count) => `Die nativen Programme starten, und die ${count} Builds passen zum Quellcode`,
  buildNotSource: 'Wird geprüft, wenn die Runtime aus einem Repository-Checkout läuft',
  buildFailed: (reason) => `Der Selbsttest der Runtime wurde nicht fertig: ${reason}`,
  buildTimedOut: (seconds) => `keine Antwort innerhalb von ${seconds} s`,
  buildProblems: (count, first) =>
    count === 1 ? `Der Selbsttest der Runtime hat ein Problem gefunden: ${first}` : `Der Selbsttest der Runtime hat ${count} Probleme gefunden, zuerst: ${first}`,
  buildMore: (first, more) => `${first} (und ${more} weitere)`,
};
