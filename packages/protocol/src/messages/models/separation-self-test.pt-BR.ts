import type { ModelsSeparationSelfTestMessages } from './separation-self-test.ts';
import { pluralForm } from '../../i18n.ts';

export const ptBR: ModelsSeparationSelfTestMessages = {
  vocals: "faixa vocal",
  background: "faixa de fundo",
  vocalsUndecodable: (p: { problem: string }) => `Não é possível decodificar a faixa vocal: ${p.problem}`,
  backgroundUndecodable: (p: { problem: string }) => `Não é possível decodificar a faixa de fundo: ${p.problem}`,
  notStereo: (p: { stem: string; channels: number }) => `${p.stem} não é estéreo (${pluralForm('pt-BR', p.channels, { one: `${p.channels} canal`, other: `${p.channels} canais` })})`,
  durationMismatch: (p: { stem: string; duration: string; sample: string }) => `${p.stem} tem duração de ${p.duration} segundos, mas a amostra tem ${p.sample} s`,
  sampleRateMismatch: (p: { vocals: number; background: number }) => `As duas faixas têm taxas de amostragem diferentes (${p.vocals} e ${p.background})`,
  vocalsSilent: "A faixa vocal está silenciosa",
  vocalsNotLouder: (p: { vocals: string; background: string }) => `A amostra contém apenas voz, mas a faixa vocal não é claramente mais alta que o fundo (RMS ${p.vocals} e ${p.background})`,
};
