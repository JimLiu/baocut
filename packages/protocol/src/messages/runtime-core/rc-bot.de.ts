import { pluralForm } from '../../i18n.ts';
import type { RcBotMessages } from './rc-bot.ts';

const minutes = (n: number) => `${n} ${pluralForm('de', n, { one: 'Minute', other: 'Minuten' })}`;

export const de: RcBotMessages = {
  // ---- 频道 ----
  mainChannelName: 'Hauptkanal',
  channelNotFound: (p: { id: string }) => `Kanal nicht gefunden: ${p.id}`,
  mainChannelLocked: 'Der Hauptkanal kann nicht archiviert oder gelöscht werden.',
  channelArchived: 'Dieser Kanal ist archiviert. Stelle ihn wieder her, um hier weiterzuarbeiten.',
  channelDeleteCountsChanged: 'Die Anzahl der Aufgaben oder geplanten Aufgaben in diesem Kanal hat sich geändert. Prüfe sie noch einmal, bevor du löschst.',
  memoryVersionConflict: 'Das Gedächtnis wurde geändert, seit du es geöffnet hast. Sieh dir die neueste Version an und versuche es erneut.',
  memoryTooLarge: (p: { max: number }) => `Das Gedächtnis darf höchstens ${p.max} KB groß sein. Räume es auf, bevor du mehr hinzufügst.`,
  memorySensitive: 'Lege keine Schlüssel, Passwörter, Ausweis- oder Kartennummern im Gedächtnis ab.',
  accessAboveChannelMax: 'Der Zugriffsmodus der Aufgabe darf nicht höher sein als die Grenze des Kanals.',

  // ---- 任务 ----
  workItemNotFound: (p: { id: string }) => `Aufgabe nicht gefunden: ${p.id}`,
  transitionDenied: (p: { from: string; event: string }) => `Diese Aufgabe kann „${p.event}“ im Zustand ${p.from} nicht ausführen.`,
  textHasLinkOrNumber: 'Aufgabentexte sollten keine Links, E-Mail-Adressen oder langen Zahlen enthalten. Lege sie stattdessen unter Ressourcen ab.',
  titleByUser: 'Diesen Titel hast du geschrieben, deshalb kann der Agent ihn nicht ändern.',
  userTasksNoThread: 'Deine eigenen Aufgaben starten keinen Thread.',
  stoppedByYou: 'Du hast das gestoppt.',
  continueOrStop: 'Weitermachen oder stoppen?',
  optionContinue: 'Weitermachen',
  optionStop: 'Stoppen',
  stalledNoProgress: (p: { minutes: number }) => `Seit ${minutes(p.minutes)} kein Fortschritt.`,
  stalledJobHung: (p: { job: string }) => `${p.job} meldet sich schon viel länger nicht mehr als erwartet.`,
  stalledBudget: 'Diese Aufgabe hat 80 % ihres Budgets verbraucht.',
  interruptedOnExit: 'Beim letzten Beenden von BaoCut unterbrochen.',
  threadLost: 'Der Thread dieser Aufgabe fehlt.',
  needsYouToRun: (p: { agent: string }) => `Für diesen Schritt musst du dabei sein: ${p.agent} kann nicht schrittweise um Freigabe bitten. Jetzt weitermachen?`,
  approvalWaiting: (p: { summary: string }) => `Wartet auf deine Freigabe: ${p.summary}`,
  youAnswered: (p: { text: string }) => `Deine Antwort: ${p.text}`,
  youConfirmedDone: 'Du hast bestätigt, dass es erledigt ist.',
  youReopened: 'Du hast diese Aufgabe wieder geöffnet.',
  previousQuestion: (p: { text: string }) => `Frühere Frage: ${p.text}`,
  implicitReopenNote: (p: { what: string }) => `Der Thread hat ${p.what} geändert, nachdem die Aufgabe abgeschlossen war.`,
  movedFrom: (p: { channel: string }) => `Aus ${p.channel} verschoben.`,
  queued: (p: { position: number }) => `Wartet auf einen freien Platz (Nr. ${p.position}).`,
  revertUserEdits: (p: { video: string; version: number }) =>
    `Du hast ${p.video} in Version ${p.version} bearbeitet, daher lassen sich nicht nur die Änderungen des Agenten rückgängig machen.`,
  revertMixedVersion: (p: { video: string; version: number }) =>
    `Version ${p.version} von ${p.video} enthält deine Änderungen und die des Agenten, daher lassen sich nicht nur die Änderungen des Agenten rückgängig machen.`,

  // ---- 频道对话里 Runtime 写的 ----
  fallbackRelay: (p: { title: string; headline: string }) => `${p.title}: ${p.headline}`,
  reminder: (p: { title: string }) => `Erinnerung: ${p.title}`,
  reminderOverdue: (p: { title: string; date: string }) => `${p.title} war am ${p.date} fällig und ist noch offen.`,
  reminderStale: (p: { title: string; days: number }) =>
    `${p.title} wartet seit ${p.days} ${pluralForm('de', p.days, { one: 'Tag', other: 'Tagen' })} auf dich.`,
  welcome:
    'Hallo, ich bin hier dein Assistent. Sag mir, was mit deinen Videos passieren soll, und ich kümmere mich darum. Wenn ich dich brauche, melde ich mich.',
  welcomeWithProjects: (p: { projects: number; videos: number }) =>
    `Hallo, ich bin hier dein Assistent. Ich sehe ${p.projects} ${pluralForm('de', p.projects, { one: 'Projekt', other: 'Projekte' })} mit ${p.videos} ${pluralForm('de', p.videos, { one: 'Video', other: 'Videos' })}. Sag mir, was zu tun ist, und ich kümmere mich darum.`,
  starterSummarize: 'Video zusammenfassen',
  starterSummarizeText: 'Fasse mein neuestes Video für mich zusammen',
  starterCaptions: 'Untertitel hinzufügen',
  starterCaptionsText: 'Füge meinem neuesten Video Untertitel hinzu',
  starterHighlights: 'Highlights finden',
  starterHighlightsText: 'Finde die besten Momente in meinem neuesten Video',
  markDone: 'Als erledigt markieren',
  handoffDriver: (p: { agent: string }) => `Weiter mit ${p.agent}.`,
  editedMessage: 'Du hast diese Nachricht bearbeitet.',
  reactionYes: 'Ja',
  reactionNo: 'Nein',
  approvalNeedsYou: 'Eine Freigabe wartet auf dich.',
  makeNoGenerator: 'Es ist kein Textmodell eingerichtet, daher sind keine Vorschläge verfügbar.',
  scheduleNotReady: 'Geplante Aufgaben sind gerade nicht verfügbar.',
  proposalChannelExists: 'Es gibt bereits einen Kanal mit diesem Namen.',
  dependencyWaiting: (p: { title: string }) => `Wartet auf „${p.title}“.`,
  lateStart: (p: { minutes: number }) => `Mit ${minutes(p.minutes)} Verspätung gestartet.`,

  // ---- 通知 ----
  notifyNeedsReview: (p: { title: string }) => `${p.title} ist bereit zur Durchsicht`,
  notifyNeedsInput: (p: { title: string }) => `${p.title} braucht deine Antwort`,
  notifyStalled: (p: { title: string }) => `${p.title} kommt nicht weiter`,
  notifyReminder: (p: { title: string }) => `Erinnerung: ${p.title}`,

  // ---- 提议 ----
  proposalNotFound: 'Diese Karte ist nicht mehr verfügbar.',
  proposalHandled: 'Diese Karte wurde bereits bearbeitet.',
  chipStale: 'Diese Vorschläge sind veraltet.',
  userOnly: 'Das kann nur der Nutzer selbst tun.',
  notReady: 'Der Bot-Modus ist noch nicht bereit.',
  automationPaused: 'Die Automatisierung ist pausiert.',
};
