import type { StandaloneMessages } from './standalone-copy.ts';

export const nl: StandaloneMessages = {
  cliHelp: `Gebruik:
  baocut cli install               Installeert dit opdrachtregelpakket voor je gebruiker en zet baocut in PATH. Het pakket
                                   wordt gekopieerd naar ~/.local/share/baocut/versions/<versie> (Windows:
                                   %LOCALAPPDATA%\\BaoCut\\cli\\versions\\<versie>), tenzij het daar al staat. macOS: een
                                   link op ~/.local/bin/baocut. Windows: %LOCALAPPDATA%\\BaoCut\\bin\\baocut.cmd, met die
                                   map toegevoegd aan je gebruikers-PATH. Geen beheerdersrechten nodig
  baocut cli status                Waar baocut staat, naar welke geïnstalleerde versie het verwijst en welke baocut je
                                   terminal vindt
  baocut cli remove                Verwijdert wat baocut cli install heeft neergezet; de geïnstalleerde versies blijven.
                                   Iets op die plek dat BaoCut er niet heeft neergezet, wordt nooit vervangen of verwijderd`,
  help: `baocut update [--check | --rollback]

Werkt het zelfstandige opdrachtregelpakket bij: leest dezelfde releasefeed als de BaoCut-app, downloadt het
opdrachtregelpakket van de nieuwste release, controleert de grootte en sha256 (en op macOS de handtekening en
notarisatie), installeert het naast de huidige versie en laat baocut ernaar verwijzen. De vorige versie blijft bewaard
voor --rollback; oudere versies die geen Runtime meer gebruikt, worden verwijderd.
  --check      Alleen melden of er een nieuwere versie beschikbaar is
  --rollback   Teruggaan naar de vorige versie
Een Runtime die al draait, houdt de oude versie tot hij stopt (baocut runtime stop).
Alleen het zelfstandige pakket wordt zo bijgewerkt: de BaoCut-app werkt zichzelf bij, Homebrew via brew upgrade.
Stel BAOCUT_UPDATE_APPCAST in om een andere feed te lezen (een URL of een lokaal bestand, om te testen).`,
  version: (version, build) => `${version} (Build ${build})`,
  state: {
    none: 'Niet geïnstalleerd',
    current: 'Verwijst naar de huidige versie',
    stale: 'Verwijst naar een andere BaoCut',
    broken: 'Verwijst naar een plek die niet meer bestaat',
    foreign: 'Er staat iets anders (niet aangeraakt)',
  },
  statusPackage: (version, root) => `Pakket    ${version}  ${root}`,
  statusVersions: (versions, root) => `Versies   ${versions.join(', ')}  ${root}`,
  statusNoVersions: (root) => `Nog niets geïnstalleerd in ${root}: baocut cli install kopieert dit pakket daarheen`,
  currentMark: ' (huidige)',
  previousMark: ' (vorige)',
  copied: (dest, from) => `Pakket gekopieerd naar ${dest}; ${from} is niet meer nodig`,
  versionsKept: (dir) => `De geïnstalleerde versies blijven in ${dir}: verwijder die map om ze te verwijderen`,
  entryTaken: (path) =>
    `${path} is niet door BaoCut neergezet en blijft daarom ongemoeid. Verplaats of verwijder het zelf en voer daarna baocut cli install opnieuw uit`,
  pathFailed: (dir) => `Kon ${dir} niet aan je gebruikers-PATH toevoegen: voeg het toe via Systeemeigenschappen → Omgevingsvariabelen`,
  copyFailed: (from, dest, detail) => `Kon ${from} niet kopiëren naar ${dest}${detail ? `: ${detail}` : ''}`,
  updateUsage: (token) => `baocut update accepteert --check of --rollback (één van beide): ${token}`,
  updateUnavailable:
    'baocut update werkt het zelfstandige opdrachtregelpakket bij. Deze baocut hoort bij de BaoCut-app, die zichzelf bijwerkt (BaoCut → Op updates controleren), of bij Homebrew (brew upgrade --cask baocut)',
  upToDate: (current) => `Actueel: ${current}`,
  available: (latest, current) => `${latest} is beschikbaar (je hebt ${current})`,
  downloading: (version, build, megabytes) => `${version} (Build ${build}) downloaden, ${megabytes} MB…`,
  updated: (from, to) => `Bijgewerkt: ${from} → ${to}`,
  rolledBack: (from, to) => `Teruggegaan van ${from} naar ${to}`,
  rollbackHint: 'Teruggaan: baocut update --rollback',
  entrySwitched: (path) => `${path} verwijst er nu naar`,
  entryNotInstalled: (path) => `${path} is niet geïnstalleerd: baocut cli install zet baocut in PATH`,
  entryLeftAlone: (path) =>
    `${path} verwijst naar iets anders dan dit pakket en is ongemoeid gelaten: baocut cli install laat het hierheen verwijzen`,
  removedVersions: (versions) => `Oudere versies verwijderd: ${versions.join(', ')}`,
  runtimeStillRunning: (pid) =>
    `Een Runtime (pid ${pid}) draait nog met de versie waarmee hij is gestart; zodra hij stopt, start de volgende opdracht de nieuwe (baocut runtime stop stopt hem nu)`,
  systemTooOld: (required, system) => `De nieuwe versie vereist macOS ${required}; deze Mac heeft ${system}`,
  feedFailed: (url, detail) => `Kon de releasefeed ${url} niet lezen: ${detail}`,
  feedMissing: (url) => `De releasefeed ${url} heeft nog geen opdrachtregelpakket: probeer het opnieuw na de volgende release`,
  downloadFailed: (url, detail) => `Kon ${url} niet downloaden: ${detail}`,
  verifyFailed: (detail) => `Het gedownloade pakket heeft de controles niet doorstaan en is niet geïnstalleerd: ${detail}`,
  unsignedBuild:
    'Dit pakket is niet ondertekend en kan daarom de handtekening van een update niet controleren. Download in plaats daarvan het zelfstandige pakket van de releasepagina van BaoCut',
  noPrevious: (dir) => `Er is geen vorige versie in ${dir} om naar terug te gaan`,
  inProgress: (pid) => `Er draait al een andere baocut update (pid ${pid}): wacht tot die klaar is`,
};
