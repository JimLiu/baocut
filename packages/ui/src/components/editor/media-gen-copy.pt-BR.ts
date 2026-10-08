import { pluralForm } from '@baocut/protocol';
import type { AudioGenMessages, GeneratedMarkMessages, ImageGenMessages } from './media-gen-copy.ts';

export const ptBRMark: GeneratedMarkMessages = { generated: "Gerar" };

export const ptBRAudioGen: AudioGenMessages = {
  generate: "Gerar fala",
  clone: "Clonar voz",
  generateTip: "Ler texto com modelo de nuvem e adicionar à biblioteca de mídias",
  cloneTip: "Ler texto com voz clonada em Minhas vozes",
  back: "Voltar ao Áudio",
  running: "Executando em segundo plano",
  textPlaceholder: "Texto para sintetizar; divide em segmentos por pontos ou quebras…",
  clonePlaceholder: "O que esta voz deve dizer…",
  cta: "Gerar",
  cloneCta: "Gerar com esta voz",
  hint: (provider: string) =>
    `Enviado on-line a ${provider} para síntese e cobrado pelas regras do provedor. Progresso no topo e em Tarefas em segundo plano; adicionado à biblioteca ao concluir, colocação na linha do tempo separada. Parar espera não retira pedido enviado.`,
  readOnly: "Vídeo em leitura apenas; não pode gerar mídias nele",
  noVoicesTitle: "Ainda não há vozes em Minhas vozes",
  noVoicesBody:
    "Grave ou importe em Modelos › Síntese de fala › Minhas vozes; envie a provedor que clona (ElevenLabs), volte e escolha abaixo.",
  goVoices: "Ir para Minhas vozes",
  runTitle: (title: string) => `${title}…`,
  runNote: "Pode continuar editando · síntese em segundo plano, resultado na biblioteca ao concluir.",
  cancel: "Cancelar",
  cancelled: "Cancelado",
  done: (meta: string) => `Gerado · ${meta}`,
  inLibrary: (name: string) => `Adicionado à biblioteca · ${name}`,
  importing: "Adicionando à biblioteca…",
  add: "Adicionar à linha do tempo",
  addTip: "Colocar no indicador de reprodução",
  again: "Gerar outra",
  backToAudio: "Voltar ao Áudio",
  doneNote: "Mídia na biblioteca Áudio, marcada “Gerado”. Arraste ou clique “+”; reutilizável quantas vezes quiser.",
  failed: (message: string) => `Não foi possível gerar · ${message}`,
  edit: "Editar e gerar novamente",
  retried: "Reenviado",
};

export const ptBRImageGen: ImageGenMessages = {
  title: "Imagem",
  segments: "Origem da imagem",
  project: "Mídia de vídeo",
  gen: "Gerada por IA",
  noModelTitle: "Ainda não há modelo de imagem",
  noModelBody:
    "Conecte nuvem em Modelos › Geração de imagens › Modelos de nuvem ou baixe Qwen-Image-2.1 em Modelos locais; ambos funcionam.",
  connect: "Conectar provedor de nuvem",
  downloadLocal: "Baixar modelo local",
  fit: "Igual ao canvas do vídeo",
  recent: "Recente",
  all: (n: number) => `Todos os ${n} ${pluralForm('pt-BR', n, { one: "lote", other: "lotes" })}`,
  fewer: "Só os últimos 3 lotes",
  empty: "Sem imagens geradas neste vídeo. Imagens vão à biblioteca (“Gerado”); colocação na tela é separada.",
  place: "Posicionar",
  placeTip: "Colocar no indicador de reprodução",
  inLibrary: "Na biblioteca de mídias",
  importing: "Adicionando à biblioteca…",
  useAsRef: "Usar como referência",
  foot: "Imagens vão direto à biblioteca com modelo, parâmetros e tarefa registrados; prompt fica só no registro de tarefa. Colocação na tela separada.",
  readOnly: "Vídeo em leitura apenas; não pode gerar mídias nele",
  charCount: (chars: number, max: number) => `${chars} / ${max} caracteres`,
  charCountPlain: (chars: number) => `${chars} ${pluralForm('pt-BR', chars, { one: "caractere", other: "caracteres" })}`,
};
