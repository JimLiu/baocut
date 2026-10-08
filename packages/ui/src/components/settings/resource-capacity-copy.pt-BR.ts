import type { ResourceCapacityMessages } from './resource-capacity-copy.ts';

export const ptBR: ResourceCapacityMessages = {
  title: 'Agendamento de recursos',
  resetAll: 'Redefinir tudo para automático',
  lead: 'Tarefas pesadas como transcrição, modelos locais e exportações entram na fila conforme a capacidade deste computador: começam quando cabem e, caso contrário, esperam as anteriores terminarem. A capacidade é detectada automaticamente. Se este computador também executa outros programas grandes ou a detecção não é precisa, você pode definir um limite manualmente; deixe vazio para automático.',
  disconnected: 'Não conectado ao Runtime',
  loadFailed: 'Não foi possível ler o estado dos recursos',
  loading: 'Lendo estado dos recursos…',
  limitOf: (label: string, unit: string) => `Limite de ${label} (${unit})`,
  unit: { memoryGB: 'GB', gpuMemoryGB: 'GB', cpuThreads: 'threads' },
  notSettable: 'Não pode ser definido manualmente',
  inUseAndQueued: 'Em uso e na fila',
  inUse: (demand: string) => `Em uso · ${demand}`,
  queued: (detail: string | null, demand: string) => `Na fila · ${detail ?? 'Aguardando início'} · Precisa de ${demand}`,
  idle: 'Nenhuma tarefa está usando recursos locais',
  saveFailed: (message: string) => `Não foi possível salvar: ${message}`,
};
