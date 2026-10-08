import type { RuntimeMessages } from './runtime-copy.ts';
export const es: RuntimeMessages = {
  missingContext: 'Falta RuntimeContext', mediaStatus: (status) => `El servicio de medios devolvió ${status}`,
  noRootSequence: 'El vídeo nuevo no tiene una secuencia principal',
  edit: { importAssets: 'Importar materiales', setBackground: 'Establecer fondo', addWaveform: 'Añadir forma de onda' },
  waveformName: 'Forma de onda', noDuration: 'El vídeo aún no tiene duración, por lo que no se añadió la forma de onda',
  noOpenVideo: 'No hay ningún vídeo abierto', notCaughtUp: 'El vídeo aún no se ha actualizado y no se puede modificar ahora',
};
