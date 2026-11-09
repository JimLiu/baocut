import type { SkillsMessages } from './skills-copy.ts';

export const it: SkillsMessages = {
  skillsHelp: `Uso:
  baocut skills add <folder>       Copia una cartella di skill locale (con SKILL.md nella radice)
                                   in <BAOCUT_HOME>/skills, attivata per impostazione predefinita
  baocut skills import <source>    Importa una skill da GitHub: owner/repo, un URL del repository o
                                   …/tree/<branch>/<folder>; disattivata per impostazione predefinita, rivedila prima di attivarla
    --id <id>                      Per add e import: usa un id diverso (dal nome della cartella per impostazione
                                   predefinita; rifiutato se l’id esiste, mai sovrascritto)
  baocut skills enable|disable <id>
                                   Attiva / disattiva una skill: ha effetto dalla prossima nuova sessione dell’agente
  baocut skills remove <id>        Elimina una skill aggiunta o importata (quelle integrate possono solo essere disattivate)`,
  added: 'Aggiunta', imported: 'Importata', turnedOn: 'Attivata', turnedOff: 'Disattivata', reviewFirst: (id: string) => `Rivedila prima (baocut skills read ${id}), poi attivala con baocut skills enable ${id}`, takesEffectNextSession: 'Ha effetto dalla prossima nuova sessione dell’agente; le sessioni già in corso non cambiano', removed: (id: string, path: string) => `Eliminata: ${id} (${path})`, localSource: (path: string, addedAt: string) => `cartella locale ${path} (${addedAt})`, remoteSource: (url: string, ref: string, commit: string, importedAt: string) => `${url} (${ref}@${commit}, ${importedAt})`,
  changed: (verb: string, id: string, name: string, enabled: boolean, path: string, source: string | null) => `${verb} ${id} (${name}, ${enabled ? 'on' : 'off'}) → ${path}${source ? `
Origine: ${source}` : ''}`, idFormat: (flag: string, value: string) => `${flag} accetta un id di skill (minuscolo, separato da trattini, vedi baocut skills): ${value}`,
  skillHelp: `Uso:
  baocut skill install [--dir <cartella>]… [--agent agents|claude] [--copy]
                                   Installa la skill BaoCut per agenti esterni (come usare BaoCut). Per impostazione predefinita
                                   in ~/.agents/skills/baocut (Codex e altri agenti) e ~/.claude/skills/baocut (Claude Code),
                                   come link alla skill dentro l’app BaoCut, così si aggiorna con l’app
    --dir <cartella>               Installa invece in <cartella>/.agents/skills e <cartella>/.claude/skills: qualsiasi
                                   cartella, non solo un progetto BaoCut; ripetilo per più cartelle
    --agent agents|claude          Solo una delle due: .agents/skills o .claude/skills
    --copy                         Copia invece di collegare (una copia non segue gli aggiornamenti: reinstalla)
  baocut skill status              La versione della skill nell’app, dove è installata e se ogni posizione è aggiornata,
                                   e il comando baocut del tuo terminale
  baocut skill remove [--dir <cartella>]… [--agent agents|claude] [--yes]
                                   La rimuove: per un link si toglie solo il link; eliminare una copia richiede --yes.
                                   Ciò che si trova in baocut/ e non è la skill BaoCut non viene mai sostituito né eliminato`,
  installedAt: (path: string, linkTarget: string | null) => `Installata in ${path}${linkTarget ? ` → ${linkTarget}` : ' (copia)'}`,
  takesEffect: 'Vale da una nuova sessione dell’agente',
  removedAt: (path: string) => `Rimossa da ${path}`,
  removeCopies: (paths: readonly string[]) =>
    `${paths.join(', ')} ${paths.length === 1 ? 'è una copia' : 'sono copie'}: la rimozione elimina i file, comprese le modifiche fatte lì. Aggiungi --yes per eliminare`,
  unknownAgent: (value: string) => `--agent accetta agents (.agents/skills) o claude (.claude/skills): ${value}`,
  fixHint: 'Alcune installazioni sono obsolete o danneggiate: baocut skill install (con lo stesso --dir) le ripara',
  statusSkill: (version: string | null, source: string, bundled: boolean) =>
    `Skill     ${version ?? '?'}  ${source}${bundled ? '' : ' (versione di sviluppo: generata dal Runtime)'}`,
  statusCli: (entry: string | null) => `CLI       ${entry ?? 'non inclusa (versione di sviluppo)'}`,
  statusOnPath: (path: string, target: string | null, fromApp: boolean) =>
    `Terminale ${path}${target ? ` → ${target}` : ''}${fromApp ? ' (questa app)' : ' (non questa app)'}`,
  statusNotOnPath: (command: string | null) => `Terminale baocut non è nel PATH${command ? `; per usarlo in ogni terminale: ${command}` : ''}`,
  appOutsideApplications: 'BaoCut non è in esecuzione dalla cartella Applicazioni: i link si interrompono se sposti o elimini l’app',
  globalHeading: 'Globale',
  state: { none: 'Non installata', current: 'Aggiornata', stale: 'Obsoleta', broken: 'Link interrotto', foreign: 'C’è altro (lasciato com’è)' },
  mode: { link: 'Link', copy: 'Copia' },

  cliHelp: `Uso:
  baocut cli install               Mette baocut nel PATH, puntando alla riga di comando dentro l’app BaoCut. macOS: un link
                                   in ~/.local/bin/baocut. Windows: %LOCALAPPDATA%\\BaoCut\\bin\\baocut.cmd, con quella
                                   cartella aggiunta al PATH del tuo utente. Non servono diritti di amministratore
  baocut cli status                Dove si trova baocut, se punta a questa app e quale baocut trova il tuo terminale
  baocut cli remove                Rimuove ciò che baocut cli install ha messo. Ciò che si trova in quel percorso e non è
                                   stato messo da BaoCut non viene mai sostituito né eliminato`,
  cliStatusEntry: (path: string, target: string | null, state: string) => `Comando   ${path}${target ? ` → ${target}` : ''} · ${state}`,
  cliStatusApp: (entry: string | null) =>
    `App       ${entry ?? 'nessuna riga di comando inclusa (versione di sviluppo): installalo dall’app BaoCut'}`,
  cliStatusTerminal: (found: string | null) => `Terminale ${found ?? 'baocut non trovato'}`,
  cliStatusUnchecked: 'Terminale impossibile controllare il PATH del terminale: apri un nuovo terminale ed esegui baocut version',
  cliShadowed: (found: string, dir: string) =>
    `Terminale trova prima ${found}. Per usare questo, rimuovi quello o sposta ${dir} più in alto nel PATH`,
  cliPathHint: (dir: string, line: string, file: string | null) =>
    `${dir} non è ancora nel PATH del terminale. Aggiungi questa riga al file ${file ?? 'di configurazione della shell'}, poi apri un nuovo terminale:\n  ${line}`,
  cliInstalled: (path: string, target: string) => `Installato: ${path} → ${target}`,
  cliWindowsPath: (dir: string) => `${dir} è nel PATH del tuo utente: apri un nuovo terminale per usare baocut`,
  cliRemoved: (path: string) => `Rimosso: ${path}`,
  cliNothingToRemove: (path: string) => `Niente da rimuovere in ${path}`,
  cliInstallHint: 'baocut cli install mette baocut nel PATH',
  cliFixHint: 'baocut cli install lo fa puntare a questa app',
  cliState: {
    none: 'Non installato',
    current: 'Punta a questa app',
    stale: 'Punta a un altro BaoCut',
    broken: 'Punta a una posizione che non esiste più',
    foreign: 'C’è altro (lasciato com’è)',
    standalone: 'Punta al pacchetto autonomo della riga di comando, che lo gestisce (baocut update; lasciato com’è)',
  },
};
