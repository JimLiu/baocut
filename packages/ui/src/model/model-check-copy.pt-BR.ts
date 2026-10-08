import type { ModelCheckCode } from '@baocut/protocol';
import type { CheckSentence, CheckSubject, ModelCheckMessages, TrySubject } from './model-check-copy.ts';

const outputWrong: Record<CheckSubject, string> = { transcribe: 'O modelo executa, mas não reconhece a fala da amostra', synthesize: 'O modelo executa, mas o áudio sintetizado está incorreto', image: 'O modelo executa, mas a imagem está incorreta', separate: 'O modelo executa, mas voz e fundo não foram separados' };
const checkSentences: Record<ModelCheckCode, (subject: CheckSubject) => CheckSentence> = {
 APP_FILE_MISSING: () => ({ text: 'Falta um arquivo do BaoCut, não é problema do modelo', todo: 'Reinstale o BaoCut; modelos baixados não mudam.' }),
 MODEL_FILES_DAMAGED: () => ({ text: 'Arquivos do modelo danificados', todo: 'Reparar baixa os arquivos danificados novamente.' }),
 MODEL_OUTPUT_WRONG: (subject) => ({ text: outputWrong[subject], todo: 'Repare primeiro. Se persistir, copie detalhes técnicos e envie.' }),
 MODEL_OUT_OF_MEMORY: () => ({ text: 'Memória insuficiente para carregar o modelo', todo: 'Feche modelos grandes ou aplicativos pesados e verifique.' }),
 MODEL_WORKER_FAILED: () => ({ text: 'O processo do modelo falhou', todo: 'Verifique novamente. Se persistir, reinicie ou envie detalhes técnicos.' }),
};

export const ptBR: ModelCheckMessages = {

  label: {
    check: "Verificar",
    checkFull: "Verificar modelo",
    recheck: "Verificar novamente",
    repair: "Reparar…",
    repairSub: "Baixa só arquivos danificados novamente",
    details: "Detalhes técnicos",
    hideDetails: "Ocultar detalhes técnicos",
    copy: "Copiar detalhes técnicos",
    copied: "Detalhes técnicos copiados",
    copyFailed: "Não foi possível copiar. Selecione e copie acima.",
    cancel: "Cancelar",
    retry: "Tentar novamente",
    pickRef: "Escolher outra gravação…",
    useSample: "Usar gravação de amostra",
  },

  caption:
    "Verificar confirma funcionamento; reparar baixa só arquivos danificados. Excluir mantém componentes usados por outros modelos.",
  head: {
    running: "Verificando…",
    repairing: "Reparando…",
    failed: "A verificação falhou:",
    notStarted: "Verificação não iniciou:",
  },

  sentence: (text: string) => `${text}.`,
  phase: {
    queued: "Na fila",
    loading: "Carregando modelo",
    running: "Executando amostra curta",
    verifying: "Verificando resultado",
    repairing: "Baixando arquivos danificados; verifica automaticamente após reparar",
  },

  checkSentences: checkSentences as Record<ModelCheckCode, (subject: CheckSubject) => CheckSentence>,

  unknown: {
    text: "O modelo não funcionou corretamente",
    todo: "Verifique novamente. Se persistir, copie detalhes técnicos e envie.",
  } as CheckSentence,

  notStarted: {
    RUNTIME_UNREACHABLE: {
      text: "Serviço em segundo plano não responde",
      todo: "Verifique depois. Se persistir, reinicie BaoCut.",
    },
    MODEL_IN_USE: {
      text: "Outra tarefa usa este modelo",
      todo: "Espere ou cancele em Tarefas em segundo plano, depois verifique.",
    },
    MODEL_UNAVAILABLE: { text: "Modelo indisponível agora", todo: "Repare ou reative antes de verificar." },
    RESOURCE_ADMISSION_UNSATISFIABLE: {
      text: "Memória insuficiente para este modelo",
      todo: "Use modelo menor.",
    },
    WEB_METHOD_NOT_ALLOWED: { text: "Verificação local indisponível no navegador", todo: "Verifique no aplicativo desktop." },
    OFFLINE_STRICT: { text: "Off-line estrito ativo", todo: "Desative nas Configurações, depois verifique." },
  } as Record<string, CheckSentence>,
  notStartedUnknown: {
    text: "BaoCut não aceitou este teste",
    todo: "Verifique depois; se persistir, copie detalhes técnicos e envie.",
  } as CheckSentence,

  detail: {
    code: (code: string) => `Código ${code}`,
    model: (id: string, when: string) => `Modelo ${id} · ${when}`,
    message: (message: string) => `Mensagem ${message}`,
    passed: (when: string) => `Teste aprovado · ${when}`,
  },

  noticeText: (what: string) => `Último teste deste modelo falhou: ${what}`,

  refUnreadable: (file: string) => ({
    text: `Não foi possível ler sua gravação “${file}”. Arquivo pode estar danificado ou não ser áudio`,
    todo: "Tente outra referência, ou ouça com amostra primeiro.",
  }),
  refUnknown: "gravação",

  trySpeech: {
    noMemory: {
      text: "Memória insuficiente para concluir síntese",
      todo: "Feche modelos grandes ou aplicativos pesados e tente.",
    },
    modelError: { text: "Modelo falhou sem produzir áudio", todo: "Verifique o modelo para entender." },
    other: (message: string) => ({
      text: `Não foi possível sintetizar: ${message}`,
      todo: "Tente novamente; se persistir, veja detalhes em Tarefas em segundo plano.",
    }),
    notStarted: (message: string) => ({ text: `Não foi possível iniciar síntese: ${message}`, todo: "" }),
    noticeTodo: (todo: string) => `${todo} Uma prévia provavelmente também falhará.`,
  } as TrySubject,

  tryImage: {
    noMemory: {
      text: "Memória insuficiente para concluir desenho",
      todo: "Feche outros modelos e tente, ou reduza passos.",
    },
    modelError: { text: "Modelo falhou sem imagem", todo: "Verifique o modelo para entender." },
    other: (message: string) => ({
      text: `Não foi possível desenhar: ${message}`,
      todo: "Tente novamente; se persistir, veja detalhes em Tarefas em segundo plano.",
    }),
    notStarted: (message: string) => ({ text: `Não foi possível iniciar desenho: ${message}`, todo: "" }),
    noticeTodo: (todo: string) => `${todo} Um teste de imagem provavelmente também falhará.`,
  } as TrySubject,
};
