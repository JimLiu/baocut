import type { ProjectSettingsMessages } from './project-settings-copy.ts';

export const es: ProjectSettingsMessages = {
  menuItem: 'Ajustes del proyecto…',
  title: 'Ajustes del proyecto',
  close: 'Cerrar ajustes del proyecto',
  done: 'Listo',
  loading: 'Comprobando git',
  loadFailed: (message: string) => `No se pudo comprobar git: ${message}`,

  gitHeading: 'git',
  gitLead:
    'BaoCut puede hacer commit de las instantáneas de espacio de trabajo de tus vídeos en el repositorio git en el que está el proyecto. El historial de versiones no necesita git y funciona igual fuera de un repositorio.',
  branch: (name: string) => `Rama ${name}`,
  gitVersion: (version: string) => `git ${version}`,
  checkAgain: 'Comprobar de nuevo',
  sentences: (first: string, second: string | null) => (second ? `${first}. ${second}.` : `${first}.`),

  lightReady: 'Listo',
  lightPaused: (label: string) => `En pausa · ${label}`,
  lightNotRepo: 'No está en un repositorio git',
  lightUnavailable: 'No se encontró git',
  lightError: 'git falló',
  pauseLocked: 'Repositorio en uso',
  pauseMerge: 'Fusión en curso',
  pauseRebase: 'Rebase en curso',
  pauseCherryPick: 'Cherry-pick en curso',
  pauseRevert: 'Revert en curso',
  pauseBisect: 'Bisect en curso',
  pauseDetached: 'HEAD desacoplado',
  pauseLocalConfig: 'Filtros locales',
  pauseLocalConfigChanged: 'Filtros locales modificados',

  pausedHeading: (label: string) => `Commits en pausa: ${label}`,
  pausedNote:
    'Mientras los commits están en pausa, el commit automático y «Hacer commit en git» esperan. Abrir, editar y el historial de versiones no se ven afectados.',
  errorHeading: 'git falló',
  unavailableHeading: 'No se encontró git',

  lcEntry: 'Entrada',
  lcValue: 'Comando o archivo incluido',
  lcExplain:
    'Cuando los permitas, BaoCut seguirá estas entradas al ejecutar git (por ejemplo, para el cifrado con git-crypt). El permiso se guarda solo en este equipo, no en el proyecto, y BaoCut vuelve a pausar si cambian las entradas o los archivos incluidos. Esto no es confiar en la carpeta: abrir, editar y los agentes no se ven afectados.',
  lcWeb:
    'Estas entradas solo se muestran, y solo se pueden permitir, en los ajustes del proyecto de la app de escritorio de BaoCut (o con baocut projects git-allow). Mientras los commits están en pausa, abrir, editar y el historial de versiones no se ven afectados.',
  allow: 'Permitir',
  allowedTitle: 'Filtros locales permitidos',
  allowedText: 'El permiso se guarda en este equipo, no en el proyecto. Ya puedes hacer commit.',
  allowFailed: 'No se permitió',

  commit: 'Hacer commit en git',
  committing: 'Haciendo commit',
  commitDesc: (maxMiB: number) =>
    `Solo incluye en el commit los archivos de BaoCut: las instantáneas de espacio de trabajo de los vídeos con cambios y los materiales de hasta ${maxMiB} MiB. Los demás archivos del proyecto y los cambios que ya hayas preparado (staged) se quedan como están. BaoCut no hace push.`,
  lastCommit: (commit: string, auto: boolean, ago: string) => `Último commit ${commit} · ${auto ? 'automático' : 'manual'} · ${ago}`,
  lastFailed: (message: string) => `El último intento falló: ${message}`,
  committedTitle: 'Commit hecho en git',
  committedText: (commit: string, files: number, videos: string[]) =>
    `Commit ${commit} hecho: ${files === 1 ? '1 archivo' : `${files} archivos`}${videos.length ? `, ${videos.join(', ')}` : ''}.`,
  committedVideo: (name: string, from: number | null, to: number | null) =>
    from === null || to === null ? `«${name}»` : from === to ? `«${name}» versión ${to}` : `«${name}» versiones ${from}–${to}`,
  unnamedVideo: 'un vídeo',
  nothingTitle: 'No hay nada para hacer commit',
  nothingText: 'Los archivos de BaoCut son iguales que en el último commit.',
  commitFailed: 'No se hizo el commit',

  autoCommit: 'Commit automático',
  autoCommitDesc:
    'Hace un commit cuando el proyecto lleva 5 minutos sin cambios, cuando cierras el último vídeo abierto del proyecto o cuando sales de BaoCut. Todos los proyectos de este equipo comparten este ajuste.',

  initTitle: 'Inicializar git',
  initDesc: 'Crea un repositorio git en la carpeta del proyecto para poder hacer commit de las instantáneas en él.',
  initWebNote: 'Solo la app de escritorio de BaoCut o la CLI (baocut projects git-init) pueden crear un repositorio en una carpeta del equipo del Runtime.',
  initRefused: (why: string) => `No disponible aquí: ${why}`,
  initRefusedNote: 'Si necesitas uno, mueve los vídeos a una carpeta de proyecto propia e inicializa git allí.',
  refusalHome:
    'el proyecto es tu carpeta personal. Un repositorio aquí haría que, para otras herramientas, todas las carpetas de tu carpeta personal parecieran parte de él.',
  refusalUserFolder:
    'el proyecto es una carpeta de usuario estándar (como Escritorio, Documentos, Descargas, Películas, Música o Imágenes). Un repositorio aquí haría que, para otras herramientas, todas las carpetas que contiene parecieran parte de él.',
  refusalVolumeRoot: 'el proyecto es la raíz de un disco. Un repositorio aquí haría que todo el disco pareciera parte de él.',
  refusalInsideRepo: 'el proyecto ya está en un repositorio git.',
  initConfirmTitle: '¿Inicializar git en la carpeta del proyecto?',
  initConfirmBody: (path: string) =>
    `Crea un repositorio git en ${path}. Las reglas de exclusión de BaoCut van en el propio .git/info/ del repositorio, así que no cambia ningún archivo del proyecto. No se hace ningún commit ni push.`,
  cancel: 'Cancelar',
  initDoneTitle: 'git inicializado',
  initDoneText: 'Aún no hay ningún commit. Usa «Hacer commit en git» para hacer el primero.',
  initFailed: 'No se inicializó',

  recheckSame: 'No ha cambiado nada',
  recheckReadyTitle: 'Listo para hacer commit',
  recheckReadyText: 'El repositorio ya no está en pausa.',

  outsideHeading: 'Materiales fuera del proyecto',
  outsideLead:
    'Cuando un vídeo usa materiales de fuera de la carpeta del proyecto, su instantánea de espacio de trabajo registra la ruta del material (empezando por ~/ si está en tu carpeta personal; si no, la ruta completa). Después de hacer commit o push, los demás reciben solo la ruta, no el archivo. Para entregar también los materiales, usa un paquete portable.',

  stripLabel: 'git del proyecto',
  projectSettings: 'Ajustes del proyecto',
};
