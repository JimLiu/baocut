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
  baocut skill install --agent <claude-code|codex|cursor|gemini> [--dir <folder>] [--link] [--yes]
                                   Installa la skill BaoCut per agenti esterni (come usare BaoCut) in baocut/
                                   nella cartella delle skill dell’host: Claude Code ~/.claude/skills, Codex ~/.codex/skills,
                                   Cursor ~/.cursor/skills, Gemini CLI ~/.gemini/skills
    --dir <folder>                 Usa un’altra cartella delle skill (installa in baocut/ al suo interno); richiesto senza --agent
    --link                         Mette la skill generata in <BAOCUT_HOME>/agent-skills/baocut e un collegamento nell’host:
                                   installarla di nuovo in seguito (per qualsiasi host) le aggiorna tutte
    --yes                          Sostituisce la destinazione se esiste (per un collegamento, solo il collegamento, non
                                   la cartella a cui punta); senza questo flag nulla viene sovrascritto
  baocut skill path                Origine della skill BaoCut, posizione di installazione di ogni host e cosa è
                                   installato al momento (non richiede il Runtime)`,
  targetExists: (target: string, linkTarget: string | null) => `${target} esiste già (${linkTarget !== null ? `un collegamento a ${linkTarget}` : 'una cartella o un file'}); nulla è cambiato. Aggiungi --yes per sostituirlo`, installed: (target: string, files: number, linkTo: string | null) => `Skill BaoCut installata in ${target} (${files} file${linkTo ? `, collegata a ${linkTo}` : ''})`, takesEffect: (host: string | null) => host ? `Ha effetto in una nuova sessione di ${host}` : 'Ha effetto in una nuova sessione', pathEscapes: (path: string) => `Un percorso nella skill BaoCut punta fuori dalla sua cartella: ${path}`,
  sourceLine: (dir: string | null) => `Origine   ${dir ?? 'non trovata (BaoCut non è installato e questo non è il repository; puoi impostare BAOCUT_AGENT_SKILLS_DIR)'}`, notInstalled: 'Non installata', linkState: (target: string) => `Link → ${target}`, installedFolder: 'Installata (cartella)', isFile: 'Un file (non una cartella di skill)',
};
