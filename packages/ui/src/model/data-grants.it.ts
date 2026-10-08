import type { DataGrantsMessages } from './data-grants.ts';
import { pluralForm } from '@baocut/protocol';

const times = (n: number) => pluralForm('it', n, { one: `${n} chiamata`, other: `${n} chiamate` });

export const it: DataGrantsMessages = {
  state: { active: 'Attivo', expired: 'Scaduto', revoked: 'Revocato', exhausted: 'Limite raggiunto' },
  kindList: (kinds: readonly string[]) => kinds.join(', '), noKinds: 'Nessun tipo di dati',
  origin: { 'provider-enable': 'Concessa per impostazione predefinita all’attivazione del provider', approval: 'Concessa durante l’approvazione', user: 'Concessa manualmente' },
  oneVideoNamed: (name: string) => `Solo il video «${name}»`, oneVideo: 'Solo un video', allVideos: 'Tutti i video', oneTask: 'Solo un’attività',
  budgetCap: (amount: string) => `Limite di spesa ${amount}`, budgetUnknown: 'Costo sconosciuto, conteggiato solo per chiamate', once: 'Solo questa volta', unlimited: 'Chiamate illimitate',
  maxCalls: (n: number) => `Fino a ${times(n)}`, revokedOn: (day: string) => `Revocata ${day}`, expiredOn: (day: string) => `Scaduta ${day}`, expiresOn: (day: string) => `Scade ${day}`, neverUsed: 'Non ancora usata',
  usedWithAmount: (calls: number, amount: string) => `Utilizzo: ${times(calls)} (${amount})`, used: (calls: number) => `Utilizzo: ${times(calls)}`,
  reservedWithAmount: (calls: number, amount: string) => `${times(calls)} in corso (riserva di ${amount})`, reserved: (calls: number) => `${times(calls)} in corso`, unknownCost: (calls: number) => `${times(calls)} con costo sconosciuto`, usageSeparator: ', ',
  revokeConfirm: (running: number, sent: number) => [ 'Dopo la revoca, le nuove chiamate e quelle in coda che usano questa autorizzazione verranno rifiutate.', running ? pluralForm('it', running, { one: `${running} chiamata già in corso terminerà normalmente.`, other: `${running} chiamate già in corso termineranno normalmente.` }) : '', sent ? `I dati già inviati in ${times(sent)} e i costi sostenuti non possono essere recuperati.` : '' ].filter(Boolean).join(' '),
  revoked: 'Revocato',
  sentBefore: (calls: number, amount: string | null, unknownCostCalls: number) => `Inviate in precedenza: ${times(calls)}${amount ? ` (${amount}${unknownCostCalls ? `, più ${times(unknownCostCalls)} con costo sconosciuto` : ''})` : ''}`,
  runningJobs: (n: number) => pluralForm('it', n, { one: `${n} attività in corso terminerà normalmente`, other: `${n} attività in corso termineranno normalmente` }),
};
