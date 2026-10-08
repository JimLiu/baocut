import type { ModelsImageSelfTestMessages } from './image-self-test.ts';

export const tr: ModelsImageSelfTestMessages = {
notPng: 'PNG dosyası değil', chunkTruncated: (p) => `${p.type} bloğu kesilmiş`, missingIhdr: 'IHDR bloğu eksik', unsupportedPixelFormat: (p) => `Desteklenmeyen piksel biçimi (bit derinliği ${p.depth}, renk türü ${p.color}, geçmeli tarama ${p.interlace})`, zeroSize: 'Genişlik veya yükseklik 0', missingIdat: 'IDAT bloğu eksik', inflateFailed: 'Piksel verisi açılamadı', pixelDataShort: 'Yeterli piksel verisi yok', unknownFilter: 'Bilinmeyen satır filtresi türü', undecodable: (p) => `Çıktı çözümlenemiyor: ${p.problem}`, sizeMismatch: (p) => `${p.width}×${p.height} boyutu istenen ${p.expectedWidth}×${p.expectedHeight} değil`, nearlySolid: (p) => `Görsel neredeyse tek renk (yalnızca ${p.distinct} renk)` ,
};
