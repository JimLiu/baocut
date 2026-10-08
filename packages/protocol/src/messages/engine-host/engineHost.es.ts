import type { EngineHostMessages } from './engineHost.ts';
export const es: EngineHostMessages = {
 runGenerationNotInteger: 'runGeneration debe ser un entero decimal', secondsInvalid: (p) => `${p.field} debe ser un número finito de segundos, como mínimo 0`, secondsOverflow: (p) => `${p.field} está fuera de rango`,
 audioItemsKind: 'audioItems solo es para planes de audio y vídeo', skipAssetsKind: 'skipAssets solo es para planes de vídeo', outputKind: 'output solo es para planes de vídeo',
 outputSize: 'El ancho y el alto de salida deben ser enteros positivos', tooManyRanges: (p) => `Como máximo ${p.max} intervalos a la vez`,
 textPlanNoDocument: 'Un plan de texto necesita al menos un documento', textPlanTooManyDocuments: 'Un plan de texto admite como máximo dos documentos (el principal y el otro de una combinación bilingüe)',
 planKindUnknown: (p) => `Tipo de plan desconocido ${p.kind}`, unknownMethod: (p) => `Método desconocido: ${p.method}`, paramsInvalid: (p) => `Parámetros no válidos: ${p.error}`,
 fontFacesInvalid: (p) => `Proporciona entre 1 y ${p.max} variantes: cada nombre de familia debe tener entre 1 y 200 caracteres y cada peso debe estar entre 1 y 1000`,
 cacheDirRelative: 'cacheDir debe ser absoluto', fontPathRelative: 'path debe ser absoluto', fontInvalid: (p) => `No es un archivo de fuente utilizable: ${p.error}`,
 videoPathRelative: 'La ruta del vídeo debe ser absoluta', videoNotOpen: 'El vídeo no está abierto', taskStopped: 'Esta ejecución se detuvo y el cambio no se confirmó',
 afterNotInteger: 'after debe ser un entero decimal', enginePanic: 'El motor falló al procesar la solicitud y el cambio no se confirmó', pathRelative: 'Las rutas deben ser absolutas',
};
