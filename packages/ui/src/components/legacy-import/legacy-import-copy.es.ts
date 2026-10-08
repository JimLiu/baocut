import { pluralForm } from '@baocut/protocol';
import type { LegacyImportMessages } from './legacy-import-copy.ts';

export const es: LegacyImportMessages = {
  title: '¿Importar proyectos de una versión anterior?',
  lead: (n) =>
    pluralForm('es', n, {
      one: `Hay ${n} proyecto de una versión anterior de BaoCut en este ordenador. Impórtalo para seguir editándolo en esta versión. Los archivos originales se quedan donde están, sin cambios.`,
      other: `Hay ${n} proyectos de una versión anterior de BaoCut en este ordenador. Impórtalos para seguir editándolos en esta versión. Los archivos originales se quedan donde están, sin cambios.`,
    }),
  found: 'Proyectos encontrados',
  destination: 'Importar en',
  resetDefault: 'Usar ubicación predeterminada',
  change: 'Cambiar…',
  pickTitle: 'Elige dónde importar',
  destinationNote: 'Esta carpeta aparece como un proyecto en Home, y cada proyecto anterior pasa a ser un vídeo dentro de él.',
  hint: 'Si lo omites, se te volverá a preguntar la próxima vez que se inicie BaoCut. Marca «No volver a recordar» para no importarlos nunca.',
  never: 'No volver a recordar',
  skip: 'Omitir',
  import: 'Importar',
  importing: (n) =>
    pluralForm('es', n, {
      one: `Importando ${n} proyecto anterior en segundo plano`,
      other: `Importando ${n} proyectos anteriores en segundo plano`,
    }),
  neverDone: 'No se te volverá a recordar que importes proyectos anteriores. Los archivos originales se quedan como están.',
  skipped: 'Omitido. Se te volverá a preguntar la próxima vez que se inicie BaoCut.',
  failed: (message) => `No se pudo importar: ${message}`,
};
