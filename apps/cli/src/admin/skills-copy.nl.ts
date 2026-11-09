import type { SkillsMessages } from './skills-copy.ts';
import { pluralForm } from '@baocut/protocol';
export const nl: SkillsMessages = {
 skillsHelp: `Gebruik:
  baocut skills add <folder>       Een lokale Skill-map (met SKILL.md in de hoofdmap) kopiëren
                                   naar <BAOCUT_HOME>/skills, standaard ingeschakeld
  baocut skills import <source>    Een Skill van GitHub importeren: owner/repo, een repository-URL, of
                                   …/tree/<branch>/<folder>; standaard uit, kijk deze na voordat je deze inschakelt
    --id <id>                      Voor add en import: een ander id gebruiken (standaard afgeleid van de mapnaam;
                                   geweigerd als het id bestaat, nooit overschreven)
  baocut skills enable|disable <id>
                                   Een Skill in- of uitschakelen: geldt vanaf de volgende nieuwe agentsessie
  baocut skills remove <id>        Een toegevoegde of geïmporteerde Skill verwijderen (ingebouwde alleen uitschakelen)`,
 added: 'Toegevoegd', imported: 'Geïmporteerd', turnedOn: 'Ingeschakeld', turnedOff: 'Uitgeschakeld', reviewFirst: (id) => `Kijk deze eerst na (baocut skills read ${id}) en schakel deze daarna in met baocut skills enable ${id}`, takesEffectNextSession: 'Geldt vanaf de volgende nieuwe agentsessie; lopende sessies blijven ongewijzigd', removed: (id, path) => `${id} verwijderd (${path})`, localSource: (path, addedAt) => `lokale map ${path} (${addedAt})`, remoteSource: (url, ref, commit, importedAt) => `${url} (${ref}@${commit}, ${importedAt})`, changed: (verb, id, name, enabled, path, source) => `${verb} ${id} (${name}, ${enabled ? 'aan' : 'uit'}) → ${path}${source ? `\nBron: ${source}` : ''}`, idFormat: (flag, value) => `${flag} accepteert een Skill-id (kleine letters, met koppeltekens, zie baocut skills): ${value}`,
 skillHelp: `Gebruik:
  baocut skill install [--dir <map>]… [--agent agents|claude] [--copy]
                                   Installeert de BaoCut-skill voor externe agents (hoe je BaoCut gebruikt). Standaard in
                                   ~/.agents/skills/baocut (Codex en andere agents) en ~/.claude/skills/baocut (Claude Code),
                                   als links naar de skill in de BaoCut-app, zodat hij met de app meegaat
    --dir <map>                    Installeer in plaats daarvan in <map>/.agents/skills en <map>/.claude/skills: elke map,
                                   niet alleen een BaoCut-project; herhaal voor meerdere mappen
    --agent agents|claude          Maar één van de twee: .agents/skills of .claude/skills
    --copy                         Kopiëren in plaats van linken (een kopie volgt geen app-updates: opnieuw installeren)
  baocut skill status              De skillversie in de app, waar hij geïnstalleerd is en of elke plek actueel is,
                                   en het baocut-commando in je terminal
  baocut skill remove [--dir <map>]… [--agent agents|claude] [--yes]
                                   Verwijderen: bij een link verdwijnt alleen de link; een kopie verwijderen vraagt --yes.
                                   Iets in baocut/ dat niet de BaoCut-skill is, wordt nooit vervangen of verwijderd`,
  installedAt: (path, linkTarget) => `Geïnstalleerd: ${path}${linkTarget ? ` → ${linkTarget}` : ' (kopie)'}`,
  takesEffect: 'Werkt in een nieuwe agentsessie',
  removedAt: (path) => `Verwijderd: ${path}`,
  removeCopies: (paths) =>
    `${paths.join(', ')} ${paths.length === 1 ? 'is een kopie' : 'zijn kopieën'}: verwijderen wist de bestanden, ook wijzigingen die daar zijn gemaakt. Voeg --yes toe om te verwijderen`,
  unknownAgent: (value) => `--agent accepteert agents (.agents/skills) of claude (.claude/skills): ${value}`,
  fixHint: 'Sommige installaties zijn verouderd of kapot: baocut skill install (met dezelfde --dir) herstelt ze',
  statusSkill: (version, source, bundled) => `Skill     ${version ?? '?'}  ${source}${bundled ? '' : ' (ontwikkelversie: gemaakt door de Runtime)'}`,
  statusCli: (entry) => `CLI       ${entry ?? 'niet meegeleverd (ontwikkelversie)'}`,
  statusOnPath: (path, target, fromApp) => `Terminal  ${path}${target ? ` → ${target}` : ''}${fromApp ? ' (deze app)' : ' (niet deze app)'}`,
  statusNotOnPath: (command) => `Terminal  baocut staat niet in PATH${command ? `; om het in elke terminal te gebruiken: ${command}` : ''}`,
  appOutsideApplications: 'BaoCut draait niet vanuit de map Apps: links breken als je de app verplaatst of verwijdert',
  globalHeading: 'Globaal',
  state: { none: 'Niet geïnstalleerd', current: 'Actueel', stale: 'Verouderd', broken: 'Kapotte link', foreign: 'Er staat iets anders (niet aangeraakt)' },
  mode: { link: 'Link', copy: 'Kopie' },

  cliHelp: `Gebruik:
  baocut cli install               Zet baocut in PATH, met verwijzing naar de opdrachtregel in de BaoCut-app. macOS: een link
                                   op ~/.local/bin/baocut. Windows: %LOCALAPPDATA%\\BaoCut\\bin\\baocut.cmd, met die map
                                   toegevoegd aan je gebruikers-PATH. Geen beheerdersrechten nodig
  baocut cli status                Waar baocut staat, of het naar deze app verwijst en welke baocut je terminal vindt
  baocut cli remove                Verwijdert wat baocut cli install heeft neergezet. Iets op die plek dat BaoCut er niet
                                   heeft neergezet, wordt nooit vervangen of verwijderd`,
  cliStatusEntry: (path, target, state) => `Commando  ${path}${target ? ` → ${target}` : ''} · ${state}`,
  cliStatusApp: (entry) => `App       ${entry ?? 'geen meegeleverde opdrachtregel (ontwikkelversie): installeer het vanuit de BaoCut-app'}`,
  cliStatusTerminal: (found) => `Terminal  ${found ?? 'baocut niet gevonden'}`,
  cliStatusUnchecked: 'Terminal  kon de PATH van je terminal niet controleren: open een nieuwe terminal en voer baocut version uit',
  cliShadowed: (found, dir) => `Terminal  vindt eerst ${found}. Om deze te gebruiken: verwijder die of zet ${dir} eerder in PATH`,
  cliPathHint: (dir, line, file) =>
    `${dir} staat nog niet in de PATH van je terminal. Voeg deze regel toe aan ${file ?? 'je shellconfiguratie'} en open daarna een nieuwe terminal:\n  ${line}`,
  cliInstalled: (path, target) => `Geïnstalleerd: ${path} → ${target}`,
  cliWindowsPath: (dir) => `${dir} staat in je gebruikers-PATH: open een nieuwe terminal om baocut te gebruiken`,
  cliRemoved: (path) => `Verwijderd: ${path}`,
  cliNothingToRemove: (path) => `Niets te verwijderen op ${path}`,
  cliInstallHint: 'baocut cli install zet baocut in PATH',
  cliFixHint: 'baocut cli install laat het naar deze app verwijzen',
  cliState: {
    none: 'Niet geïnstalleerd',
    current: 'Verwijst naar deze app',
    stale: 'Verwijst naar een andere BaoCut',
    broken: 'Verwijst naar een plek die niet meer bestaat',
    foreign: 'Er staat iets anders (niet aangeraakt)',
    standalone: 'Verwijst naar het zelfstandige opdrachtregelpakket, dat het beheert (baocut update; niet aangeraakt)',
  },
};
