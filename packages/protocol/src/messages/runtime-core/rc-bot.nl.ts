import { pluralForm } from '../../i18n.ts';
import type { RcBotMessages } from './rc-bot.ts';

const minutes = (n: number) => `${n} ${pluralForm('nl', n, { one: 'minuut', other: 'minuten' })}`;

export const nl: RcBotMessages = {
  // ---- 频道 ----
  mainChannelName: 'Alles',
  channelNotFound: (p: { id: string }) => `Kanaal niet gevonden: ${p.id}`,
  groupNotFound: (p: { id: string }) => `Groep niet gevonden: ${p.id}`,
  mainChannelLocked: 'Het standaardkanaal kan niet worden gearchiveerd of verwijderd.',
  channelArchived: 'Dit kanaal is gearchiveerd. Herstel het om hier verder te werken.',
  channelDeleteCountsChanged: 'Het aantal taken of geplande taken in dit kanaal is veranderd. Controleer het opnieuw voordat je verwijdert.',
  memoryVersionConflict: 'Het geheugen is gewijzigd sinds je het opende. Bekijk de nieuwste versie en probeer het opnieuw.',
  memoryTooLarge: (p: { max: number }) => `Het geheugen mag maximaal ${p.max} KB zijn. Ruim het op voordat je meer toevoegt.`,
  memorySensitive: 'Zet geen sleutels, wachtwoorden, ID-nummers of kaartnummers in het geheugen.',
  accessAboveChannelMax: 'De toegangsmodus van de taak mag niet hoger zijn dan de limiet van het kanaal.',

  // ---- 任务 ----
  workItemNotFound: (p: { id: string }) => `Taak niet gevonden: ${p.id}`,
  workItemCursorInvalid: 'De positie in de takenlijst is ongeldig. Laad de lijst opnieuw.',
  transitionDenied: (p: { from: string; event: string }) => `Deze taak kan '${p.event}' niet uitvoeren in de status ${p.from}.`,
  textHasLinkOrNumber: 'Taaktekst mag geen links, e-mailadressen of lange nummers bevatten. Zet ze in plaats daarvan bij de bronnen.',
  titleByUser: 'Jij hebt deze titel geschreven, dus de agent kan hem niet wijzigen.',
  userTasksNoThread: 'Je eigen taken starten geen thread.',
  stoppedByYou: 'Je hebt dit gestopt.',
  continueOrStop: 'Doorgaan of stoppen?',
  optionContinue: 'Doorgaan',
  optionStop: 'Stoppen',
  stalledNoProgress: (p: { minutes: number }) => `Al ${minutes(p.minutes)} geen voortgang.`,
  stalledJobHung: (p: { job: string }) => `${p.job} laat al veel langer dan verwacht niets van zich horen.`,
  stalledBudget: 'Deze taak heeft 80% van zijn budget gebruikt.',
  interruptedOnExit: 'Onderbroken toen BaoCut de vorige keer werd afgesloten.',
  threadLost: 'De thread van deze taak ontbreekt.',
  agentUnavailable: (p: { agent: string }) => `${p.agent} is nu niet beschikbaar, dus deze taak kon niet draaien. Controleer het in Instellingen en ga dan verder.`,
  needsYouToRun: (p: { agent: string }) => `Voor deze stap moet je erbij zijn: ${p.agent} kan niet per stap om goedkeuring vragen. Nu doorgaan?`,
  approvalWaiting: (p: { summary: string }) => `Wacht op je goedkeuring: ${p.summary}`,
  youAnswered: (p: { text: string }) => `Je antwoordde: ${p.text}`,
  youConfirmedDone: 'Je hebt bevestigd dat het klaar is.',
  youReopened: 'Je hebt deze taak heropend.',
  previousQuestion: (p: { text: string }) => `Eerdere vraag: ${p.text}`,
  implicitReopenNote: (p: { what: string }) => `De thread heeft ${p.what} gewijzigd nadat de taak was afgerond.`,
  movedFrom: (p: { channel: string }) => `Verplaatst vanuit ${p.channel}.`,
  queued: (p: { position: number }) => `Wacht op een vrije plek (nr. ${p.position}).`,
  revertUserEdits: (p: { video: string; version: number }) =>
    `Je hebt ${p.video} in versie ${p.version} bewerkt, dus alleen de wijzigingen van de agent ongedaan maken is niet mogelijk.`,
  revertMixedVersion: (p: { video: string; version: number }) =>
    `Versie ${p.version} van ${p.video} bevat zowel jouw bewerkingen als die van de agent, dus alleen de wijzigingen van de agent ongedaan maken is niet mogelijk.`,

  // ---- 频道对话里 Runtime 写的 ----
  fallbackRelay: (p: { title: string; headline: string }) => `${p.title}: ${p.headline}`,
  reminder: (p: { title: string }) => `Herinnering: ${p.title}`,
  reminderOverdue: (p: { title: string; date: string }) => `${p.title} moest op ${p.date} af zijn en staat nog open.`,
  reminderStale: (p: { title: string; days: number }) =>
    `${p.title} wacht al ${p.days} ${pluralForm('nl', p.days, { one: 'dag', other: 'dagen' })} op je.`,
  welcome:
    'Vertel me wat je met je video’s wilt doen, dan regel ik het. Ik laat het je weten als iets jou nodig heeft.',
  welcomeWithProjects: (p: { projects: number; videos: number }) =>
    `Ik zie ${p.projects} ${pluralForm('nl', p.projects, { one: 'project', other: 'projecten' })} met ${p.videos} ${pluralForm('nl', p.videos, { one: 'video', other: 'video’s' })}. Vertel me wat je wilt doen, dan regel ik het.`,
  starterSummarize: 'Video samenvatten',
  starterSummarizeText: 'Vat mijn nieuwste video voor me samen',
  starterCaptions: 'Ondertitels toevoegen',
  starterCaptionsText: 'Voeg ondertitels toe aan mijn nieuwste video',
  starterHighlights: 'Hoogtepunten vinden',
  starterHighlightsText: 'Zoek de beste momenten in mijn nieuwste video',
  channelIntro: (p: { name: string; purpose: string }) => `Dit kanaal is voor: ${p.purpose}. Vertel me wat hier moet gebeuren; het werk blijft in dit kanaal.`,
  channelIntroNoPurpose: (p: { name: string }) => `Dit is het kanaal ${p.name}. Vertel me waarvoor het is en waarmee we beginnen.`,
  starterChannelPlan: 'Eerste taken voorstellen',
  starterChannelPlanText: (p: { subject: string }) => `Stel de eerste taken voor voor: ${p.subject}`,
  starterChannelLatest: 'Mijn nieuwste video gebruiken',
  starterChannelLatestText: (p: { subject: string }) => `Gebruik mijn nieuwste video voor: ${p.subject}`,
  starterChannelGoal: 'Meer vertellen',
  starterChannelGoalText: 'Meer over waar dit kanaal voor is: ',
  markDone: 'Markeren als klaar',
  handoffDriver: (p: { agent: string }) => `We gaan verder met ${p.agent}.`,
  editedMessage: 'Je hebt dit bericht bewerkt.',
  reactionYes: 'Ja',
  reactionNo: 'Nee',
  approvalNeedsYou: 'Er wacht een goedkeuring op je.',
  makeNoGenerator: 'Er is geen tekstmodel ingesteld, dus suggesties zijn niet beschikbaar.',
  scheduleNotReady: 'Geplande taken zijn nu niet beschikbaar.',
  proposalChannelExists: 'Er bestaat al een kanaal met deze naam.',
  dependencyWaiting: (p: { title: string }) => `Wacht op '${p.title}'.`,
  lateStart: (p: { minutes: number }) => `${minutes(p.minutes)} te laat gestart.`,

  // ---- 通知 ----
  notifyNeedsReview: (p: { title: string }) => `${p.title} is klaar om te bekijken`,
  notifyNeedsInput: (p: { title: string }) => `${p.title} heeft je antwoord nodig`,
  notifyStalled: (p: { title: string }) => `${p.title} zit vast`,
  notifyReminder: (p: { title: string }) => `Herinnering: ${p.title}`,

  // ---- 提议 ----
  proposalNotFound: 'Deze kaart is niet meer beschikbaar.',
  proposalHandled: 'Deze kaart is al afgehandeld.',
  chipStale: 'Deze suggesties zijn verouderd.',
  userOnly: 'Alleen de gebruiker kan dit doen.',
  notReady: 'De Bot-modus is nog niet klaar.',
  automationPaused: 'Automatisering is gepauzeerd.',
};
