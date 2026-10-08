import { pluralForm } from '@baocut/protocol';
import type { LegacyImportRunMessages } from './legacy-import-run.ts';

const imported = (n: number) => pluralForm('es', n, { one: `${n} importado`, other: `${n} importados` });

export const es: LegacyImportRunMessages = {
  offlineTitle: (name) => `La unidad «${name}» no está conectada`,
  offlineWhy: (n, root) =>
    pluralForm('es', n, {
      one: `Los vídeos que usa este proyecto están en esta unidad (${root}), que ahora no se puede leer.`,
      other: `Los vídeos que usan estos ${n} proyectos están en esta unidad (${root}), que ahora no se puede leer.`,
    }),
  offlineFix:
    'Conecta la unidad y haz clic en «Reintentar». Si no haces nada, BaoCut lo volverá a intentar la próxima vez que se inicie. Si ya no necesitas el material, haz clic en «Omitir» y no se importará.',
  offlineShort: (n, name) =>
    pluralForm('es', n, {
      one: `${n} proyecto tiene su material en «${name}», que no está conectada`,
      other: `${n} proyectos tienen su material en «${name}», que no está conectada`,
    }),
  missingTitle: 'Los archivos multimedia no están donde estaban',
  missingWhy:
    'Los archivos que usa el proyecto se movieron, se renombraron o se eliminaron, así que las rutas guardadas en el proyecto anterior ya no los encuentran.',
  missingFix: 'Vuelve a poner los archivos donde estaban y haz clic en «Reintentar». Si no puedes recuperarlos, haz clic en «Omitir».',
  missingShort: (n) =>
    pluralForm('es', n, {
      one: `${n} proyecto tiene archivos multimedia que no se encuentran`,
      other: `${n} proyectos tienen archivos multimedia que no se encuentran`,
    }),
  unreadableTitle: 'No se puede leer el archivo del proyecto anterior',
  unreadableWhy: 'Puede que el archivo del proyecto anterior esté dañado, así que reintentar probablemente no servirá.',
  unreadableFix:
    'Muéstralo en la carpeta para comprobar que el original sigue ahí y se abre en la versión anterior. Si no lo necesitas, haz clic en «Omitir».',
  unreadableShort: (n) =>
    pluralForm('es', n, {
      one: `${n} archivo de proyecto no se puede leer`,
      other: `${n} archivos de proyecto no se pueden leer`,
    }),
  failedTitle: 'La importación se detuvo a medias',
  failedWhy: 'El proyecto se leyó, pero su importación se detuvo a medias. El informe de importación registra lo que pasó.',
  failedFix:
    'Haz clic en «Reintentar» para volver a intentarlo. Si sigue fallando, muestra el informe en la carpeta. Si no necesitas el proyecto, haz clic en «Omitir».',
  failedShort: (n) =>
    pluralForm('es', n, {
      one: `${n} proyecto se detuvo a mitad de la importación`,
      other: `${n} proyectos se detuvieron a mitad de la importación`,
    }),
  missingMany: (n, first) => `Faltan ${n} archivos, por ejemplo ${first}`,
  missingOne: (file) => `Falta ${file}`,
  missingNone: 'No se encuentran los archivos multimedia',
  failedReport: (report) => `Informe de importación: ${report}`,
  failedNoReport: 'No se escribió ningún informe de importación',
  note: (parts) => `${parts.join('; ')}.`,
  hintOffline: (name) =>
    `Conecta «${name}» y haz clic en «Reintentar todos». Si no haces nada, BaoCut lo volverá a intentar la próxima vez que se inicie. Para gestionarlos uno a uno, abre los detalles.`,
  hintOther: 'En los detalles están el motivo y qué hacer con cada uno. Puedes omitir los que no necesites.',
  subProgress: (done, total) => `Importados ${done}/${total}`,
  subImported: (n) => `Importados ${n}`,
  subPending: (n) => `Por resolver ${n}`,
  subSkipped: (n) => `Omitidos ${n}`,
  subDest: (dest) => `Destino: ${dest}`,
  attention: (n) => `${n} por resolver`,
  phaseImporting: 'Importando',
  phaseWaiting: 'Esperando a otras tareas',
  detailImporting: (title) => `Importando «${title}»`,
  detailWaiting: 'Hay otras tareas en curso, así que la importación está en pausa. Continuará sola cuando terminen.',
  bannerRunning: (done, total) => `Importando proyectos anteriores · ${done}/${total}`,
  bannerResult: (done, pending) => `Importación de proyectos anteriores terminada: ${imported(done)}, ${pending} sin importar`,
  doneAll: (n) =>
    pluralForm('es', n, { one: `${n} proyecto anterior importado`, other: `${n} proyectos anteriores importados` }),
  doneSome: (done, pending) => `Importación terminada: ${imported(done)}, ${pending} sin importar`,
  retriedAll: (n) =>
    pluralForm('es', n, { one: 'Se importó el proyecto reintentado', other: `Se importaron los ${n} proyectos reintentados` }),
  retriedSome: (n, ok) => `De los ${n} reintentados, ${imported(ok)} y ${n - ok} aún sin importar`,
  retriedNone: (n) =>
    pluralForm('es', n, {
      one: 'El proyecto reintentado sigue sin importarse',
      other: `Los ${n} proyectos reintentados siguen sin importarse`,
    }),
  retrying: (n) => pluralForm('es', n, { one: `Volviendo a importar ${n} proyecto`, other: `Volviendo a importar ${n} proyectos` }),
  skipped: (n) =>
    pluralForm('es', n, {
      one: `Se omitió ${n} proyecto. No se importará automáticamente.`,
      other: `Se omitieron ${n} proyectos. No se importarán automáticamente.`,
    }),
  actionFailed: (message) => `No se pudo hacer: ${message}`,
  undo: 'Deshacer',
  viewReasons: 'Ver por qué',
  viewInSpace: 'Ver en Space',
  viewProgress: 'Ver progreso',
  close: 'Cerrar',
  retryAll: 'Reintentar todos',
  skipAll: 'Omitir todos',
  retry: 'Reintentar',
  skip: 'Omitir',
  reveal: 'Mostrar en la carpeta',
  importInstead: 'Importar',
  statImported: 'Importados',
  statPending: 'Sin importar',
  statSkipped: 'Omitidos',
  statLive: 'Aún no importados',
  pendingSection: 'Proyectos sin importar',
  pendingHint: 'Si no haces nada, BaoCut lo volverá a intentar la próxima vez que se inicie. Los omitidos no se importan.',
  howTo: 'Qué hacer: ',
  groupTitle: (title, n) => `${title} · ${n}`,
  liveSection: 'Importando',
  importingChip: 'Importando',
  queuedChip: 'En cola',
  importedSection: 'Importados',
  skippedSection: 'Omitidos',
  skippedHint: 'No se importarán automáticamente. Los archivos originales se quedan donde están.',
  expand: (n) => `Mostrar ${n} más`,
  collapse: 'Mostrar menos',
};
