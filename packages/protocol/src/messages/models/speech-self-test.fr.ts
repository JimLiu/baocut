import type { ModelsSpeechSelfTestMessages } from './speech-self-test.ts';

export const fr: ModelsSpeechSelfTestMessages = {
  notWav: "Pas un fichier RIFF/WAVE",
  missingFmt: "Le bloc fmt manque",
  missingData: "Le bloc data manque",
  unsupportedEncoding: (p: { format: number }) => `Encodage non pris en charge (${p.format})`,
  badChannels: (p: { channels: number }) => `Nombre de canaux incohérent (${p.channels})`,
  badSampleRate: (p: { sampleRate: number }) => `Fréquence d’échantillonnage incohérente (${p.sampleRate})`,
  unsupportedBitDepth: (p: { bits: number }) => `Profondeur non prise en charge (${p.bits})`,
  nonFinite: "Les échantillons contiennent des valeurs non finies",
  undecodable: (p: { problem: string }) => `Le résultat ne peut pas être décodé : ${p.problem}`,
  durationOutOfRange: (p: { duration: string; min: number; max: number }) => `La durée de ${p.duration} secondes n’est pas entre ${p.min} et ${p.max} secondes`,
  silent: "Le résultat est silencieux",
  clipped: (p: { ratio: string; limit: number }) => `Le résultat sature : ${p.ratio} % des échantillons atteignent le maximum (limite ${p.limit} %)`,
};
