import type { StageMediaMessages } from './stage-media-copy.ts';
import { pluralForm } from '@baocut/protocol';
export const es: StageMediaMessages = {
 titles: { missing: 'Archivo de origen no encontrado', changed: 'El archivo de origen ha cambiado', 'outside-project': 'El archivo de origen está fuera de la carpeta del proyecto', unplayable: 'El archivo de origen no se puede reproducir' },
 causes: {
 missing: 'Puede que el archivo se haya movido, renombrado o eliminado, o que esté en una unidad desconectada.',
 changed: 'El archivo de esta ubicación ya no es el que se importó (su tamaño no coincide). Puede que se haya sobrescrito o exportado de nuevo.',
 'outside-project': 'La ubicación registrada está fuera de la carpeta del proyecto que contiene este vídeo y BaoCut no lee archivos allí.',
 },
 unplayable: (error) => `El reproductor no puede abrir este archivo: ${error}.`,
 tail: { video: 'Los subtítulos siguen reproduciéndose; solo faltan la imagen y el sonido original.', audio: 'Los subtítulos siguen reproduciéndose; solo dejarás de oír este audio.' },
 body: (cause, tail) => `${cause} ${tail}`,
 volume: (volume) => `El archivo está en «${volume}». Conecta esa unidad y se recuperará automáticamente.`,
 more: (count) => `${pluralForm('es', count, { one: `${count} material más de vídeo o audio tampoco se puede reproducir`, other: `${count} materiales más de vídeo o audio tampoco se pueden reproducir` })}.`,
 relinkHint: 'Elige el archivo original para recuperarlo. BaoCut comprueba el contenido y no puede volver a vincular un archivo con contenido diferente.',
 desktopOnly: 'Para recuperarlo, abre este vídeo en la aplicación de escritorio de BaoCut y usa «Volver a vincular…» en el lienzo para elegir el archivo original.',
 managed: 'Este archivo se guardó en la carpeta del vídeo, por lo que no se puede volver a vincular a otra ubicación.',
 oldRevision: 'La línea de tiempo usa una versión anterior de este material; solo se puede volver a vincular la versión actual.',
 relink: 'Volver a vincular…', relinking: 'Comprobando…', pickTitle: (name) => `Buscar «${name}»`, pickButton: 'Volver a vincular',
 label: (name) => `Volver a vincular «${name}»`, relinkFailed: (message) => `No se pudo volver a vincular: ${message}`,
 decodeFailed: 'Error de decodificación', unsupported: 'Formato no compatible',
};
