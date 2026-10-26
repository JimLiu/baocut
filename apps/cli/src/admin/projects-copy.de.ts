import type { ProjectsMessages } from './projects-copy.ts';

export const de: ProjectsMessages = {
  help: `Verwendung:
  baocut projects git-status [<Projekt>]
                                   Git-Status des Projekts: Repository, Branch, ob BaoCut committen kann
                                   und warum es pausiert ist (committen mit baocut projects git-commit)
  baocut projects git-init [<Projekt>]
                                   Git im Projektordner initialisieren (nicht im Benutzerordner, in einem Standard-
                                   Benutzerordner, im Stammverzeichnis eines Volumes oder in einem anderen Repository)
  baocut projects git-allow [<Projekt>] [--yes]
                                   Zeigt die Filter und Includes in der lokalen Konfiguration des Repositorys und erlaubt
                                   sie dann: erst danach führt BaoCut Git-Befehle aus, die sie ausführen
  baocut projects remove <Projekt> [--yes]
                                   Entfernt das Projekt aus BaoCut: Die Sitzungen werden gelöscht, der Ordner und
                                   seine Dateien bleiben auf der Festplatte (Ordner erneut öffnen, um es zurückzuholen)
  <Projekt> ist eine Projekt-ID, ein Name oder ein Ordner; ohne Angabe das Projekt, das den aktuellen Ordner enthält`,
  noProject: (cwd) => `Kein Projekt enthält ${cwd}. Gib eine Projekt-ID, einen Namen oder einen Ordner an (baocut projects list)`,
  unknownProject: (text) => `Projekt nicht gefunden: ${text} (baocut projects list)`,
  ambiguousProject: (text) => `Mehrere Projekte heißen ${text}; gib stattdessen die ID an`,
  states: {
    ready: 'bereit',
    paused: 'pausiert',
    'not-repo': 'nicht in einem Git-Repository',
    unavailable: 'Git nicht verfügbar',
    error: 'Fehler',
  },
  head: (name, id) => `Projekt ${name} (${id})`,
  state: (state) => `Git: ${state}`,
  branch: (branch) => `Branch: ${branch}`,
  detached: 'Branch: (losgelöster HEAD)',
  version: (version) => `Git-Version: ${version}`,
  repo: (root) => `Repository: ${root}`,
  autoCommit: (on) => `Automatisch committen: ${on ? 'an' : 'aus'}`,
  lastCommit: (commit, auto, at) => `Letzter Commit: ${commit.slice(0, 12)} (${auto ? 'automatisch' : 'manuell'}, ${at})`,
  lastError: (message) => `Letzter Fehler: ${message}`,
  entriesHead: 'Lokale Filter und Includes:',
  entry: (key, value, file) => `  ${key} = ${value}${file ? `  (${file})` : ''}`,
  allowHint: 'Prüfe sie und erlaube sie dann mit baocut projects git-allow',
  initDone: (root) => `Git in ${root} initialisiert`,
  nothingToAllow: 'Dieses Repository hat keine lokalen Filter oder Includes, die auf Erlaubnis warten',
  allowPrompt: 'Diese Einträge erlauben? BaoCut führt dann Git-Befehle aus, die sie ausführen [y/N] ',
  notTtyAllow: 'Nicht in einem Terminal: prüfe die Einträge mit baocut projects git-status und führe den Befehl dann mit --yes erneut aus',
  notAllowed: 'Nicht erlaubt: BaoCuts Commits bleiben für dieses Repository pausiert',
  allowed: 'Erlaubt: BaoCut committet wieder in dieses Repository',
  removeHead: (name, id, dir) => `Projekt ${name} (${id}): ${dir}`,
  removeMissing: 'Der Ordner ist nicht mehr vorhanden',
  removeEffect: (count) => `Beim Entfernen werden die ${count} Sitzung(en) darin gelöscht. Der Ordner mit Videos und Dateien bleibt auf der Festplatte`,
  removePrompt: 'Dieses Projekt aus BaoCut entfernen? [y/N] ',
  notTtyRemove: 'Kein Terminal: Projekt mit baocut projects list prüfen und dann mit --yes erneut ausführen',
  notRemoved: 'Nicht entfernt',
  removed: (name, count) => `${name} wurde aus BaoCut entfernt, ${count} Sitzung(en) gelöscht. Der Ordner ist unverändert: Öffnen Sie ihn erneut (oder führen Sie baocut projects create <Ordner> aus), um das Projekt zurückzuholen`,
};
