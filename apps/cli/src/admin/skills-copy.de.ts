import type { SkillsMessages } from './skills-copy.ts';



export const de: SkillsMessages = {
  skillsHelp: `Verwendung:
  baocut skills add <folder>       Lokalen Skill-Ordner (mit SKILL.md im Stamm)
                                   nach <BAOCUT_HOME>/skills kopieren; standardmäßig aktiviert
  baocut skills import <source>    Skill von GitHub importieren: owner/repo, Repository-URL oder
                                   …/tree/<branch>/<folder>; standardmäßig deaktiviert, vor Aktivierung prüfen
    --id <id>                      Für add und import: Andere ID verwenden (standardmäßig vom Ordnernamen
                                   abgeleitet; vorhandene IDs werden abgelehnt, niemals überschrieben)
  baocut skills enable|disable <id>
                                   Skill aktivieren/deaktivieren: Wirksam ab der nächsten neuen Agent-Sitzung
  baocut skills remove <id>        Hinzugefügten oder importierten Skill löschen (integrierte lassen sich nur deaktivieren)`,
  added: "Hinzugefügt",
  imported: "Importiert",
  turnedOn: "Aktiviert",
  turnedOff: "Deaktiviert",
  reviewFirst: (id: string) => `Prüfen Sie ihn zuerst (baocut skills read ${id}) und aktivieren Sie ihn anschließend mit baocut skills enable ${id}`,
  takesEffectNextSession: "Wirksam ab der nächsten neuen Agent-Sitzung; laufende Sitzungen sind nicht betroffen",
  removed: (id: string, path: string) => `Gelöscht: ${id} (${path})`,
  localSource: (path: string, addedAt: string) => `lokaler Ordner ${path} (${addedAt})`,
  remoteSource: (url: string, ref: string, commit: string, importedAt: string) => `${url} (${ref}@${commit}, ${importedAt})`,
  changed: (verb: string, id: string, name: string, enabled: boolean, path: string, source: string | null) =>
    `${verb} ${id} (${name}, ${enabled ? "ein" : "aus"}) → ${path}${source ? `\nQuelle: ${source}` : ""}`,
  idFormat: (flag: string, value: string) => `${flag} erwartet eine Skill-ID (Kleinbuchstaben mit Bindestrichen, siehe baocut skills): ${value}`,

  skillHelp: `Verwendung:
  baocut skill install [--dir <Ordner>]… [--agent agents|claude] [--copy]
                                   Installiert den BaoCut-Skill für externe Agents (wie man BaoCut benutzt). Standardmäßig in
                                   ~/.agents/skills/baocut (Codex und andere Agents) und ~/.claude/skills/baocut (Claude Code),
                                   als Links auf den Skill in der BaoCut-App – er wird mit der App aktualisiert
    --dir <Ordner>                 Stattdessen in <Ordner>/.agents/skills und <Ordner>/.claude/skills installieren:
                                   beliebiger Ordner, nicht nur ein BaoCut-Projekt; für mehrere Ordner wiederholen
    --agent agents|claude          Nur einer der beiden: .agents/skills oder .claude/skills
    --copy                         Kopieren statt verlinken (eine Kopie folgt keinen App-Updates: erneut installieren)
  baocut skill status              Die Skill-Version der App, wo er installiert ist und ob jeder Ort aktuell ist,
                                   und der baocut-Befehl in deinem Terminal
  baocut skill remove [--dir <Ordner>]… [--agent agents|claude] [--yes]
                                   Entfernen: bei einem Link nur den Link; eine Kopie zu löschen braucht --yes.
                                   Was in baocut/ liegt und nicht der BaoCut-Skill ist, wird nie ersetzt oder gelöscht`,
  installedAt: (path, linkTarget) => `Installiert: ${path}${linkTarget ? ` → ${linkTarget}` : ' (Kopie)'}`,
  takesEffect: 'Gilt ab einer neuen Agent-Sitzung',
  removedAt: (path) => `Entfernt: ${path}`,
  removeCopies: (paths) =>
    `${paths.join(', ')} ${paths.length === 1 ? 'ist eine Kopie' : 'sind Kopien'}: Entfernen löscht die Dateien, auch dort gemachte Änderungen. Mit --yes löschen`,
  unknownAgent: (value) => `--agent erwartet agents (.agents/skills) oder claude (.claude/skills): ${value}`,
  fixHint: 'Einige Installationen sind veraltet oder kaputt: baocut skill install (mit demselben --dir) repariert sie',
  statusSkill: (version, source, bundled) => `Skill     ${version ?? '?'}  ${source}${bundled ? '' : ' (Entwicklungsversion: vom Runtime erzeugt)'}`,
  statusCli: (entry) => `CLI       ${entry ?? 'nicht enthalten (Entwicklungsversion)'}`,
  statusOnPath: (path, target, fromApp) => `Terminal  ${path}${target ? ` → ${target}` : ''}${fromApp ? ' (diese App)' : ' (nicht diese App)'}`,
  statusNotOnPath: (command) => `Terminal  baocut ist nicht im PATH${command ? `; für jedes Terminal: ${command}` : ''}`,
  appOutsideApplications: 'BaoCut läuft nicht aus dem Ordner „Programme“: Links brechen, wenn du die App verschiebst oder löschst',
  globalHeading: 'Global',
  state: { none: 'Nicht installiert', current: 'Aktuell', stale: 'Veraltet', broken: 'Defekter Link', foreign: 'Etwas anderes liegt dort (unberührt)' },
  mode: { link: 'Link', copy: 'Kopie' },

  cliHelp: `Verwendung:
  baocut cli install               Bringt baocut in den PATH, mit Verweis auf die Befehlszeile in der BaoCut-App. macOS: ein
                                   Link unter ~/.local/bin/baocut. Windows: %LOCALAPPDATA%\\BaoCut\\bin\\baocut.cmd, der Ordner
                                   wird zum PATH deines Benutzers hinzugefügt. Keine Administratorrechte nötig
  baocut cli status                Wo baocut liegt, ob es auf diese App zeigt und welches baocut dein Terminal findet
  baocut cli remove                Entfernt, was baocut cli install angelegt hat. Was dort liegt und nicht von BaoCut stammt,
                                   wird nie ersetzt oder gelöscht`,
  cliStatusEntry: (path, target, state) => `Eintrag   ${path}${target ? ` → ${target}` : ''} · ${state}`,
  cliStatusApp: (entry) => `App       ${entry ?? 'keine mitgelieferte Befehlszeile (Entwicklungsversion): aus der BaoCut-App installieren'}`,
  cliStatusTerminal: (found) => `Terminal  ${found ?? 'baocut nicht gefunden'}`,
  cliStatusUnchecked: 'Terminal  PATH deines Terminals ließ sich nicht prüfen: öffne ein neues Terminal und führe baocut version aus',
  cliShadowed: (found, dir) => `Terminal  findet zuerst ${found}. Um dieses zu nutzen, entferne das andere oder setze ${dir} im PATH weiter nach vorn`,
  cliPathHint: (dir, line, file) =>
    `${dir} ist noch nicht im PATH deines Terminals. Füge diese Zeile zu ${file ?? 'deiner Shell-Konfiguration'} hinzu und öffne dann ein neues Terminal:\n  ${line}`,
  cliInstalled: (path, target) => `Installiert: ${path} → ${target}`,
  cliWindowsPath: (dir) => `${dir} ist im PATH deines Benutzers: öffne ein neues Terminal, um baocut zu nutzen`,
  cliRemoved: (path) => `Entfernt: ${path}`,
  cliNothingToRemove: (path) => `Unter ${path} gibt es nichts zu entfernen`,
  cliInstallHint: 'baocut cli install bringt baocut in den PATH',
  cliFixHint: 'baocut cli install lässt es auf diese App zeigen',
  cliState: { none: 'Nicht installiert', current: 'Zeigt auf diese App', stale: 'Zeigt auf ein anderes BaoCut', broken: 'Zeigt auf einen Ort, den es nicht mehr gibt', foreign: 'Etwas anderes liegt dort (unberührt)' },
};
