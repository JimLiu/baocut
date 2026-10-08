import type { ModelsSeparationSelfTestMessages } from './separation-self-test.ts';
export const es: ModelsSeparationSelfTestMessages = {
 vocals: 'pista vocal', background: 'pista de fondo', vocalsUndecodable: (p) => `La pista vocal no se puede decodificar: ${p.problem}`, backgroundUndecodable: (p) => `La pista de fondo no se puede decodificar: ${p.problem}`,
 notStereo: (p) => `${p.stem} no es estéreo (${p.channels} canales)`, durationMismatch: (p) => `${p.stem} dura ${p.duration} segundos, pero la muestra dura ${p.sample} segundos`, sampleRateMismatch: (p) => `Las dos pistas tienen frecuencias de muestreo diferentes (${p.vocals} y ${p.background})`,
 vocalsSilent: 'La pista vocal está en silencio', vocalsNotLouder: (p) => `La muestra solo contiene voz, pero la pista vocal no tiene un volumen claramente superior al fondo (RMS ${p.vocals} y ${p.background})`,
};
