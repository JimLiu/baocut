import { pluralForm } from '../../i18n.ts';
import type { RcBotMessages } from './rc-bot.ts';

const minutes = (n: number) => `${n} ${pluralForm('es', n, { one: 'minuto', other: 'minutos' })}`;

export const es: RcBotMessages = {
  // ---- 频道 ----
  mainChannelName: 'Principal',
  channelNotFound: (p: { id: string }) => `No se encontró el canal: ${p.id}`,
  mainChannelLocked: 'El canal principal no se puede archivar ni eliminar.',
  channelArchived: 'Este canal está archivado. Restáuralo para seguir trabajando aquí.',
  channelDeleteCountsChanged: 'Cambió el número de tareas o tareas programadas de este canal. Vuelve a revisarlo antes de eliminarlo.',
  memoryVersionConflict: 'La memoria cambió desde que la abriste. Revisa la versión más reciente e inténtalo de nuevo.',
  memoryTooLarge: (p: { max: number }) => `La memoria puede ocupar como máximo ${p.max} KB. Ordénala antes de añadir más.`,
  memorySensitive: 'No guardes claves, contraseñas, números de identificación ni números de tarjeta en la memoria.',
  accessAboveChannelMax: 'El modo de acceso de la tarea no puede superar el límite del canal.',

  // ---- 任务 ----
  workItemNotFound: (p: { id: string }) => `No se encontró la tarea: ${p.id}`,
  transitionDenied: (p: { from: string; event: string }) => `Esta tarea no puede hacer «${p.event}» mientras está en ${p.from}.`,
  textHasLinkOrNumber: 'El texto de la tarea no debe incluir enlaces, direcciones de correo ni números largos. Ponlos en los recursos.',
  titleByUser: 'Tú escribiste este título, así que el agente no puede cambiarlo.',
  userTasksNoThread: 'Tus propias tareas no inician un hilo.',
  stoppedByYou: 'Detuviste esto.',
  continueOrStop: '¿Seguir o detener?',
  optionContinue: 'Seguir',
  optionStop: 'Detener',
  stalledNoProgress: (p: { minutes: number }) => `Sin avances desde hace ${minutes(p.minutes)}.`,
  stalledJobHung: (p: { job: string }) => `${p.job} lleva sin responder mucho más tiempo de lo esperado.`,
  stalledBudget: 'Esta tarea ha usado el 80 % de su presupuesto.',
  interruptedOnExit: 'Se interrumpió la última vez que se cerró BaoCut.',
  threadLost: 'Falta el hilo de esta tarea.',
  needsYouToRun: (p: { agent: string }) => `Este paso necesita que estés presente: ${p.agent} no puede pedir aprobación paso a paso. ¿Seguir ahora?`,
  approvalWaiting: (p: { summary: string }) => `Esperando tu aprobación: ${p.summary}`,
  youAnswered: (p: { text: string }) => `Respondiste: ${p.text}`,
  youConfirmedDone: 'Confirmaste que está terminada.',
  youReopened: 'Reabriste esta tarea.',
  previousQuestion: (p: { text: string }) => `Pregunta anterior: ${p.text}`,
  implicitReopenNote: (p: { what: string }) => `El hilo cambió ${p.what} después de que se resolviera la tarea.`,
  movedFrom: (p: { channel: string }) => `Movida desde ${p.channel}.`,
  queued: (p: { position: number }) => `Esperando un hueco libre (n.º ${p.position}).`,
  revertUserEdits: (p: { video: string; version: number }) =>
    `Editaste ${p.video} en la versión ${p.version}, así que no es posible deshacer solo los cambios del agente.`,
  revertMixedVersion: (p: { video: string; version: number }) =>
    `La versión ${p.version} de ${p.video} mezcla tus ediciones con las del agente, así que no es posible deshacer solo los cambios del agente.`,

  // ---- 频道对话里 Runtime 写的 ----
  fallbackRelay: (p: { title: string; headline: string }) => `${p.title}: ${p.headline}`,
  reminder: (p: { title: string }) => `Recordatorio: ${p.title}`,
  reminderOverdue: (p: { title: string; date: string }) => `${p.title} vencía el ${p.date}. Sigue abierta.`,
  reminderStale: (p: { title: string; days: number }) =>
    `${p.title} lleva ${p.days} ${pluralForm('es', p.days, { one: 'día', other: 'días' })} esperándote.`,
  welcome:
    'Hola, soy tu asistente aquí. Dime qué quieres hacer con tus vídeos y me encargo yo. Te avisaré cuando algo te necesite.',
  welcomeWithProjects: (p: { projects: number; videos: number }) =>
    `Hola, soy tu asistente aquí. Veo ${p.projects} ${pluralForm('es', p.projects, { one: 'proyecto', other: 'proyectos' })} con ${p.videos} ${pluralForm('es', p.videos, { one: 'vídeo', other: 'vídeos' })}. Dime qué quieres hacer y me encargo yo.`,
  starterSummarize: 'Resumir un vídeo',
  starterSummarizeText: 'Resume mi vídeo más reciente',
  starterCaptions: 'Añadir subtítulos',
  starterCaptionsText: 'Añade subtítulos a mi vídeo más reciente',
  starterHighlights: 'Buscar momentos destacados',
  starterHighlightsText: 'Encuentra los mejores momentos de mi vídeo más reciente',
  markDone: 'Marcar como terminada',
  handoffDriver: (p: { agent: string }) => `Continuando con ${p.agent}.`,
  editedMessage: 'Editaste este mensaje.',
  reactionYes: 'Sí',
  reactionNo: 'No',
  approvalNeedsYou: 'Hay una aprobación esperándote.',
  makeNoGenerator: 'No hay ningún modelo de texto configurado, así que las sugerencias no están disponibles.',
  scheduleNotReady: 'Las tareas programadas no están disponibles en este momento.',
  proposalChannelExists: 'Ya existe un canal con este nombre.',
  dependencyWaiting: (p: { title: string }) => `Esperando a «${p.title}».`,
  lateStart: (p: { minutes: number }) => `Empezó con ${minutes(p.minutes)} de retraso.`,

  // ---- 通知 ----
  notifyNeedsReview: (p: { title: string }) => `${p.title} está lista para que la revises`,
  notifyNeedsInput: (p: { title: string }) => `${p.title} necesita tu respuesta`,
  notifyStalled: (p: { title: string }) => `${p.title} está atascada`,
  notifyReminder: (p: { title: string }) => `Recordatorio: ${p.title}`,

  // ---- 提议 ----
  proposalNotFound: 'Esta tarjeta ya no está disponible.',
  proposalHandled: 'Esta tarjeta ya se gestionó.',
  chipStale: 'Estas sugerencias están desactualizadas.',
  userOnly: 'Solo el usuario puede hacer esto.',
  notReady: 'El modo Bot aún no está listo.',
  automationPaused: 'La automatización está en pausa.',
};
