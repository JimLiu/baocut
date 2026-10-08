import type { VoicesMessages } from './voices-copy.ts';

export const ptBR: VoicesMessages = {
  myVoices: {
    offline: "Vozes aparecem após conectar o Runtime.",
    add: "Adicionar voz",
    fromFile: "Nova de arquivo de áudio…",
    fromFileHint: "WAV, MP3 ou FLAC até 20 MB; frase completa de 5–12 segundos é melhor",
    importPackage: "Importar pacote de voz…",
    importHint: "Um .bcvoice exportado",
    record: "Gravar com microfone",
    recordWhy:
      "Gravação no aplicativo indisponível: precisa salvar em arquivo antes do Runtime, etapa não pronta. Grave com outro aplicativo (WAV, MP3, FLAC), depois “Nova de arquivo de áudio”.",

    recordWhyNoPicker:
      "Gravação no aplicativo indisponível: precisa salvar em arquivo antes do Runtime, etapa não pronta. Grave fora (WAV, MP3, FLAC), depois “Nova de arquivo de áudio”. Para importar pacote, esta janela não abre o seletor do sistema; use desktop.",
    noPicker: "Esta janela não abre o seletor do sistema; use o aplicativo desktop.",
    pickAudioTitle: "Escolher gravação de referência",
    pickAudioFilter: "Áudio (WAV, MP3, FLAC)",
    pickPackageTitle: "Escolher pacote de voz",
    pickPackageFilter: "Pacote de voz",
    pickButton: "Escolher",
    notAudio: "Referências devem ser arquivos WAV, MP3 ou FLAC.",
    imported: (name: string) => `Importada “${name}” · disponível para síntese e dublagem`,
    importFailed: (text: string) => `Não foi possível importar: ${text}`,
    foot:
      "Voz = referência + texto falado + consentimento. Referência fica local; pacote exportado (name.bcvoice) inclui gravação e pode ser importado por outros, mas não inclui clones. " +
      "Vozes sem declaração de propriedade pelo falante nunca são enviadas a terceiros.",

    play: (name: string) => `Ouvir ${name}`,
    stop: (name: string) => `Parar prévia de ${name}`,
    playFailed: (text: string) => `Não foi possível ouvir: ${text}`,
    more: (name: string) => `Mais · ${name}`,
    edit: "Editar…",
    cloneTo: (label: string) => `Enviar a ${label} para clonar…`,
    recloneTo: (label: string) => `Enviar a ${label} novamente…`,
    recloneHint: "Referência mudou; clone antigo desatualizado",
    removeClone: (label: string) => `Excluir clone de ${label}…`,
    export: "Exportar pacote de voz…",
    remove: "Excluir…",
    cloning: (label: string) => `Enviando a ${label} para clonar…`,
    cloneFailed: (label: string, text: string) => `O último clone em ${label} falhou: ${text}`,
    loadingMeta: "Lendo…",

    createTitle: "Nova voz",
    editTitle: (name: string) => `Editar “${name}”`,
    referenceFile: (file: string) => `Referência: ${file}`,
    name: "Nome",
    language: "Idioma",
    languageHint: "Idioma falado na referência",
    transcript: "Transcrição",
    transcriptHint: "Texto falado na referência. Alguns mecanismos exigem para clonar; deixe vazio se não souber.",
    consentHint: "Pode salvar sem marcar, mas a voz não será enviada a terceiros para clonar.",
    save: "Salvar como voz",
    saveEdit: "Salvar",
    cancel: "Cancelar",
    loading: "Carregando voz…",
    loadFailed: (text: string) => `Não foi possível carregar esta voz: ${text}`,
    saved: (name: string) => `Salva “${name}” · disponível para síntese e dublagem`,
    updated: (name: string) => `Salva “${name}”`,
    unchanged: "Sem alterações",

    uploadTitle: (label: string) => `Enviar a ${label}?`,
    upload: "Enviar",
    cloneStarted: (label: string) => `Enviando a ${label} · progresso em Tarefas em segundo plano`,
    cloneRejected: (text: string) => `Não foi possível iniciar clonagem: ${text}`,
    removeCloneTitle: (label: string) => `Excluir clone de ${label}?`,
    removeCloneBody: (label: string) =>
      `${label} receberá pedido para excluir esta voz. Para usar novamente em ${label}, precisará enviar novamente.`,
    removeCloneConfirm: "Excluir clone",
    cloneRemoved: (label: string) => `Clone excluído de ${label}`,
    cloneGoneRemote: (label: string) => `${label} não tem mais este clone; registro local também limpo`,
    cloneRemoveFailed: (text: string) => `Não foi possível excluir clone: ${text}`,

    exportTitle: "Exportar pacote de voz",
    exportButton: "Exportar",
    exported: (path: string) => `Exportado para ${path}`,
    exportFailed: (text: string) => `Não foi possível exportar: ${text}`,
    exportExists: "O BaoCut não sobrescreve arquivos. Escolha outro nome ou local e exporte novamente.",

    exportFailedExists: (text: string) =>
      `Não foi possível exportar: ${text}. O BaoCut não sobrescreve arquivos. Escolha outro nome ou local e exporte novamente.`,

    deleteTitle: (name: string) => `Excluir “${name}”?`,
    deleteConfirm: "Excluir",
    deleted: (name: string) => `Excluído “${name}”`,
    deleteFailed: (text: string) => `Não foi possível excluir: ${text}`,
    localOnlyTitle: (label: string) => `O clone em ${label} não foi excluído`,
    localOnlyBody: (label: string, text: string) =>
      `${text}

A voz ainda está aqui. Tente depois ou exclua só o registro e voz locais. O clone na conta de ${label} continuará lá; você deverá excluir em ${label} manualmente.`,
    localOnlyConfirm: "Excluir só neste computador",
    later: "Tentar mais tarde",
  },
};
