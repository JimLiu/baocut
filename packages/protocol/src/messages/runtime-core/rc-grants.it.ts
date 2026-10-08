import type { RcGrantsMessages } from './rc-grants.ts';
import { pluralForm } from '../../i18n.ts';

const IT_KINDS: Readonly<Record<string, string>> = { transcript: 'trascrizioni e traduzioni', frames: 'fotogrammi video e miniature', audio: 'audio', video: 'il video originale', document: 'testo e prompt', context: 'contesto della conversazione dell’agente' };
function itKinds(codes: string): string {
  const labels = codes.split(',').filter(Boolean).map((k) => IT_KINDS[k] ?? k);
  return new Intl.ListFormat('it', { style: 'long', type: 'conjunction' }).format(labels);
}

export const it: RcGrantsMessages = {
  dataKinds: (p) => itKinds(p.kinds),
  grantLapsed: (p) => `L’autorizzazione a inviare ${itKinds(p.kinds)} a ${p.label} ${p.expired ? 'è scaduta' : 'è stata revocata'}`,
  grantRequired: (p) => `Inviare ${itKinds(p.kinds)} a ${p.label} richiede l’autorizzazione dell’utente`,
  grantCallsUsedUp: (p) => `Il limite di chiamate dell’autorizzazione (${p.used}/${p.max}) è esaurito, quindi questa chiamata supererebbe il budget`,
  grantAmountUsedUp: 'Il limite di spesa dell’autorizzazione è esaurito, quindi questa chiamata supererebbe il budget',
  budgetUnverifiable: (p) => `L’autorizzazione ha un limite di spesa, ma questo modello di ${p.label} non ha un prezzo affidabile, quindi non è possibile garantire il rispetto del limite`,
  taskCallsUsedUp: (p) => `Il budget di chiamate di questa attività (${p.used}/${p.max}) è esaurito, quindi questa chiamata supererebbe il budget dell’attività`,
  taskAmountUsedUp: (p) => `Il budget di spesa di questa attività (${p.amount} ${p.currency}) è esaurito, quindi questa chiamata supererebbe il budget dell’attività`,
  taskBudgetUnverifiable: (p) => `Il budget di questa attività ha un limite di spesa, ma il costo di questa chiamata non può essere stimato in ${p.currency}, quindi non è possibile garantire il rispetto del limite`,
  combined: (p) => `${p.message} (${pluralForm('it', p.others, { one: `${p.others} altro trasferimento richiede un’autorizzazione`, other: `${p.others} altri trasferimenti richiedono un’autorizzazione` })})`,
  hintRevoked: 'Le autorizzazioni revocate o scadute non vengono ripristinate automaticamente. Chiedi all’utente di concedere di nuovo l’accesso nelle Impostazioni di BaoCut o di approvare questa volta nella sessione.',
  hintRequired: 'L’invio dei dati richiede l’autorizzazione dell’utente (per tipo di dati, destinatario, ambito e scopo). Chiedi all’utente di concedere un’autorizzazione nelle Impostazioni di BaoCut o di approvare questa volta nella sessione.',
  hintExhausted: 'Un budget esaurito non viene aumentato automaticamente. Chiedi all’utente di aumentare il limite di questa autorizzazione o attendi il completamento delle chiamate in corso (quelle non riuscite e annullate liberano le riserve).',
  hintUnverifiable: 'Quando il costo non può essere stimato, l’utente può solo approvare ogni chiamata (costo sconosciuto) o concedere un’autorizzazione per chiamata con costo sconosciuto.',
  hintTaskExhausted: 'Un budget di attività esaurito non viene aumentato automaticamente. Chiedi all’utente di aumentare il budget nel contratto dell’attività o attendi il completamento delle chiamate in corso (quelle non riuscite e annullate liberano le riserve).',
  hintTaskUnverifiable: 'Quando il budget di un’attività ha un limite di spesa, sono accettate solo chiamate con costo stimabile nella stessa valuta; il limite non può essere garantito nemmeno quando esistono chiamate con costi sconosciuti o altre valute. Chiedi all’utente di rimuovere il limite di spesa del budget dell’attività (mantenendo solo il limite di chiamate) o passa a un modello con un prezzo.',
  hintServiceAuto: 'Il livello auto di un servizio esterno non è un’autorizzazione all’invio dei dati. Chiedi all’utente di concedere un’autorizzazione per questo provider in BaoCut (tipi di dati, ambito e budget) o cambia il livello del servizio in ask per approvare ogni chiamata.',
  placeholderPurpose: '<purpose>', placeholderMaxCalls: '<higher call count>', placeholderBudget: '<higher amount>', placeholderCalls: '<call count>',
  grantLapsedBeforeStart: (p) => `L’autorizzazione ${p.state === 'expired' ? 'è scaduta' : p.state === 'revoked' ? 'è stata revocata' : 'è stata ridotta'} prima dell’inizio dell’attività, quindi non sono stati inviati dati`,
  grantInvalidBeforeStart: 'L’autorizzazione è diventata non valida prima dell’inizio dell’attività, quindi non sono stati inviati dati', retrySkipped: (p) => `Il nuovo tentativo automatico non è stato eseguito: ${p.reason}`, ledgerUnsaved: 'Impossibile scrivere il registro delle autorizzazioni su disco, quindi non sono stati inviati dati', providerDisabledBeforeStart: 'Il provider è stato disattivato prima dell’inizio dell’attività, quindi non sono stati inviati dati',
  noSuchGrant: 'Nessuna autorizzazione corrispondente', toolPurpose: (p) => `Strumento «${p.tool}»`, pipelinePurpose: (p) => `Flusso «${p.label}»`,
};
