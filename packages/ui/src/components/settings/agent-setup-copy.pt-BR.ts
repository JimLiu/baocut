import { pluralForm } from '@baocut/protocol';
import type { AgentSetupMessages } from './agent-setup-copy.ts';

export const ptBR: AgentSetupMessages = {
  badge: {
    'not-installed': "Não instalado",
    error: "Não pode executar",
    outdated: "Desatualizado",
    'signed-out': "Login necessário",
    disabled: "Desativado",
  },
  badgeNotChecked: "Ainda não verificado",
  badgeReady: "Disponível",
  badgeModelUpgrade: "Disponível · padrão exige atualização",
  badgeModelUnavailable: "Disponível · padrão indisponível",
  badgeUpdate: "Disponível · atualização disponível",

  errorTitle: (name: string) => `Encontrados ${name}, mas não pode executar`,
  errorBody: (detail: string | null) =>
    `${detail ? `${detail} ` : ""}Comum após remover/atualizar Node.js ou permissões. Verificações mostram onde falha.`,
  errorCta: "Executar verificações",
  outdatedTitle: (name: string, version: string | null) =>
    version ? `${name} ${version} é antigo demais para o BaoCut` : `Esta versão de ${name} é antigo demais para o BaoCut`,
  outdatedBody: (detail: string | null, minVersion: string) =>
    `${detail ? `${detail} ` : `Exige ${minVersion} ou posterior. `}Atualiza só a ferramenta de linha de comando; conta e configurações próprias não mudam.`,
  outdatedCta: (version: string) => `Atualizar para ${version}`,
  signedOutTitle: (name: string) => `${name} precisa de novo login`,
  signedOutBody: (name: string) =>
    `O login ocorre na janela de ${name}; BaoCut não trata conta ou senha. Volte para verificar após entrar.`,
  signedOutCta: "Abrir terminal para entrar",

  stepSkipped: "Verificado após a etapa anterior passar",
  stepFind: "Encontrado neste computador",
  stepFindFail: (command: string) => `${command} não está em locais comuns nem PATH`,
  stepRun: "Inicia",
  stepRunOk: (command: string, version: string) => `${command} --version retornou ${version}`,
  stepRunFail: "Falha ao iniciar",
  stepVersion: "Versão aceita pelo BaoCut",
  stepVersionOk: (version: string, min: string) => `${version}, mínimo ${min}`,
  stepVersionFail: (version: string, min: string) => `Atual ${version}, mínimo ${min}`,
  stepLogin: "Conectado à conta",
  stepLoginOk: "Conectado",
  stepLoginFail: "Informa não conectado ou login expirado",
  stepModels: "Lista de modelos disponível",
  stepModelsOk: (n: number) => (pluralForm('pt-BR', n, { one: `${n} modelo`, other: `${n} modelos` })),
  stepModelsNone: "Não informou modelos; sessões usam padrão do agente",
  verdictFail: (label: string, detail: string) => `Parou em “${label}”: ${detail}`,
  verdictOk: "Cinco verificações aprovadas. Pode iniciar sessão.",

  moreSummary: (names: string[], more: boolean) => names.join(", ") + (more ? ", e mais" : ""),

  readyTitle: "Pronto para começar",
  readyBody: (name: string, model: string, plan: string) =>
    `Novas sessões usam ${name} · ${model}. Executa em ${name} já instalado localmente com sua ${plan}; sem cobrança extra do BaoCut.`,
  readyCta: "Iniciar sessão",
  attentionBody: (name: string) =>
    `Já instalado; sem reinstalar. Motivo e solução na linha “${name}” abaixo.`,
  attentionCta: "Ver problema",
  offTitle: (name: string) => `${name} está instalado, mas desativado`,
  offBody: "Ative para entregar trabalho em uma frase.",
  offCta: (name: string) => `Ativar ${name}`,
  missingTitle: "Nenhum agente detectado localmente",
  missingBodyMany: "Instale um abaixo e entre com sua conta. Não precisa de todos.",
  missingBodyOne: "Instale pelas etapas abaixo e entre com sua conta.",

  logDropped: (n: number) => `… (${n} anteriores ${pluralForm('pt-BR', n, { one: "linha", other: "linhas" })} omitidas)`,
  doneNotDetected: (name: string) => `Comando terminou, mas ${name} ainda não foi detectado. Se instalado em outro local, informe manualmente.`,
  doneSignIn: (name: string, version: string) => `Detectado ${name} ${version} · entre uma vez para concluir`,
  doneInstalled: (name: string, version: string) => `Detectado ${name} ${version}`,
  doneUpgraded: (name: string, version: string) => `${name} agora é ${version} · atualizando seus modelos`,

  tier: {
    balanced: { label: "Recomendado", description: "Suficiente para transcrever, traduzir e editar; rápido e usa menos cota" },
    max: { label: "Mais capaz", description: "Mais lento e usa mais cota; raramente necessário" },
    fast: { label: "Mais rápido", description: "Bom para pequenas edições, como algumas legendas" },
  },
  agentDefaultModel: "Modelo padrão do agente",
  cliConfigGate: (model: string) => `Segue configurações CLI · ${model} exige atualizar CLI`,
  cliConfigModel: (model: string) => `Segue configurações CLI · ${model}`,
  cliConfig: "Configuração da CLI",
  modelMissing: "Fora da lista atual de modelos; novas sessões usam o modelo recomendado",
  effort: {
    minimal: "Mínimo",
    low: "Baixo",
    medium: "Médio",
    high: "Alto",
    xhigh: "Muito alto",
    max: "Máximo",
  } as Record<string, string>,
  modelDefaultEffort: "Padrão do modelo",
  modelDefaultEffortOf: (label: string) => `Padrão do modelo (${label})`,

  rulesTitle: (n: number) => `Comandos sempre permitidos · ${n}`,
  rulesBody:
    "Regras vêm de “Permitir sempre” nas sessões. Remover deixa de autorizar automaticamente; modos e outras regras permanecem.",
  rulesEmpty: "Sem regras salvas. Escolha “Permitir sempre” numa aprovação para aparecer aqui.",
};
