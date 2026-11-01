import { pluralForm } from '../../i18n.ts';
import type { RcBotMessages } from './rc-bot.ts';

const minutes = (n: number) => `${n} ${pluralForm('pt-BR', n, { one: 'minuto', other: 'minutos' })}`;

export const ptBR: RcBotMessages = {
  // ---- 频道 ----
  mainChannelName: 'Tudo',
  channelNotFound: (p: { id: string }) => `Canal não encontrado: ${p.id}`,
  mainChannelLocked: 'O canal padrão não pode ser arquivado nem excluído.',
  channelArchived: 'Este canal está arquivado. Restaure-o para continuar trabalhando aqui.',
  channelDeleteCountsChanged: 'O número de tarefas ou tarefas agendadas neste canal mudou. Confira de novo antes de excluir.',
  memoryVersionConflict: 'A memória mudou desde que você a abriu. Veja a versão mais recente e tente de novo.',
  memoryTooLarge: (p: { max: number }) => `A memória pode ter no máximo ${p.max} KB. Organize-a antes de adicionar mais.`,
  memorySensitive: 'Não coloque chaves, senhas, números de documentos ou de cartões na memória.',
  accessAboveChannelMax: 'O modo de acesso da tarefa não pode ser maior que o limite do canal.',

  // ---- 任务 ----
  workItemNotFound: (p: { id: string }) => `Tarefa não encontrada: ${p.id}`,
  workItemCursorInvalid: 'A posição na lista de tarefas não é válida. Carregue a lista novamente.',
  transitionDenied: (p: { from: string; event: string }) => `Esta tarefa não pode fazer "${p.event}" enquanto está em ${p.from}.`,
  textHasLinkOrNumber: 'O texto da tarefa não deve ter links, endereços de e-mail nem números longos. Coloque-os nos recursos.',
  titleByUser: 'Você escreveu este título, então o agente não pode alterá-lo.',
  userTasksNoThread: 'Suas próprias tarefas não iniciam um fio.',
  stoppedByYou: 'Você interrompeu isto.',
  continueOrStop: 'Continuar ou parar?',
  optionContinue: 'Continuar',
  optionStop: 'Parar',
  stalledNoProgress: (p: { minutes: number }) => `Sem progresso há ${minutes(p.minutes)}.`,
  stalledJobHung: (p: { job: string }) => `${p.job} está sem dar sinal há muito mais tempo do que o esperado.`,
  stalledBudget: 'Esta tarefa já usou 80% do orçamento.',
  interruptedOnExit: 'Interrompida quando o BaoCut foi fechado pela última vez.',
  threadLost: 'O fio desta tarefa sumiu.',
  agentUnavailable: (p: { agent: string }) => `${p.agent} não está disponível agora, então esta tarefa não pôde rodar. Confira nas Configurações e depois continue.`,
  needsYouToRun: (p: { agent: string }) => `Esta etapa precisa de você presente: ${p.agent} não pode pedir aprovação passo a passo. Continuar agora?`,
  approvalWaiting: (p: { summary: string }) => `Aguardando sua aprovação: ${p.summary}`,
  youAnswered: (p: { text: string }) => `Você respondeu: ${p.text}`,
  youConfirmedDone: 'Você confirmou que está concluída.',
  youReopened: 'Você reabriu esta tarefa.',
  previousQuestion: (p: { text: string }) => `Pergunta anterior: ${p.text}`,
  implicitReopenNote: (p: { what: string }) => `O fio alterou ${p.what} depois que a tarefa foi resolvida.`,
  movedFrom: (p: { channel: string }) => `Movida de ${p.channel}.`,
  queued: (p: { position: number }) => `Aguardando uma vaga livre (nº ${p.position}).`,
  revertUserEdits: (p: { video: string; version: number }) =>
    `Você editou ${p.video} na versão ${p.version}, então não é possível desfazer só as alterações do agente.`,
  revertMixedVersion: (p: { video: string; version: number }) =>
    `A versão ${p.version} de ${p.video} mistura suas edições com as do agente, então não é possível desfazer só as alterações do agente.`,

  // ---- 频道对话里 Runtime 写的 ----
  fallbackRelay: (p: { title: string; headline: string }) => `${p.title}: ${p.headline}`,
  reminder: (p: { title: string }) => `Lembrete: ${p.title}`,
  reminderOverdue: (p: { title: string; date: string }) => `O prazo de ${p.title} era ${p.date}. Ainda está em aberto.`,
  reminderStale: (p: { title: string; days: number }) =>
    `${p.title} está esperando por você há ${p.days} ${pluralForm('pt-BR', p.days, { one: 'dia', other: 'dias' })}.`,
  welcome:
    'Diga o que você quer fazer com seus vídeos que eu cuido disso, e aviso quando algo precisar de você.',
  welcomeWithProjects: (p: { projects: number; videos: number }) =>
    `Estou vendo ${p.projects} ${pluralForm('pt-BR', p.projects, { one: 'projeto', other: 'projetos' })} com ${p.videos} ${pluralForm('pt-BR', p.videos, { one: 'vídeo', other: 'vídeos' })}. Diga o que você quer fazer que eu cuido disso.`,
  starterSummarize: 'Resumir um vídeo',
  starterSummarizeText: 'Resuma meu vídeo mais recente',
  starterCaptions: 'Adicionar legendas',
  starterCaptionsText: 'Adicione legendas ao meu vídeo mais recente',
  starterHighlights: 'Encontrar destaques',
  starterHighlightsText: 'Encontre os melhores momentos do meu vídeo mais recente',
  channelIntro: (p: { name: string; purpose: string }) => `Este canal é para: ${p.purpose}. Diga o que fazer aqui, e eu mantenho o trabalho neste canal.`,
  channelIntroNoPurpose: (p: { name: string }) => `Este é o canal ${p.name}. Diga para que ele serve e por onde começar.`,
  starterChannelPlan: 'Sugerir primeiras tarefas',
  starterChannelPlanText: (p: { subject: string }) => `Sugira as primeiras tarefas para: ${p.subject}`,
  starterChannelLatest: 'Usar meu vídeo mais recente',
  starterChannelLatestText: (p: { subject: string }) => `Use meu vídeo mais recente para: ${p.subject}`,
  starterChannelGoal: 'Contar mais',
  starterChannelGoalText: 'Mais sobre para que serve este canal: ',
  markDone: 'Marcar como concluída',
  handoffDriver: (p: { agent: string }) => `Continuando com ${p.agent}.`,
  editedMessage: 'Você editou esta mensagem.',
  reactionYes: 'Sim',
  reactionNo: 'Não',
  approvalNeedsYou: 'Há uma aprovação esperando por você.',
  makeNoGenerator: 'Nenhum modelo de texto está configurado, então as sugestões não estão disponíveis.',
  scheduleNotReady: 'As tarefas agendadas não estão disponíveis agora.',
  proposalChannelExists: 'Já existe um canal com este nome.',
  dependencyWaiting: (p: { title: string }) => `Aguardando "${p.title}".`,
  lateStart: (p: { minutes: number }) => `Começou com ${minutes(p.minutes)} de atraso.`,

  // ---- 通知 ----
  notifyNeedsReview: (p: { title: string }) => `${p.title} está pronta para sua revisão`,
  notifyNeedsInput: (p: { title: string }) => `${p.title} precisa da sua resposta`,
  notifyStalled: (p: { title: string }) => `${p.title} está travada`,
  notifyReminder: (p: { title: string }) => `Lembrete: ${p.title}`,

  // ---- 提议 ----
  proposalNotFound: 'Este cartão não está mais disponível.',
  proposalHandled: 'Este cartão já foi tratado.',
  chipStale: 'Estas sugestões estão desatualizadas.',
  userOnly: 'Só o usuário pode fazer isso.',
  notReady: 'O modo Bot ainda não está pronto.',
  automationPaused: 'A automação está pausada.',
};
