import type { ModelsImageSelfTestMessages } from './image-self-test.ts';

export const ru: ModelsImageSelfTestMessages = {
  notPng: "Не файл PNG",
  chunkTruncated: (p: { type: string }) => `Компонент ${p.type} — блок обрезан`,
  missingIhdr: "Отсутствует блок IHDR",
  unsupportedPixelFormat: (p: { depth: number; color: number; interlace: number }) => `Неподдерживаемый формат пикселей (разрядность ${p.depth}, тип цвета ${p.color}, чересстрочность ${p.interlace})`,
  zeroSize: "Ширина или высота равна 0",
  missingIdat: "Отсутствует блок IDAT",
  inflateFailed: "Не удалось распаковать данные пикселей",
  pixelDataShort: "Недостаточно данных пикселей",
  unknownFilter: "Неизвестный тип фильтра строки",
  undecodable: (p: { problem: string }) => `Не удалось декодировать результат: ${p.problem}`,
  sizeMismatch: (p: { width: number; height: number; expectedWidth: number; expectedHeight: number }) => `Размер ${p.width}×${p.height} не соответствует запрошенному ${p.expectedWidth}×${p.expectedHeight}`,
  nearlySolid: (p: { distinct: number }) => `Изображение почти одноцветное (всего ${p.distinct} цветов)`,
};
