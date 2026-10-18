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
};
