import type { OnlineCapability } from '@baocut/protocol';
import type { RefreshKind } from '../../model/models-cloud.ts';
import type { ModelsMessages } from './models-copy.ts';

import { pluralForm } from '@baocut/protocol';
const count = (n: number, one: string, many: string) => `${n} ${pluralForm('pt-BR', n, { one, other: many })}`;

export const ptBR: ModelsMessages = {
  page: {
    title: "Modelos",
    nav: "Navegação de modelos",
    navSection: "Capacidades",
    categories: "Categorias de modelos",
    tabs: (label: string) => `${label}: gerenciamento de modelos`,
    offline: "Modelos aparecem após conectar o Runtime.",
    loading: "Carregando modelos…",
    goAgent: "Ir a Configurações › Agente",
  },
  local: {
    defaultLabel: "Modelo padrão",
    defaultDesc: "Pré-selecionado em novos vídeos e usado na transcrição pela CLI.",
    separateDefaultDesc: "Separa fundo em dublagens traduzidas sem modelo especificado e em dublagens pela CLI.",
    auto: "Automático",
    autoUses: (id: string) => `Automático usa atualmente ${id}.`,
    otherDefault: (name: string) => `O padrão atual é ${name} (definido em modelos de nuvem); escolher local substitui.`,
    defaultSet: "Padrão definido",
    defaultFailed: (message: string) => `Não foi possível definir padrão: ${message}`,
    installed: "Instalado",
    available: "Disponível para baixar",
    emptyInstalled: "Nenhum modelo instalado.",
    emptyAvailable: "Todos os modelos desta categoria instalados.",
    remove: "Excluir",
    reenable: "Reativar",
    reenabled: (id: string) => `Reativado ${id}`,
    reenableFailed: (message: string) => `Não foi possível reativar: ${message}`,
    emptyTitle: (label: string) => `Sem modelos locais para ${label} ainda`,
    emptyBody:
      "A pasta local só tem pacotes de reconhecimento, síntese, imagens e separação. Esta categoria ainda não aceita modelos locais.",
  },

  imageLocal: {
    defaultDesc: "Pré-selecionado em novas imagens. Sem padrão, escolha a cada vez; escolha manual sempre vence.",
    cloudDefault: (name: string) =>
      `Padrão é modelo de nuvem (${name}); altere em Configurações › Modelos de nuvem. Escolher local muda para ele.`,
    noInstalled: "Sem modelo de imagem instalado. Baixe um abaixo.",
    licenseUse: "Imagens só para conteúdo não comercial; para vídeo comercial, escolha outro modelo.",

    tryButton: "Experimente",
    tryTitle: (name: string) => `Testar ${name}`,
    tryPromptTitle: "Prompt de teste · uma imagem 512 × 512",
    tryPromptLabel: "Solicitação de teste",
    tryPlaceholder: "Descreva a imagem",
    tryChars: (n: number, max: number) => `${n} / ${max} caracteres`,
    trySample: "Outro exemplo",
    tryFacts: (steps: number) => `1:1 · 512 × 512 · ${steps} passos · 1 imagem · off-line · usa a vaga de tarefa pesada local`,
    tryNote:
      "Desenha imagem pequena localmente, sem rede. Usa a vaga pesada; outras tarefas locais esperam. Fechar não para; execução também em Tarefas em segundo plano.",
    tryReady: "Pronto para testar",
    tryRunning: (steps: number) => `Desenhando 512² · ${steps} passos…`,
    tryDone: (seconds: number | null) => (seconds !== null ? `Concluído · ${seconds} s` : "Concluído"),
    tryFailed: "Não foi possível desenhar a imagem",
    tryResult: "Resultado do teste",
    tryImageAlt: "Imagem gerada pelo teste",
    tryOpenFailed: (message: string) => `Não foi possível abrir a imagem: ${message}`,
    tryWhere: "Como outras imagens, aparece em Ferramentas › Gerar imagem, não é adicionada ao vídeo",
    tryDownload: "Baixar imagem",
    tryCopy: "Copiar prompt",
    tryClose: "Fechar",
    tryStopWaiting: "Pare de esperar",
    tryStart: "Começar a gerar",
    tryAgain: "Gerar outra",
    tryBusy: "Gerando…",

    tryFileName: (id: string) => `image-try-${id}`,
  },
  cloud: {
    heading: {
      transcribe: "Transforme o discurso em uma transcrição",
      synthesizeSpeech: "Ler texto em voz alta",
      generateImage: "Transforme descrições em imagens",
      generateText: "Traduzir legendas e gerar texto",
    } satisfies Record<OnlineCapability, string>,
    lede: {
      transcribe: "Recebe áudio e retorna texto reconhecido. Um único modelo padrão, compartilhado com a página local.",
      synthesizeSpeech: "Recebe texto e retorna fala. Usado em síntese e dublagem; on-line, normalmente cobrado por caractere.",
      generateImage:
        "Recebe prompt e retorna imagem, on-line e cobrado por imagem. Codex CLI também desenha sem chave, usando assinatura; opção na primeira ficha abaixo.",
      generateText:
        "Recebe instruções e retorna texto. Usado em tradução, dublagem e Ferramentas › Geração de texto; on-line, cobrado por token.",
    } satisfies Record<OnlineCapability, string>,
    defaultLabel: {
      transcribe: "Modelo de fala em nuvem padrão",
      synthesizeSpeech: "Modelo padrão de síntese de fala na nuvem",
      generateImage: "Modelo de imagem de nuvem padrão",
      generateText: "Modelo de texto padrão",
    } satisfies Record<OnlineCapability, string>,
    defaultDesc: {
      transcribe:
        "Usado sem modelo indicado na transcrição. Um único padrão: nuvem substitui local; “Usar modelo local” limpa nuvem e retoma seleção local automática.",
      synthesizeSpeech:
        "Usado sem modelo em síntese ou dublagem. “Escolher a cada vez” = sem padrão; pedidos sem modelo rejeitados, escolha ao usar.",
      generateImage:
        "Usado sem modelo em geração, bcut image ou agente. Codex nunca escolhido automaticamente; escolha aqui como padrão. “Escolher a cada vez” = sem padrão.",
      generateText:
        "Usado sem modelo em tradução, dublagem ou texto. “Escolher a cada vez” = sem padrão; Runtime não escolhe, pedidos sem modelo rejeitados.",
    } satisfies Record<OnlineCapability, string>,

    localDefaultDesc: "Definido na página local · “Escolher a cada vez” limpa padrão",
    none: {
      transcribe: "Usar modelo local",
      synthesizeSpeech: "Escolha cada vez",
      generateImage: "Escolha cada vez",
      generateText: "Escolha cada vez",
    } satisfies Record<OnlineCapability, string>,
    noneDesc: {
      transcribe: "Voltar à seleção automática da página local",
      synthesizeSpeech: "Escolher ao gerar fala ou dublagem",
      generateImage: "Decida ao gerar imagens",
      generateText: "Escolher ao usar (Runtime não escolhe por você)",
    } satisfies Record<OnlineCapability, string>,
    codexItem: "Codex CLI · Imagens",
    codexItemDesc: "Usa assinatura Codex · uma imagem por vez · 5–10× mais lento",
    unavailable: "Indisponível",
    pickerEmpty: { image: "Conecte provedor ou ative imagens Codex para escolher", other: "Conecte um provedor para escolher" },
    defaultSet: "Modelo padrão alterado",
    defaultFailed: (message: string) => `Não foi possível mudar modelo padrão: ${message}`,
    providers: "Provedores",
    providersDesc: "Todos os tipos de modelo compartilham a chave deste provedor. Os resultados se aplicam apenas ao modelo testado.",

    providersExtra: {
      transcribe: "",
      synthesizeSpeech: " Síntese normalmente cobrada por caractere.",
      generateImage: " Imagens cobradas por imagem; seguem os termos do provedor.",
      generateText: " Texto cobrado por token.",
    } satisfies Record<OnlineCapability, string>,
    addCustom: "Adicionar provedor personalizado",
    connected: "Conectado",
    manageKey: "Gerenciar chave",
    connect: "Conectar",
    addModel: "Adicionar modelo",
    defaultChip: "Padrão",
    expand: (name: string) => `Mostrar ${name} modelos`,
    collapse: (name: string) => `Ocultar ${name} modelos`,
    probe: {
      transcribe: "Discurso de teste",
      synthesizeSpeech: "Testar síntese",
      generateImage: "Testar imagem",
      generateText: "Geração de teste",
    } satisfies Record<OnlineCapability, string>,
    probeUnsupported: "Teste separado ainda indisponível",
    headNoModels: (kind: string) => `Sem modelos para ${kind} ainda · adicione abaixo; usa esta chave`,
    headCustomOff: "Não conectado · Personalizado · Após conectar, adicione modelos em cada uso",
    headOff: (first: string, total: number) =>
      `Não conectado · ${first}${total > 1 ? ` e ${count(total - 1, "modelo a mais", "modelos a mais")}` : ""} · conecte para testar e definir padrão`,
    headCount: (total: number) => count(total, "modelo", "modelos"),
    headDefault: (id: string) => ` · Padrão: ${id}`,

    refresh: { models: "Atualizar modelos", voices: "Atualizar catálogo de vozes" } satisfies Record<RefreshKind, string>,
    refreshNeedsKey: (label: string) => `${label} (conecte chave primeiro)`,
    refreshing: { models: "Atualizando modelos…", voices: "Atualizando o catálogo de vozes…" } satisfies Record<RefreshKind, string>,
    refreshFailedLine: { models: "Não foi possível atualizar os modelos", voices: "Não foi possível atualizar as vozes" } satisfies Record<RefreshKind, string>,
    builtinModels: "Lista integrada · atualize para ver os modelos disponíveis para sua chave",
    builtinVoices: (models: number, voices: number) =>
      `${count(models, "modelo", "modelos")} · ${count(voices, "voz", "vozes")} · catálogo integrado · atualize para ver vozes acessíveis pela chave`,
    freshModels: (models: number, ago: string) => `${count(models, "modelo", "modelos")} · atualizado ${ago}`,
    freshVoices: (models: number, voices: number, ago: string) =>
      `${count(models, "modelo", "modelos")} · ${count(voices, "voz", "vozes")} · atualizado ${ago}`,
    unusable: (n: number) => ` · ${n} não utilizável com esta chave`,
    refreshFailed: (message: string) => `Não foi possível atualizar: ${message}`,
    modelVoices: (n: number) => (n ? `${count(n, "voz predefinida", "vozes predefinidas")}` : "Sem vozes predefinidas · testes exigem ID de voz"),
    modelSizes: (sizes: string[], max: number) =>
      `${sizes.length ? sizes.join(" / ") : "Tamanho definido pelo serviço"} · até ${count(max, "imagem", "imagens")} por vez`,
    customTag: "Personalizado",
    emptyProviders: "Sem provedores de nuvem nesta categoria. Adicione serviço compatível OpenAI personalizado.",
    noCloud: "Esta categoria não tem modelos de nuvem.",
  },

  textParams: {
    effort: "Esforço de raciocínio",
    effortDesc:
      "Só modelos com raciocínio: nível ausente usa o mais próximo; modelos não ajustáveis ignoram. “Automático” usa o padrão próprio.",

    effortCount: (tunable: number, total: number) => (total ? ` ${tunable} de ${count(total, "modelo conectado", "modelos conectados")} podem ser ajustados.` : ""),
    concurrency: "Solicitações simultâneas",
    concurrencyDesc: (min: number, max: number) =>
      `Máximo de solicitações de texto por provedor (${min}–${max}), compartilhado por tradução e geração. Reduza se atingir limites.`,
    saved: "Salvo",
    failed: (message: string) => `Não foi possível salvar: ${message}`,
  },
  codexCard: {
    title: "Codex CLI",
    on: "Ativado · assinatura Codex, sem chave · uma imagem por vez · tamanho ignorado · 5–10× mais lento",
    off: "Desativado · ative para escolher em imagens e como padrão",
    missing: "Codex não encontrado · instale e entre no Codex CLI antes de desenhar.",
    switchLabel: "Desenhar com Codex",
    toggleFailed: (enabled: boolean, message: string) => `Não foi possível ${enabled ? "on" : "off"} imagens Codex: ${message}`,
  },
  key: {
    title: (name: string) => `${name} · Chave de API`,
    shared: (name: string, kinds: string) => `Esta chave é compartilhada por todos os ${name} modelos (${kinds}); informe uma vez para todas as listas.`,
    sharedCustom: (name: string) =>
      `Esta chave é compartilhada por todos os ${name} modelos. Reconhecimento, texto, síntese e imagens podem ser adicionados; chave só uma vez.`,
    field: "Chave de API",
    fieldCustom: "Deixe vazio se o serviço não exigir chave.",
    endpoint: (url: string) => `URL base · ${url}`,
    keep: "Chave já salva. Deixe vazio para manter e só verificar.",
    verifyNote:
      "Antes de salvar, pedido de leitura ao provedor verifica a chave; falha não salva. Chave só neste computador, nunca exibida novamente.",
    removeKey: "Remover chave",
    removeProvider: "Excluir provedor",
    cancel: "Cancelar",
    save: "Verificar e salvar",
    saved: (name: string) => `Conectado ${name}`,
    failed: (message: string) => message,
    removed: (name: string) => `Removida a chave de ${name}`,
    providerRemoved: (name: string) => `Excluídas ${name}`,
    removeFailed: (message: string) => `Não foi possível remover: ${message}`,
    confirmTitle: (name: string) => `Excluir “${name}”?`,
    confirmBody: "Modelos declarados excluídos com a chave. Padrões que apontam a eles mantidos e marcados indisponíveis.",
    confirm: "Excluir",
  },
  custom: {
    title: "Adicionar provedor personalizado",
    name: "Nome do provedor",
    url: "URL base",
    urlPlaceholder: "https://api.example.com/v1",
    model: "Primeiro ID de modelo",
    kind: 'Use',
    voices: "IDs de voz",
    voicesPlaceholder: "Separados por vírgulas (opcional) · ex.: zh-female, zh-male",
    taken: (name: string) => `Esta URL já foi adicionada como “${name}”. Adicione modelos nela para reutilizar a chave.`,
    takenAction: (name: string) => `Adicionar a “${name}”`,
    note: {
      transcribe: "Deve aceitar transcrição (/v1/audio/transcriptions); chat sozinho não reconhece fala.",
      synthesizeSpeech: "Deve aceitar /v1/audio/speech; sem IDs de voz, informe ao usar.",
      generateImage: "Deve aceitar /v1/images/generations; padrões conservadores (1024 × 1024, uma imagem por vez).",
      generateText: "Deve aceitar /v1/chat/completions; contexto e saída conservadores (32K e 4K tokens).",
    } satisfies Record<OnlineCapability, string>,

    noteHead: "Serviço compatível OpenAI. ",
    noteTail: " Depois de adicionar, conecte chave ou deixe vazio e teste.",
    add: "Adicionar",
    added: (name: string) => `Adicionado ${name} · conecte em seguida`,
    failed: (message: string) => `Não foi possível adicionar: ${message}`,
  },

  kindLabel: {
    transcribe: "Reconhecimento de fala · ASR",
    generateText: "Geração de texto · LLM",
    synthesizeSpeech: "Síntese de fala · TTS",
    generateImage: "Geração de imagens · Image",
  } satisfies Record<OnlineCapability, string>,
  addModel: {
    title: "Adicionar modelo",
    model: "ID do modelo",
    taken: "Este provedor já tem este ID de modelo.",
    note: "O uso define a lista e se o teste envia texto ou recebe imagem. Teste depois de adicionar.",
    added: (id: string) => `Adicionado ${id}`,
    failed: (message: string) => `Não foi possível adicionar modelo: ${message}`,
  },
  probe: {
    title: {
      synthesizeSpeech: "Testar síntese de fala",
      generateImage: "Testar geração de imagens",
      generateText: "Geração de texto de teste",
    } as Partial<Record<OnlineCapability, string>>,
    chip: { transcribe: "ASR", synthesizeSpeech: "TTS", generateImage: "Imagem", generateText: "LLM" } satisfies Record<OnlineCapability, string>,
    sample: {
      synthesizeSpeech: "Texto de teste · chinês simplificado",
      generateImage: "Prompt de teste · uma imagem · tamanho padrão",
      generateText: "Solicitação de teste",
    } as Partial<Record<OnlineCapability, string>>,
    voice: (voice: string) => `Voz · ${voice}`,
    voiceField: "ID da voz",
    voiceDesc: "Sem vozes predefinidas; teste exige ID reconhecido pelo provedor.",
    note: {
      synthesizeSpeech: "Envia o texto ao modelo para síntese e verifica o áudio retornado.",
      generateImage: "Envia o prompt ao modelo e verifica imagem retornada.",
      generateText: "Envia o prompt ao modelo e verifica texto retornado.",
    } as Partial<Record<OnlineCapability, string>>,
    cost: "Provedor pode cobrar. Fechar não retira pedido enviado; teste também aparece em Tarefas em segundo plano.",
    ready: "Pronto para testar",
    running: {
      synthesizeSpeech: "Enviando texto e aguardando o áudio…",
      generateImage: "Enviando o prompt e aguardando a imagem…",
      generateText: "Esperando o modelo…",
    } as Partial<Record<OnlineCapability, string>>,
    done: (seconds: number | null) => (seconds !== null ? `Teste aprovado · ${seconds} s` : "Teste aprovado"),
    failed: "Teste falhou",
    result: "Resultado do teste",
    resultNote: "Resultado mostrado só aqui, sem adicionar ao vídeo.",

    textResultNote: "Resposta não adicionada ao vídeo; salva como documento no Space, como outros textos.",
    start: "Iniciar teste",
    retry: "Teste novamente",
    testing: "Testando…",
    close: "Fechar",
    openFailed: (message: string) => `Não foi possível abrir resultado: ${message}`,
    asrUnsupported: "Teste isolado de reconhecimento ainda indisponível",
  },
  voices: {
    title: "Minhas vozes",
    lede:
      "Salve uma referência como voz, escolha pelo nome na síntese ou dublagem; referência permanece local. Para nuvem (ElevenLabs), envie aqui para clonar. Pode excluir quando quiser.",
    emptyTitle: "Sem vozes ainda",
    emptyBody: "Escolha referência de 5–12 segundos ou importe pacote exportado. Após salvar, escolha em qualquer lugar.",
  },

  quoted: (text: string) => `“${text}”`,
};
