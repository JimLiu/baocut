import type { JobsMediaProbeMessages } from './media-probe.ts';

export const ru: JobsMediaProbeMessages = {
  unknownMediaType: (p: { mediaType: string }) => `Нераспознанный тип медиа ${p.mediaType}`,
  unreadable: "Не удалось прочитать файл результата",
  headerMismatch: (p: { sniffed: string; mediaType: string }) => `Заголовок файла указывает ${p.sniffed}, но заявлен формат ${p.mediaType}`,
  unrecognizedFormat: "нераспознанный формат",
  notJson: "Вывод ffprobe не является JSON",
  noAudioStream: "Нет аудиопотока",
  noImage: "Нет изображения",
  noFrames: "Не удалось декодировать ни одного кадра",
  durationNotPositive: "Длительность не положительна",
  sampleRateNotPositive: "Частота дискретизации не положительна",
  channelsNotPositive: "Число каналов не положительно",
  sizeNotPositive: "Ширина или высота не положительна",
  cannotRun: (p: { reason: string }) => `Не удалось запустить ffprobe: ${p.reason}`,
  killedBy: (p: { signal: string }) => `завершено сигналом ${p.signal}`,
  exitCode: (p: { code: string }) => `код завершения ${p.code}`,
  decodeFailed: (p: { reason: string }) => `ffprobe не смог декодировать (${p.reason})`,
  decodeFailedWith: (p: { reason: string; output: string }) => `ffprobe не смог декодировать (${p.reason}): ${p.output}`,
  noProbe: "ffprobe недоступен, результат нельзя проверить",
};
