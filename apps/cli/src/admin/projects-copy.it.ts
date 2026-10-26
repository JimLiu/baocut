import type { ProjectsMessages } from './projects-copy.ts';

export const it: ProjectsMessages = {
  help: `Uso:
  baocut projects git-status [<progetto>]
                                   Stato git del progetto: repository, branch, se BaoCut può fare commit
                                   e perché è in pausa (per fare commit, baocut projects git-commit)
  baocut projects git-init [<progetto>]
                                   Inizializza git nella cartella del progetto (non nella cartella home, in una cartella
                                   utente standard, nella radice di un volume né dentro un altro repository)
  baocut projects git-allow [<progetto>] [--yes]
                                   Mostra i filtri e gli include nella configurazione locale del repository e poi li
                                   consente: solo allora BaoCut esegue i comandi git che li eseguono
  baocut projects remove <progetto> [--yes]
                                   Rimuove il progetto da BaoCut: le sessioni vengono eliminate; la cartella e i
                                   file restano sul disco (riapri la cartella per riavere il progetto)
  <progetto> è un ID, un nome o una cartella di progetto; senza, il progetto che contiene la cartella attuale`,
  noProject: (cwd) => `Nessun progetto contiene ${cwd}. Indica un ID, un nome o una cartella di progetto (baocut projects list)`,
  unknownProject: (text) => `Progetto non trovato: ${text} (baocut projects list)`,
  ambiguousProject: (text) => `Più progetti si chiamano ${text}; indica il suo ID`,
  states: {
    ready: 'pronto',
    paused: 'in pausa',
    'not-repo': 'non in un repository git',
    unavailable: 'git non disponibile',
    error: 'errore',
  },
  head: (name, id) => `Progetto ${name} (${id})`,
  state: (state) => `Git: ${state}`,
  branch: (branch) => `Branch: ${branch}`,
  detached: 'Branch: (HEAD scollegato)',
  version: (version) => `Versione di git: ${version}`,
  repo: (root) => `Repository: ${root}`,
  autoCommit: (on) => `Commit automatico: ${on ? 'attivo' : 'disattivato'}`,
  lastCommit: (commit, auto, at) => `Ultimo commit: ${commit.slice(0, 12)} (${auto ? 'automatico' : 'manuale'}, ${at})`,
  lastError: (message) => `Ultimo errore: ${message}`,
  entriesHead: 'Filtri e include locali:',
  entry: (key, value, file) => `  ${key} = ${value}${file ? `  (${file})` : ''}`,
  allowHint: 'Controllali, poi esegui baocut projects git-allow per consentirli',
  initDone: (root) => `git inizializzato in ${root}`,
  nothingToAllow: 'Questo repository non ha filtri né include locali in attesa di consenso',
  allowPrompt: 'Consentire queste voci? BaoCut eseguirà i comandi git che le eseguono [y/N] ',
  notTtyAllow: 'Non sei in un terminale: controlla le voci con baocut projects git-status, poi riesegui con --yes',
  notAllowed: 'Non consentito: i commit di BaoCut restano in pausa per questo repository',
  allowed: 'Consentito: BaoCut torna a fare commit in questo repository',
  removeHead: (name, id, dir) => `Progetto ${name} (${id}): ${dir}`,
  removeMissing: 'La cartella non c’è più',
  removeEffect: (count) => `Rimuoverlo elimina le sue ${count} sessioni. La cartella con video e file resta sul disco`,
  removePrompt: 'Rimuovere questo progetto da BaoCut? [y/N] ',
  notTtyRemove: 'Non sei in un terminale: controlla il progetto con baocut projects list, poi esegui di nuovo con --yes',
  notRemoved: 'Non rimosso',
  removed: (name, count) => `${name} è stato rimosso da BaoCut e ${count} sessioni sono state eliminate. La cartella non è stata toccata: riaprila (o esegui baocut projects create <cartella>) per riavere il progetto`,
};
