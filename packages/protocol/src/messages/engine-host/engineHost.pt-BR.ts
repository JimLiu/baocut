import type { EngineHostMessages } from './engineHost.ts';
import { pluralForm } from '../../i18n.ts';

export const ptBR: EngineHostMessages = {
  runGenerationNotInteger: "runGeneration deve ser um inteiro decimal",
  secondsInvalid: (p) => `${p.field} deve ser um número finito de segundos, no mínimo 0`,
  secondsOverflow: (p) => `${p.field} está fora do intervalo`,
  audioItemsKind: "audioItems é apenas para planos audio e video",
  skipAssetsKind: "skipAssets é apenas para planos video",
  outputKind: "output é apenas para planos video",
  outputSize: "A largura e altura da saída devem ser inteiros positivos",
  tooManyRanges: (p) => pluralForm('pt-BR', Number(p.max), { one: `Até ${p.max} intervalo por vez`, other: `Até ${p.max} intervalos por vez` }),
  textPlanNoDocument: "Um plano text precisa de pelo menos um documento",
  textPlanTooManyDocuments: "Um plano text aceita no máximo dois documentos (o principal e o outro de uma mesclagem bilíngue)",
  planKindUnknown: (p) => `Tipo de plano desconhecido ${p.kind}`,
  unknownMethod: (p) => `Método desconhecido: ${p.method}`,
  paramsInvalid: (p) => `Parâmetros inválidos: ${p.error}`,
  fontFacesInvalid: (p) => `Forneça de 1 a ${p.max} faces: cada nome de família não vazio e com até 200 caracteres, cada peso entre 1 e 1000`,
  cacheDirRelative: "cacheDir deve ser absoluto",
  fontPathRelative: "path deve ser absoluto",
  fontInvalid: (p) => `Não é um arquivo de fonte utilizável: ${p.error}`,
  videoPathRelative: "O caminho do vídeo deve ser absoluto",
  videoNotOpen: "O vídeo não está aberto",
  taskStopped: "Esta execução foi interrompida e a alteração não foi registrada",
  afterNotInteger: "after deve ser um inteiro decimal",
  enginePanic: "O mecanismo falhou ao processar a solicitação e a alteração não foi registrada",
  pathRelative: "Os caminhos devem ser absolutos",
};
