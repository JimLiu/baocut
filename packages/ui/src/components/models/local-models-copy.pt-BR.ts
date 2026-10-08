import type { LocalModelsMessages } from './local-models-copy.ts';

export const ptBR: LocalModelsMessages = {
  install: {
    availableNote: 'Antes de baixar, você verá o tamanho do download e o espaço livre em disco. Você pode pausar; o que já foi baixado é mantido e será retomado na próxima vez.',
    download: 'Baixar', complete: 'Completar', downloadSize: (size: string) => `Baixar ${size}`, completeSize: (size: string) => `Completar ${size}`, resume: 'Retomar download', pause: 'Pausar', cancelDownload: 'Cancelar download', discard: 'Descartar arquivos baixados', repair: 'Reparar…', remove: 'Excluir…',
    more: (id: string) => `Mais · ${id}`, details: 'Detalhes', hideDetails: 'Ocultar detalhes',
    componentLine: (state: 'installed' | 'missing', size: string | null) => state === 'installed' ? `Instalado${size ? ` · ${size}` : ''}` : `Ausente${size ? ` · ${size}` : ''}`,
    sharedWith: (ids: string[]) => `Compartilhado com ${ids.join(', ')}`, noComponents: 'Este Runtime não informou detalhes dos componentes.',
    installTitle: (id: string) => `Baixar ${id}`, repairTitle: (id: string) => `Reparar “${id}”?`, completeTitle: (id: string) => `Completar ${id}`, planning: 'Calculando o que baixar…', verifying: 'Procurando arquivos danificados ou ausentes. Pode demorar com arquivos grandes…',
    planFailed: 'Não foi possível obter o plano de download', upToDate: 'Todos os arquivos estão presentes e verificados. Nada para baixar.', completeNote: 'O modelo já está instalado. Só os componentes opcionais que faltam são baixados; os arquivos instalados não são alterados.', repairUpToDate: 'Todos os arquivos estão intactos. Nada para baixar novamente.',
    repairThenCheck: 'Só arquivos danificados ou ausentes são baixados novamente; os intactos permanecem. A verificação é refeita automaticamente após o reparo.',
    replanned: 'O tamanho do download acabou de mudar. Este é o novo plano; confirme novamente.', source: (url: string) => `Fonte do download: ${url}`,
    confirmInstall: (size: string) => `Baixar ${size}`, confirmRepair: 'Reparar', cancel: 'Cancelar', close: 'Fechar',
    started: (id: string) => `Baixando ${id} · o progresso aparece nesta linha e em Tarefas em segundo plano`,
    paused: (id: string) => `Pausado: ${id} · o que já foi baixado é mantido`,
    discardTitle: (id: string) => `Descartar a parte baixada de ${id}?`,
    discardBody: 'O próximo download começa do zero. Arquivos que outros pacotes de modelo estão baixando e componentes compartilhados não são excluídos.',
    discarded: (id: string) => `Parte baixada descartada: ${id}`, removeTitle: (id: string) => `Excluir ${id}?`, removeConfirm: 'Excluir',
    stopFailed: (text: string) => `Não foi possível parar: ${text}`, removeFailed: (text: string) => `Não foi possível excluir: ${text}`, installFailed: (text: string) => `O último download não terminou: ${text}`,
  },
  shared: {
    title: 'Componentes compartilhados',
    note: 'Vários modelos desta categoria os usam. Cada um é instalado uma só vez e removido junto com o último modelo que o usa.',
    summaryRepair: (n: number) => (n === 1 ? '1 componente a completar' : `${n} componentes a completar`),
    summaryCount: (n: number) => (n === 1 ? '1 componente compartilhado' : `${n} componentes compartilhados`),
    usage: (live: number, all: number) => `${live === 1 ? '1 modelo instalado o usa' : `${live} modelos instalados o usam`} · ${all} precisam dele`,
    usageNone: (all: number) => `${all} modelos vão usá-lo · nenhum instalado ainda`,
    withModel: (size: string | null) => `Baixado com o primeiro modelo que você instalar${size ? ` · ${size}` : ''}`,
    completeNote: (name: string) => `Componentes compartilhados são baixados com um modelo que os usa. Só é adicionado o que falta em “${name}”; os arquivos instalados não são alterados.`,
  },
};
