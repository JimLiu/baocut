import type { ModelsImageSelfTestMessages } from './image-self-test.ts';
export const es: ModelsImageSelfTestMessages = {
 notPng: 'No es un archivo PNG', chunkTruncated: (p) => `El bloque ${p.type} está truncado`, missingIhdr: 'Falta el bloque IHDR',
 unsupportedPixelFormat: (p) => `Formato de píxel no compatible (profundidad de bits ${p.depth}, tipo de color ${p.color}, entrelazado ${p.interlace})`, zeroSize: 'El ancho o el alto es 0', missingIdat: 'Falta el bloque IDAT', inflateFailed: 'No se pudieron descomprimir los datos de píxeles',
 pixelDataShort: 'No hay suficientes datos de píxeles', unknownFilter: 'Tipo de filtro de fila desconocido', undecodable: (p) => `El resultado no se puede decodificar: ${p.problem}`,
 sizeMismatch: (p) => `El tamaño ${p.width}×${p.height} no es el solicitado ${p.expectedWidth}×${p.expectedHeight}`, nearlySolid: (p) => `La imagen es casi de un solo color sólido (solo ${p.distinct} colores)`,
};
