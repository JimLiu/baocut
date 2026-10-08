import type { HarnessAgentsMessages } from './harness-agents.ts';
import { pluralForm } from '../../i18n.ts';

export const it: HarnessAgentsMessages = {
  listSeparator: ', ', noDriver: (p) => `Nessun agente registrato con id ${p.id}`, probeFailed: (p) => `Rilevamento non riuscito: ${p.error}`,
  cannotChangeAgent: 'Questa sessione è già iniziata, quindi il suo agente non può essere cambiato. Avvia una nuova sessione per sceglierne un altro.',
  noBudgetLedger: 'Questo Runtime non ha un registro dei budget delle attività, quindi non puoi impostare budget',
  driverGone: (p) => `L’agente ${p.id} è stato rimosso o non è registrato, quindi questa sessione non può più inviare messaggi. Avvia una nuova sessione con un altro agente.`,
  driverUnverified: (p) => `${p.agent} non ha ancora superato i test di integrazione di BaoCut. Vengono mostrati solo i risultati del rilevamento e non può avviare sessioni.`,
  fullAccessOnly: (p) => `${p.agent} non può chiedere approvazione passo per passo, quindi funziona solo in modalità «${p.fullAccess}» (attualmente «${p.current}»). Passa a «${p.fullAccess}» e invia di nuovo oppure usa un altro agente.`,
  runtimeStopping: 'Il Runtime si sta interrompendo', sessionBusy: 'Un’attività è ancora in corso in questa sessione. Interrompila o attendi il completamento.', sessionBusyOther: 'Questa sessione sta eseguendo un’altra attività. Interrompila o attendi il completamento.', oldTaskNotStopped: 'L’attività precedente non si è ancora fermata. Riprova più tardi',
  attachmentsUnsupported: 'Questa versione non può ancora inviare immagini allegate', attachmentDuplicate: 'Ogni allegato può essere incluso solo una volta per messaggio',
  tooManyImages: (p) => pluralForm('it', p.max, { one: `Un messaggio può includere al massimo ${p.max} immagine`, other: `Un messaggio può includere al massimo ${p.max} immagini` }),
  imagesUnsupported: 'Questo agente non supporta le immagini',
  contractRevisionMissing: (p) => `Il contratto dell’attività non ha la revisione ${p.revision} (l’ultima è ${p.latest})`,
  taskEnded: 'L’attività è terminata (o si sta interrompendo), quindi il contratto non può essere cambiato. Per cambiare l’obiettivo, usa tasks.changeGoal',
  contractRevisionStale: (p) => `Il contratto è già alla revisione ${p.latest}, non ${p.expected}. Rileggilo prima di modificarlo`,
  checkMissing: (p) => `Il contratto dell’attività non ha questa verifica: ${p.id}`, taskNotFound: (p) => `Attività non trovata: ${p.id}`, approvalNotFound: (p) => `Approvazione non trovata: ${p.id}`,
  builtinId: (p) => `${p.id} è l’id di un agente integrato. Scegline un altro`, agentExists: (p) => `Esiste già un agente con id ${p.id}`,
  builtinNotRemovable: (p) => `L’agente integrato ${p.agent} non può essere rimosso. Puoi disattivarlo nelle Impostazioni`, agentMissing: (p) => `Nessun agente ha id ${p.id}`, providersUnsupported: 'Questo Runtime non può aggiungere o rimuovere agenti',
  modelMissing: (p) => `${p.agent} non ha il modello «${p.model}». Scegli tra ${p.choices}`,
  effortMissing: (p) => `Il modello «${p.model}» non ha l’intensità di ragionamento «${p.effort}». Scegli tra ${p.choices}`,
  effortUnsupported: (p) => `Il modello «${p.model}» non ha livelli di intensità di ragionamento`,
  approvalNoGrant: 'Questa approvazione non invia dati, quindi non può includere una scelta di autorizzazione',
  contractFieldsReadonly: (p) => `L’agente non può cambiare questi campi del contratto dell’attività: ${p.fields}. Solo l’utente decide modalità di accesso, ambito dei permessi, budget e intervalli protetti`,
};
