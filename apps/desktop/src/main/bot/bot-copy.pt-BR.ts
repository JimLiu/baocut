import { pluralForm } from '@baocut/protocol';
import type { BotMessages } from './bot-copy.ts';

export const ptBR: BotMessages = {
  trayOpen: 'Abrir o BaoCut',
  trayWorking: (count: number) => `Tarefas em andamento (${count})`,
  trayNoWorking: 'Nenhuma tarefa em andamento',
  trayPause: 'Pausar toda a automação',
  trayResume: 'Retomar a automação',
  trayQuit: 'Sair do serviço em segundo plano',
  trayTooltip: 'Serviço em segundo plano do BaoCut',
  trayTooltipNeedsYou: (count: number) =>
    pluralForm('pt-BR', count, { one: `BaoCut: ${count} item espera por você`, other: `BaoCut: ${count} itens esperam por você` }),
  trayTooltipPaused: 'BaoCut: automação pausada',
  notifyMerged: (count: number, channel: string) => `${count} itens esperam por você em ${channel}`,
  notifySummary: (count: number) =>
    pluralForm('pt-BR', count, {
      one: `${count} item esperou por você durante a noite`,
      other: `${count} itens esperaram por você durante a noite`,
    }),
  notifyReason: {
    'needs-review': 'Pronta para sua revisão',
    'needs-input': 'Precisa da sua resposta',
    reminder: 'Lembrete',
    'unattended-approval': 'Aguardando sua aprovação',
    stalled: 'Parou e precisa de atenção',
  },
  residentQuitTitle: 'O Bot continua trabalhando em segundo plano',
  residentQuitDetailMac:
    'Ao fechar o BaoCut, ele continua executando tarefas agendadas e em andamento pela barra de menus. Saia completamente para parar tudo.',
  residentQuitDetailOther:
    'Ao fechar o BaoCut, ele continua executando tarefas agendadas e em andamento pela área de notificação. Saia completamente para parar tudo.',
  residentKeep: 'Manter em segundo plano',
  residentQuit: 'Sair completamente',
  quitServiceTitle: 'Sair do serviço em segundo plano?',
  quitServiceDetail:
    'O Bot para até você abrir o BaoCut de novo. Tarefas agendadas que vencerem nesse meio-tempo são registradas como perdidas.',
  quitServiceThreads: (count: number) =>
    pluralForm('pt-BR', count, { one: 'Esta tarefa em andamento vai parar:', other: `Estas ${count} tarefas em andamento vão parar:` }),
  quitServiceSchedules: (count: number) =>
    pluralForm('pt-BR', count, { one: 'Esta tarefa agendada não vai rodar:', other: `Estas ${count} tarefas agendadas não vão rodar:` }),
  quitServiceScheduleLine: (name: string, at: string) => `${name} · ${at}`,
  quitServiceConfirm: 'Sair do serviço em segundo plano',
  more: (count: number) => `e mais ${count}`,
  cancel: 'Cancelar',
};
