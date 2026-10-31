import { pluralForm } from '../../i18n.ts';
import type { RcBotMessages } from './rc-bot.ts';

const minutes = (n: number) => `${n} ${pluralForm('it', n, { one: 'minuto', other: 'minuti' })}`;

export const it: RcBotMessages = {
  // ---- 频道 ----
  mainChannelName: 'Principale',
  channelNotFound: (p: { id: string }) => `Canale non trovato: ${p.id}`,
  mainChannelLocked: 'Il canale principale non può essere archiviato né eliminato.',
  channelArchived: 'Questo canale è archiviato. Ripristinalo per continuare a lavorarci.',
  channelDeleteCountsChanged: 'Il numero di attività o di attività programmate in questo canale è cambiato. Ricontrolla prima di eliminarlo.',
  memoryVersionConflict: 'La memoria è cambiata da quando l’hai aperta. Guarda la versione più recente e riprova.',
  memoryTooLarge: (p: { max: number }) => `La memoria può occupare al massimo ${p.max} KB. Fai un po’ d’ordine prima di aggiungere altro.`,
  memorySensitive: 'Non mettere nella memoria chiavi, password, numeri di documenti d’identità o di carte.',
  accessAboveChannelMax: 'La modalità di accesso dell’attività non può superare il limite del canale.',

  // ---- 任务 ----
  workItemNotFound: (p: { id: string }) => `Attività non trovata: ${p.id}`,
  transitionDenied: (p: { from: string; event: string }) => `Questa attività non può eseguire «${p.event}» mentre è nello stato ${p.from}.`,
  textHasLinkOrNumber: 'Il testo dell’attività non deve contenere link, indirizzi email o numeri lunghi. Mettili invece nelle risorse.',
  titleByUser: 'Questo titolo l’hai scritto tu, quindi l’agente non può modificarlo.',
  userTasksNoThread: 'Le tue attività personali non avviano un thread.',
  stoppedByYou: 'L’hai interrotta tu.',
  continueOrStop: 'Continuare o fermarsi?',
  optionContinue: 'Continua',
  optionStop: 'Ferma',
  stalledNoProgress: (p: { minutes: number }) => `Nessun progresso da ${minutes(p.minutes)}.`,
  stalledJobHung: (p: { job: string }) => `${p.job} non dà segni di vita da molto più tempo del previsto.`,
  stalledBudget: 'Questa attività ha usato l’80% del suo budget.',
  interruptedOnExit: 'Interrotta all’ultima chiusura di BaoCut.',
  threadLost: 'Il thread di questa attività non si trova.',
  agentUnavailable: (p: { agent: string }) => `${p.agent} non è disponibile al momento, quindi questa attività non è partita. Controllalo nelle impostazioni, poi continua.`,
  needsYouToRun: (p: { agent: string }) => `Questo passaggio richiede la tua presenza: ${p.agent} non può chiedere l’approvazione passo per passo. Continuare ora?`,
  approvalWaiting: (p: { summary: string }) => `In attesa della tua approvazione: ${p.summary}`,
  youAnswered: (p: { text: string }) => `Hai risposto: ${p.text}`,
  youConfirmedDone: 'Hai confermato che è completata.',
  youReopened: 'Hai riaperto questa attività.',
  previousQuestion: (p: { text: string }) => `Domanda precedente: ${p.text}`,
  implicitReopenNote: (p: { what: string }) => `Il thread ha modificato ${p.what} dopo che l’attività era stata risolta.`,
  movedFrom: (p: { channel: string }) => `Spostata da ${p.channel}.`,
  queued: (p: { position: number }) => `In attesa di un posto libero (n. ${p.position}).`,
  revertUserEdits: (p: { video: string; version: number }) =>
    `Hai modificato ${p.video} nella versione ${p.version}, quindi non è possibile annullare solo le modifiche dell’agente.`,
  revertMixedVersion: (p: { video: string; version: number }) =>
    `La versione ${p.version} di ${p.video} mescola le tue modifiche con quelle dell’agente, quindi non è possibile annullare solo le modifiche dell’agente.`,

  // ---- 频道对话里 Runtime 写的 ----
  fallbackRelay: (p: { title: string; headline: string }) => `${p.title}: ${p.headline}`,
  reminder: (p: { title: string }) => `Promemoria: ${p.title}`,
  reminderOverdue: (p: { title: string; date: string }) => `${p.title} era da completare entro il ${p.date}. È ancora aperta.`,
  reminderStale: (p: { title: string; days: number }) =>
    `${p.title} ti aspetta da ${p.days} ${pluralForm('it', p.days, { one: 'giorno', other: 'giorni' })}.`,
  welcome:
    'Ciao, sono il tuo assistente qui. Dimmi cosa vuoi fare con i tuoi video e me ne occupo io. Ti avviserò quando qualcosa avrà bisogno di te.',
  welcomeWithProjects: (p: { projects: number; videos: number }) =>
    `Ciao, sono il tuo assistente qui. Vedo ${p.projects} ${pluralForm('it', p.projects, { one: 'progetto', other: 'progetti' })} con ${p.videos} video. Dimmi cosa vuoi fare e me ne occupo io.`,
  starterSummarize: 'Riassumi un video',
  starterSummarizeText: 'Riassumi il mio video più recente',
  starterCaptions: 'Aggiungi sottotitoli',
  starterCaptionsText: 'Aggiungi i sottotitoli al mio video più recente',
  starterHighlights: 'Trova i momenti salienti',
  starterHighlightsText: 'Trova i momenti migliori del mio video più recente',
  markDone: 'Segna come completata',
  handoffDriver: (p: { agent: string }) => `Si continua con ${p.agent}.`,
  editedMessage: 'Hai modificato questo messaggio.',
  reactionYes: 'Sì',
  reactionNo: 'No',
  approvalNeedsYou: 'C’è un’approvazione che ti aspetta.',
  makeNoGenerator: 'Non è configurato alcun modello di testo, quindi i suggerimenti non sono disponibili.',
  scheduleNotReady: 'Le attività programmate non sono disponibili al momento.',
  proposalChannelExists: 'Esiste già un canale con questo nome.',
  dependencyWaiting: (p: { title: string }) => `In attesa di «${p.title}».`,
  lateStart: (p: { minutes: number }) => `Avviata con ${minutes(p.minutes)} di ritardo.`,

  // ---- 通知 ----
  notifyNeedsReview: (p: { title: string }) => `${p.title} è pronta per la tua revisione`,
  notifyNeedsInput: (p: { title: string }) => `${p.title} ha bisogno della tua risposta`,
  notifyStalled: (p: { title: string }) => `${p.title} è bloccata`,
  notifyReminder: (p: { title: string }) => `Promemoria: ${p.title}`,

  // ---- 提议 ----
  proposalNotFound: 'Questa scheda non è più disponibile.',
  proposalHandled: 'Questa scheda è già stata gestita.',
  chipStale: 'Questi suggerimenti non sono più aggiornati.',
  userOnly: 'Solo l’utente può farlo.',
  notReady: 'La modalità Bot non è ancora pronta.',
  automationPaused: 'L’automazione è in pausa.',
};
