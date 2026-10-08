import type { ChatMessages } from './chat-copy.ts';

export const it: ChatMessages = {
  help: `Uso:
  baocut chat <message> [options]  Invia un messaggio e mostra la risposta
    --project <dir>                Conversa in questa cartella di progetto (identificato da .bcut/project.json
                                   nella cartella, scritto se manca)
    --conversation <id>            Continua una sessione esistente
    --template <id>                Allega un template di scena (una scena da baocut templates): il Runtime aggiunge
                                   la guida del briefing e il corpo del template al messaggio; non puoi allegare esempi;
                                   invia il prompt dell’esempio (baocut templates show <id>) come messaggio
    --skill <id>                   Scegli una skill (da baocut skills, anche disattivata):
                                   il Runtime aggiunge il corpo di SKILL.md al messaggio
    --mode <ask|auto-accept-edits|auto|full-access|plan>
                                   Cambia la modalità di accesso di questa sessione (vale per le azioni successive); se omesso,
                                   mantiene la modalità o usa agent.defaultAccessMode (predefinito auto) se non è mai cambiata
    --yes                          Approva automaticamente le richieste di approvazione (solo questa sessione)`,
  missingMessage: 'Testo del messaggio mancante',
  templateIsExample: (title: string, id: string) => `«${title}» è un esempio e non può essere allegato: ottieni il prompt con baocut templates show ${id} e invialo come messaggio`,
  sessionCreated: (id: string, cwd: string) => `Sessione ${id}  cartella di lavoro ${cwd}`,
  disconnected: (reason: string) => `Connessione al Runtime persa: ${reason}`, sessionDeleted: 'La sessione è stata eliminata', stopping: 'Interruzione in corso…',
  chatTemplate: (id: string) => `Template: ${id}`, chatSkill: (id: string) => `Skill: ${id}`, chatMode: (mode: string) => `Modalità di accesso: ${mode}`,
  taskEnded: (status: string, error: string | null) => `Attività: ${status}${error ? ` — ${error}` : ''}`,
  taskStatus: { completed: 'Completato', stopped: 'Interrotto', failed: 'Non riuscito' }, taskFailed: 'Attività non riuscita',
  toolCallFinished: (title: string, status: string, exitCode: number | null) => `▸ ${title} — ${status}${exitCode !== null ? ` (codice di uscita ${exitCode})` : ''}`,
  approvalNeeded: (what: string) => `Approvazione necessaria — ${what}`, approvalReason: (isTool: boolean, reason: string) => `${isTool ? 'Contenuto' : 'Motivo'}: ${reason}`, approvalMode: (mode: string) => `Modalità attuale: ${mode}`,
  autoApproved: 'Approvato automaticamente (--yes)', declinedNotTty: 'Non eseguito in un terminale: rifiutato (aggiungi --yes per approvare automaticamente)',
  approvalQuestion: 'Approva? [y] sì / [s] sessione / [N] no ',
};
