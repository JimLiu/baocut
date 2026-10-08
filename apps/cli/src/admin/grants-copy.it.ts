import type { GrantsMessages } from './grants-copy.ts';
import { pluralForm } from '@baocut/protocol';

const callCount = (n: number) => pluralForm('it', n, { one: `${n} chiamata`, other: `${n} chiamate` });

export const it: GrantsMessages = {
  help: `Uso:
  baocut grants [list]             Elenca le autorizzazioni alla condivisione dei dati (provider online e di agenti):
                                   destinatario, tipi di dati, ambito, utilizzo e budget
    --recipient <id>               Solo le autorizzazioni di questo provider
    --video <video id>             Solo le autorizzazioni che coprono questo video
    --include-ended                Include autorizzazioni revocate, scadute ed esaurite
  baocut grants create --recipient <id> --data <kind,…> --purpose <purpose> [options]
                                   Concede un’autorizzazione. Tipi di dati: transcript (trascrizioni e traduzioni), frames (fotogrammi video),
                                   audio (audio), video (video originale), document (testo e prompt), context (contesto dell’agente)
    --video <video id|all>         Copre solo questo video; omesso o all significa tutti i video
    --max-calls <n>                Limite di chiamate; illimitate se omesso
    --budget <amount> --currency <currency>
                                   Limite di spesa: stimato e riservato dai prezzi del modello;
                                   le chiamate a modelli senza prezzi vengono rifiutate (BUDGET_UNVERIFIABLE)
    --expires <ISO time>           Scadenza
  baocut grants update <id> [--data …] [--video <id|all>] [--purpose …] [--max-calls <n|none>]
                         [--budget <amount|none> --currency …] [--expires <time|none>]
                                   Cambia un’autorizzazione; restringerla, abbassare un limite o anticipare la scadenza
                                   rifiuta all’avvio le chiamate messe in coda con le condizioni precedenti
  baocut grants revoke <id>        Revoca un’autorizzazione: le chiamate successive non sono più consentite; dati già
                                   inviati e costi già contabilizzati vengono riportati così come sono
  baocut grants usage <id>         Utilizzo di un’autorizzazione e attività che l’hanno usata (riserve e contabilizzazioni)`,
  usage: 'Uso: baocut grants [list [--recipient <id>] [--video <id>] [--include-ended] | create --recipient <id> --data <kind,…> --purpose <purpose> [options] | update <grant id> [options] | revoke <grant id> | usage <grant id>]', listSep: ', ', missingRecipient: '--recipient mancante (provider che riceve i dati, ad esempio openai)', missingData: (kinds: readonly string[]) => `--data mancante (tipi di dati separati da virgole: ${kinds.join(', ')})`, missingPurpose: '--purpose mancante (una frase rivolta alle persone)', recipientFixed: 'Il destinatario non può cambiare: revoca questa autorizzazione e creane una nuova', nothingToUpdate: 'Nulla da cambiare: indica --data, --video, --purpose, --max-calls, --budget o --expires', persistOnly: '--scope, --max-calls, --budget e --expires si usano solo con --persist', scopeChoices: '--scope accetta video o all', unknownKinds: (unknown: string, kinds: readonly string[]) => `Tipo di dati sconosciuto: ${unknown}. Scegli tra ${kinds.join(', ')}`, maxCallsRange: '--max-calls deve essere un intero da 1 a 1000000 o none (nessun limite)', currencyNeedsBudget: '--currency si usa solo con --budget', budgetFormat: '--budget deve essere un importo decimale non negativo con al massimo 6 cifre decimali (ad esempio 5 o 2.50)', budgetNeedsCurrency: '--budget richiede --currency <three-letter currency code, e.g. USD>', expiresFormat: '--expires deve essere un tempo ISO con fuso orario (ad esempio 2026-12-31T23:59:59Z) o none',
  stateLabels: { active: 'Attivo', expired: 'Scaduto', revoked: 'Revocato', exhausted: 'Esaurito' }, originLabels: { user: 'concessa da te', approval: 'concessa durante l’approvazione', 'provider-enable': 'predefinita all’attivazione' }, calls: (calls: number, reserved: number, max: number | null) => `${calls}${reserved ? `+${reserved} ${pluralForm('it', reserved, { one: 'riservata', other: 'riservate' })}` : ''}${max !== null ? `/${max}` : ''} ${pluralForm('it', max === null ? calls + reserved : max, { one: 'chiamata', other: 'chiamate' })}`, unknownCostCalls: (n: number) => ` (${n} con costo sconosciuto)`, callsAndAmount: (calls: string, amount: string, reserved: string | null, cap: string, currency: string) => `${calls}, ${amount}${reserved ? `+${reserved} riservati` : ''}/${cap} ${currency}`, noGrants: 'Nessuna autorizzazione: le chiamate ai provider online e di agenti chiederanno approvazione (o creane una con baocut grants create)', scopeVideo: (videoId: string) => `video ${videoId}`, scopeAll: 'tutti i video',
  grantLine: (g) => `${g.id}  [${g.state}] ${g.recipient} ← ${g.kinds}  ${g.scope}${g.taskId ? `, solo attività ${g.taskId}` : ''}${g.once ? ', solo questa volta' : ''}  utilizzo ${g.usage}${g.expiresAt ? `, scade ${g.expiresAt}` : ''}  (${g.origin}: ${g.purpose})`, revoked: (id: string, recipient: string, kinds: string) => `Revocata: ${id} (${recipient} ← ${kinds})`, alreadySent: (calls: number, amount: string | null, unknownCostCalls: number) => `${pluralForm('it', calls, { one: 'Già inviata:', other: 'Già inviate:' })} ${callCount(calls)}${amount ? `, ${amount} contabilizzati` : ''}${unknownCostCalls ? ` (${unknownCostCalls} con costo sconosciuto)` : ''}`, runningJobs: (jobs: readonly string[]) => `Attività ancora in corso (termineranno normalmente): ${jobs.join(', ')}`, noJobs: '(Nessuna attività l’ha ancora usata oppure i registri sono stati rimossi)', settled: (calls: number, amount: string, basis: string) => `${pluralForm('it', calls, { one: 'contabilizzata', other: 'contabilizzate' })} ${callCount(calls)} ${amount} (${basis})`, unsettled: 'non contabilizzato', jobLine: (jobId: string, state: string, calls: number, amount: string, settled: string) => `  ${jobId}  ${state}  ${pluralForm('it', calls, { one: 'riservata', other: 'riservate' })} ${callCount(calls)} ${amount}  ${settled}`,
  approvalGrant: (a) => `    Invia: ${a.recipient} ← ${a.kinds}${a.videoId ? ` (video ${a.videoId})` : ''}: ${a.purpose}${a.estimate ? `, stima ${a.estimate}` : ', costo sconosciuto'}${a.maxCalls !== null ? `, massimo ${callCount(a.maxCalls)}` : ''}${a.reason === 'revoked' ? ', autorizzazione revocata o scaduta' : a.reason === 'unverifiable' ? ', costo non stimabile' : ''}`,

};
