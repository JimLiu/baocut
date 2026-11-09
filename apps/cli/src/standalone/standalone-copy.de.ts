import type { StandaloneMessages } from './standalone-copy.ts';

export const de: StandaloneMessages = {
  cliHelp: `Verwendung:
  baocut cli install               Installiert dieses Befehlszeilenpaket für deinen Benutzer und bringt baocut in den PATH.
                                   Das Paket wird nach ~/.local/share/baocut/versions/<Version> kopiert (Windows:
                                   %LOCALAPPDATA%\\BaoCut\\cli\\versions\\<Version>), sofern es nicht schon dort liegt.
                                   macOS: ein Link unter ~/.local/bin/baocut. Windows: %LOCALAPPDATA%\\BaoCut\\bin\\baocut.cmd,
                                   der Ordner wird zum PATH deines Benutzers hinzugefügt. Keine Administratorrechte nötig
  baocut cli status                Wo baocut liegt, auf welche installierte Version es zeigt und welches baocut dein
                                   Terminal findet
  baocut cli remove                Entfernt, was baocut cli install angelegt hat; die installierten Versionen bleiben. Was
                                   dort liegt und nicht von BaoCut stammt, wird nie ersetzt oder gelöscht`,
  help: `baocut update [--check | --rollback]

Aktualisiert das eigenständige Befehlszeilenpaket: liest denselben Update-Feed wie die BaoCut-App, lädt das
Befehlszeilenpaket der neuesten Version herunter, prüft Größe und sha256 (unter macOS auch Signatur und Notarisierung),
installiert es neben der aktuellen Version und lässt baocut darauf zeigen. Die vorherige Version bleibt für --rollback
erhalten; ältere, die keine Runtime mehr verwendet, werden gelöscht.
  --check      Nur anzeigen, ob eine neuere Version verfügbar ist
  --rollback   Zur vorherigen Version zurückkehren
Eine bereits laufende Runtime behält die alte Version, bis sie beendet wird (baocut runtime stop).
Nur das eigenständige Paket wird so aktualisiert: Die BaoCut-App aktualisiert sich selbst, Homebrew-Installationen mit brew upgrade.
Setze BAOCUT_UPDATE_APPCAST, um einen anderen Feed zu lesen (eine URL oder eine lokale Datei, zum Testen).`,
  version: (version, build) => `${version} (Build ${build})`,
  state: {
    none: 'Nicht installiert',
    current: 'Zeigt auf die aktuelle Version',
    stale: 'Zeigt auf ein anderes BaoCut',
    broken: 'Zeigt auf einen Ort, den es nicht mehr gibt',
    foreign: 'Etwas anderes liegt dort (unberührt)',
  },
  statusPackage: (version, root) => `Paket     ${version}  ${root}`,
  statusVersions: (versions, root) => `Versionen ${versions.join(', ')}  ${root}`,
  statusNoVersions: (root) => `In ${root} ist noch nichts installiert: baocut cli install kopiert dieses Paket dorthin`,
  currentMark: ' (aktuell)',
  previousMark: ' (vorherige)',
  copied: (dest, from) => `Paket nach ${dest} kopiert; ${from} wird nicht mehr gebraucht`,
  versionsKept: (dir) => `Die installierten Versionen bleiben in ${dir}: Lösche diesen Ordner, um sie zu entfernen`,
  entryTaken: (path) =>
    `${path} stammt nicht von BaoCut und bleibt daher unberührt. Verschiebe oder lösche es selbst und führe dann baocut cli install erneut aus`,
  pathFailed: (dir) =>
    `${dir} konnte nicht zum PATH deines Benutzers hinzugefügt werden: Füge den Ordner unter Systemeigenschaften → Umgebungsvariablen hinzu`,
  copyFailed: (from, dest, detail) => `${from} konnte nicht nach ${dest} kopiert werden${detail ? `: ${detail}` : ''}`,
  updateUsage: (token) => `baocut update erwartet --check oder --rollback (eines davon): ${token}`,
  updateUnavailable:
    'baocut update aktualisiert das eigenständige Befehlszeilenpaket. Dieses baocut gehört zur BaoCut-App, die sich selbst aktualisiert (BaoCut → Nach Aktualisierungen suchen), oder zu Homebrew (brew upgrade --cask baocut)',
  upToDate: (current) => `Aktuell: ${current}`,
  available: (latest, current) => `${latest} ist verfügbar (du hast ${current})`,
  downloading: (version, build, megabytes) => `Lade ${version} (Build ${build}) herunter, ${megabytes} MB…`,
  updated: (from, to) => `Aktualisiert: ${from} → ${to}`,
  rolledBack: (from, to) => `Von ${from} zurück zu ${to}`,
  rollbackHint: 'Zurück zur vorherigen Version: baocut update --rollback',
  entrySwitched: (path) => `${path} zeigt jetzt darauf`,
  entryNotInstalled: (path) => `${path} ist nicht installiert: baocut cli install bringt baocut in den PATH`,
  entryLeftAlone: (path) =>
    `${path} zeigt auf etwas anderes als dieses Paket und bleibt unberührt: baocut cli install lässt es hierher zeigen`,
  removedVersions: (versions) => `Ältere Versionen gelöscht: ${versions.join(', ')}`,
  runtimeStillRunning: (pid) =>
    `Eine Runtime (pid ${pid}) läuft noch mit der Version, mit der sie gestartet wurde; sobald sie beendet ist, startet der nächste Befehl die neue (baocut runtime stop beendet sie sofort)`,
  systemTooOld: (required, system) => `Die neue Version braucht macOS ${required}; auf diesem Mac läuft ${system}`,
  feedFailed: (url, detail) => `Der Update-Feed ${url} konnte nicht gelesen werden: ${detail}`,
  feedMissing: (url) =>
    `Der Update-Feed ${url} enthält noch kein Befehlszeilenpaket: Versuche es nach dem nächsten Release erneut`,
  downloadFailed: (url, detail) => `${url} konnte nicht heruntergeladen werden: ${detail}`,
  verifyFailed: (detail) => `Das heruntergeladene Paket hat die Prüfungen nicht bestanden und wurde nicht installiert: ${detail}`,
  unsignedBuild:
    'Dieses Paket ist nicht signiert und kann daher die Signatur eines Updates nicht prüfen. Lade das eigenständige Paket stattdessen von der Release-Seite von BaoCut herunter',
  noPrevious: (dir) => `In ${dir} gibt es keine vorherige Version, zu der du zurückkehren kannst`,
  inProgress: (pid) => `Ein anderes baocut update (pid ${pid}) läuft gerade: Warte, bis es fertig ist`,
};
