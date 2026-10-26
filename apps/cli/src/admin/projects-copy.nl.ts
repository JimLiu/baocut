import type { ProjectsMessages } from './projects-copy.ts';

export const nl: ProjectsMessages = {
  help: `Gebruik:
  baocut projects git-status [<project>]
                                   De git-status van het project: repository, branch, of BaoCut kan committen
                                   en waarom het gepauzeerd is (committen met baocut projects git-commit)
  baocut projects git-init [<project>]
                                   Git initialiseren in de projectmap (niet in je thuismap, een standaard
                                   gebruikersmap, de hoofdmap van een volume of binnen een andere repository)
  baocut projects git-allow [<project>] [--yes]
                                   Toont de filters en includes in de lokale configuratie van de repository en staat
                                   ze daarna toe: pas dan voert BaoCut git-opdrachten uit die ze uitvoeren
  baocut projects remove <project> [--yes]
                                   Verwijdert het project uit BaoCut: de sessies worden verwijderd; de map en
                                   de bestanden blijven op schijf (open de map opnieuw om het terug te halen)
  <project> is een project-ID, naam of map; zonder, het project dat de huidige map bevat`,
  noProject: (cwd) => `Geen project bevat ${cwd}. Geef een project-ID, naam of map op (baocut projects list)`,
  unknownProject: (text) => `Project niet gevonden: ${text} (baocut projects list)`,
  ambiguousProject: (text) => `Er zijn meerdere projecten met de naam ${text}; geef het ID op`,
  states: {
    ready: 'gereed',
    paused: 'gepauzeerd',
    'not-repo': 'niet in een git-repository',
    unavailable: 'git niet beschikbaar',
    error: 'fout',
  },
  head: (name, id) => `Project ${name} (${id})`,
  state: (state) => `Git: ${state}`,
  branch: (branch) => `Branch: ${branch}`,
  detached: 'Branch: (losgekoppelde HEAD)',
  version: (version) => `Git-versie: ${version}`,
  repo: (root) => `Repository: ${root}`,
  autoCommit: (on) => `Automatisch committen: ${on ? 'aan' : 'uit'}`,
  lastCommit: (commit, auto, at) => `Laatste commit: ${commit.slice(0, 12)} (${auto ? 'automatisch' : 'handmatig'}, ${at})`,
  lastError: (message) => `Laatste fout: ${message}`,
  entriesHead: 'Lokale filters en includes:',
  entry: (key, value, file) => `  ${key} = ${value}${file ? `  (${file})` : ''}`,
  allowHint: 'Bekijk ze en sta ze daarna toe met baocut projects git-allow',
  initDone: (root) => `Git geïnitialiseerd in ${root}`,
  nothingToAllow: 'Deze repository heeft geen lokale filters of includes die op toestemming wachten',
  allowPrompt: 'Deze items toestaan? BaoCut voert dan git-opdrachten uit die ze uitvoeren [y/N] ',
  notTtyAllow: 'Niet in een terminal: bekijk de items met baocut projects git-status en voer het daarna opnieuw uit met --yes',
  notAllowed: 'Niet toegestaan: de commits van BaoCut blijven gepauzeerd voor deze repository',
  allowed: 'Toegestaan: BaoCut commit weer in deze repository',
  removeHead: (name, id, dir) => `Project ${name} (${id}): ${dir}`,
  removeMissing: 'De map is er niet meer',
  removeEffect: (count) => `Verwijderen wist de ${count} sessie(s) erin. De map met video's en bestanden blijft op schijf`,
  removePrompt: 'Dit project uit BaoCut verwijderen? [y/N] ',
  notTtyRemove: 'Niet in een terminal: controleer het project met baocut projects list en voer het opnieuw uit met --yes',
  notRemoved: 'Niet verwijderd',
  removed: (name, count) => `${name} is uit BaoCut verwijderd en ${count} sessie(s) zijn gewist. De map is ongewijzigd: open hem opnieuw (of voer baocut projects create <map> uit) om het project terug te halen`,
};
