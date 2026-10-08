import type { ModelsSpeechSelfTestMessages } from './speech-self-test.ts';

export const ru: ModelsSpeechSelfTestMessages = {
  notWav: "Не файл RIFF/WAVE",
  missingFmt: "Отсутствует блок fmt",
  missingData: "Отсутствует блок data",
  unsupportedEncoding: (p: { format: number }) => `Неподдерживаемая кодировка (${p.format})`,
  badChannels: (p: { channels: number }) => `Недопустимое число каналов (${p.channels})`,
  badSampleRate: (p: { sampleRate: number }) => `Недопустимая частота дискретизации (${p.sampleRate})`,
  unsupportedBitDepth: (p: { bits: number }) => `Неподдерживаемая разрядность (${p.bits})`,
  nonFinite: "Отсчёты содержат не конечные значения",
  undecodable: (p: { problem: string }) => `Не удалось декодировать результат: ${p.problem}`,
  durationOutOfRange: (p: { duration: string; min: number; max: number }) => `Длительность ${p.duration} с находится вне диапазона от ${p.min} и ещё ${p.max} с`,
  silent: "Результат не содержит звука",
  clipped: (p: { ratio: string; limit: number }) => `Результат содержит клиппинг: ${p.ratio} % отсчётов достигают полной амплитуды (предел ${p.limit}%)`,
};
