import type { TtsLocalMessages } from './tts-local-copy.ts';

export const ptBR: TtsLocalMessages = {
  ttsLocal: {

    unset: "Não definido",
    defaultDesc: "Pré-selecionado em nova síntese. Sem padrão, escolha a cada vez; manual vence.",
    cloudDefault: (name: string) =>
      `Padrão é modelo de nuvem (${name}); altere em Configurações › Modelos de nuvem. Escolher local muda para ele.`,
    noInstalled: "Sem modelo de síntese instalado. Baixe um abaixo.",

    audition: "Visualização",
    hideAudition: "Ocultar prévia",
    engine: "Mecanismo",
    license: "Licença",
    components: "Componentes",

    licenseTitle: "Licença",
    licenseUse: "Fala gerada só para conteúdo não comercial; para vídeo comercial, escolha outro modelo.",
    licenseConfirm: (size: string) => `Entendi, baixar ${size}`,

    voice: "Voz",
    tone: "Tom",
    say: "O que dizer",
    lines: "Falas",
    more: "Mais vozes",
    cloneNew: "Clonar nova voz…",
    writeOwn: "Escrever meu texto",
    ownPlaceholder: "Digite uma frase para ouvir",
    ownLabel: "Texto da prévia",
    describeLabel: "Descrição da voz",
    describePlaceholder: "Ex.: voz masculina idosa, grave e tranquila",
    builtinRef: (label: string, seconds: number | null) =>
      `Gravação de referência · ${label}${seconds !== null ? ` · ${seconds} s` : ""} · transcrição incluída automaticamente`,
    describedBuiltin: (label: string) => `Voz por descrição · usa a descrição de “${label}”`,
    describePreset: (text: string) => `Descrição: ${text}`,
    myVoice: (name: string) => `Minhas vozes · ${name} · clonada da referência e transcrição`,
    presetOnly: (models: string | null) =>
      models
        ? `Só falantes integrados; teste “Minhas vozes” num modelo que clona: ${models} (a prévia na linha de cada um)`
        : "Só falantes integrados; baixe modelo que clona para testar Minhas vozes",

    nameList: (names: readonly string[]) => names.join(", "),
    cloneHint: "Forneça 5–15 segundos de fala limpa, uma pessoa sem música. WAV, MP3, M4A, FLAC ou vídeo funcionam.",
    yourFile: (name: string) => `Sua gravação · ${name}`,
    sampleFile: (label: string) => `Gravação de amostra · ${label} · fornecida com BaoCut, sem escolher arquivo`,
    pickFile: "Escolher gravação…",
    changeFile: "Escolha outro…",
    useSample: "Usar gravação de amostra",
    crossLang: "Funciona entre idiomas; referência chinesa pode ler inglês.",
    noPicker:
      "Navegador não escolhe arquivos locais. Para uma referência pontual, use o aplicativo desktop; ou amostra, ou salve em Minhas vozes.",
    pickTitle: "Escolher gravação de referência",
    pickButton: "Escolher",
    pickFilter: "Áudio ou vídeo",
    transcriptLabel: "Transcrição da gravação (opcional)",
    transcriptHint: "Escrever o que é falado melhora a semelhança",
    fileChip: (name: string, sample: boolean) => (sample ? `Amostra · ${name}` : name),
    generate: "Gerar prévia",
    again: "Gerar novamente",
    cancel: "Cancelar",
    busy: (phase: string) => `Sintetizando · ${phase}`,
    stalePrefix: "Anterior · ",
    stale: "Clipe feito com escolhas anteriores. Após mudar voz ou texto, clique “Gerar prévia” para ouvir a nova.",
    download: "Baixar",
    resultLabel: "Ouvir resultado",
    credit: (credit: string) => `Referência da voz integrada: ${credit}`,
    loadingAudio: "Carregando áudio…",
    audioFailed: (message: string) => `Não foi possível carregar áudio: ${message}`,
    downloadFailed: (message: string) => `Não foi possível baixar: ${message}`,
    fileName: (name: string) => `${name.replace(/[^\w.-]+/g, "-")}-preview.wav`,

    handoffFrom: (name: string) => `Da prévia “${name}” · grave ou extraia de vídeo; volta após salvar`,
    handoffSaved: (name: string) => `Salvo · volte à prévia “${name}”, onde esta voz será selecionada`,
    handoffBack: "Voltar e usar",
    handoffCancel: "Não, obrigado; voltar",
    auditionClone: "Prévia do clone",
    auditionCloneLabel: (name: string) => `Prévia do clone · ${name}`,
    noCloneModel:
      "Sem modelo local que clona. Baixe na página local primeiro (IndexTTS2, Qwen3-TTS Base, GPT-SoVITS…).",
    goLocal: "Ir aos modelos locais",
  },
};
