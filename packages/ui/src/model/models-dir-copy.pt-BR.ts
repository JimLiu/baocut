import type { ModelsDirMessages } from './models-dir-copy.ts';

import { pluralForm } from '@baocut/protocol';
const and = (items: readonly string[]) => new Intl.ListFormat('pt-BR', { type: 'conjunction' }).format(items);
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const models = (n: number) => `${n} ${pluralForm('pt-BR', n, { one: 'modelo', other: 'modelos' })}`;

export const ptBR: ModelsDirMessages = {

  dir: {
    title: "Pasta de modelos",
    defaultChip: "Padrão",
    envChip: "Variável de ambiente",
    change: "Alterar…",
    restore: "Redefinir",
    envNote: "Definida por BAOCUT_MODELS_DIR. Altere a variável e reinicie para mudar.",
    shareHint:
      "Se outros aplicativos compartilham a pasta, excluir modelo remove os arquivos para eles também.",
    blockedPrefix: "Não pode alterar agora:",
    viewTasks: "Ver tarefas",
    changeTitle: "Mudar pasta de modelos",
    restoreTitle: "Restaurar local padrão",
    restoreLead: "Restaurar pasta para",
    checking: "Verificando pasta…",
    cancel: "Cancelar",
    howTo: "O que fazer com modelos existentes",
    moveOption: "Mover modelos existentes",
    switchOption: "Alterar apenas o local",
    confirmMove: "Mover e alterar",
    confirmSwitch: "Mudar local",
    movingLabel: "Movendo modelos",
    stayOpen: "Não saia do BaoCut enquanto move",
    missingDir:
      "Pasta inexistente, pode ser disco externo desconectado. Conecte para funcionar ou escolha outra.",
    notWritableDir: "Sem permissão de gravação; não pode baixar modelos aqui.",
    loading: "Lendo pasta de modelos…",
    pickFailed: (message: string) => `Não foi possível escolher pasta: ${message}`,
    same: "Já é a pasta atual",
  },

  stats: (used: string, free: string | null, count: number) =>
    [`${used} usados`, ...(free !== null ? [`${free} livres no disco`] : []), `${models(count)} encontrados`].join(" · "),

  blocker: (downloading: readonly string[], testing: readonly string[], tasks: number) => {
    const parts: string[] = [];
    if (downloading.length) parts.push(`baixando ${and(downloading)}`);
    if (testing.length) parts.push(`verificando ${and(testing)}`);
    if (tasks) parts.push(`${tasks} ${pluralForm('pt-BR', tasks, { one: "tarefa está", other: "tarefas estão" })} usando modelos locais`);
    return `${capitalize(parts.join("; "))}. Espere concluírem antes de mudar para não mover arquivos usados.`;
  },
  missingTitle: "Pasta não encontrada",
  missingText: "Pasta inexistente, disco externo pode estar desconectado. Conecte e escolha novamente.",
  notWritableTitle: "Pasta não gravável",
  notWritableText:
    "Sem permissão, modelos não podem ser baixados. Escolha pasta gravável ou altere permissões.",
  nestedTitle: "Não pode colocar aqui",
  nestedText:
    "Pastas atual e nova contidas uma na outra. Escolha uma que não contenha nem esteja na outra.",

  found: (count: number, bytes: string, free: string | null) =>
    `${
      count
        ? `Encontrados ${count} baixados ${pluralForm('pt-BR', count, { one: "modelo", other: "modelos" })} (${bytes}), prontos para usar.`
        : "Ainda sem modelos aqui; próximos downloads virão aqui."
    }${free !== null ? ` ${free} livres no disco.` : ""}`,
  moveNoFit: (required: string, free: string, short: string) =>
    `Mover exige ${required}, disco de destino só tem ${free} livres (${short} faltando). Não cabe.`,
  moveSameVolume: (size: string) => `Move ${size} no mesmo disco, rápido. Arquivos não ficam no local antigo.`,
  moveOther: (size: string) => `Move ${size}. Arquivos não ficam no local antigo.`,

  switchDescription: (count: number) =>
    `Arquivos antigos mantidos, não excluídos. Só os ${count ? `${models(count)} ` : "modelos "}já no novo local utilizáveis; restantes marcados não instalados.`,
  appliedMoving: (where: string) => `Movimento iniciado para ${where}`,
  appliedKept: (where: string) => `Pasta alterada para ${where} · arquivos antigos mantidos`,
  applied: (where: string) => `Pasta alterada para ${where}`,

  moveWaiting: (to: string | null) => `Aguardando início do movimento${to ? ` a ${to}` : ""}…`,
  moveValidating: (amount: string | null) => `Verificando arquivos copiados${amount ? ` (${amount})` : ""}…`,
  movePublishing: "Concluindo movimento…",
  moving: (amount: string | null, to: string | null) => `Movendo${amount ? ` ${amount}` : ""}${to ? ` a ${to}` : ""}…`,
};
