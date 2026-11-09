import type { StandaloneMessages } from './standalone-copy.ts';

export const es: StandaloneMessages = {
  cliHelp: `Uso:
  baocut cli install               Instala este paquete de línea de comandos para tu usuario y pone baocut en el PATH. El
                                   paquete se copia a ~/.local/share/baocut/versions/<versión> (Windows:
                                   %LOCALAPPDATA%\\BaoCut\\cli\\versions\\<versión>) salvo que ya esté ahí. macOS: un enlace
                                   en ~/.local/bin/baocut. Windows: %LOCALAPPDATA%\\BaoCut\\bin\\baocut.cmd, con esa carpeta
                                   añadida al PATH de tu usuario. No hacen falta permisos de administrador
  baocut cli status                Dónde está baocut, a qué versión instalada apunta y qué baocut encuentra tu terminal
  baocut cli remove                Quita lo que puso baocut cli install; las versiones instaladas se quedan. Lo que haya en
                                   esa ruta y no haya puesto BaoCut nunca se reemplaza ni se borra`,
  help: `baocut update [--check | --rollback]

Actualiza el paquete independiente de línea de comandos: lee el mismo feed de actualizaciones que la app de BaoCut,
descarga el paquete de línea de comandos de la versión más reciente, comprueba su tamaño y su sha256 (y en macOS su firma
y su notarización), lo instala junto a la versión actual y hace que baocut apunte a él. La versión anterior se conserva
para --rollback; las más antiguas que ya no use ningún Runtime se eliminan.
  --check      Solo indica si hay una versión más reciente
  --rollback   Vuelve a la versión anterior
Un Runtime que ya esté en ejecución sigue con la versión antigua hasta que se detenga (baocut runtime stop).
Solo el paquete independiente se actualiza así: la app de BaoCut se actualiza sola; lo instalado con Homebrew, con brew upgrade.
Define BAOCUT_UPDATE_APPCAST para leer otro feed (una URL o un archivo local, para pruebas).`,
  version: (version, build) => `${version} (build ${build})`,
  state: {
    none: 'Sin instalar',
    current: 'Apunta a la versión actual',
    stale: 'Apunta a otro BaoCut',
    broken: 'Apunta a una ubicación que ya no existe',
    foreign: 'Hay otra cosa (no se toca)',
  },
  statusPackage: (version, root) => `Paquete   ${version}  ${root}`,
  statusVersions: (versions, root) => `Versiones ${versions.join(', ')}  ${root}`,
  statusNoVersions: (root) => `Aún no hay nada instalado en ${root}: baocut cli install copia este paquete ahí`,
  currentMark: ' (actual)',
  previousMark: ' (anterior)',
  copied: (dest, from) => `Paquete copiado a ${dest}; ${from} ya no hace falta`,
  versionsKept: (dir) => `Las versiones instaladas se quedan en ${dir}: borra esa carpeta para quitarlas`,
  entryTaken: (path) =>
    `${path} no lo puso BaoCut, así que no se toca. Muévelo o bórralo tú y vuelve a ejecutar baocut cli install`,
  pathFailed: (dir) => `No se pudo añadir ${dir} al PATH de tu usuario: añádelo en Propiedades del sistema → Variables de entorno`,
  copyFailed: (from, dest, detail) => `No se pudo copiar ${from} a ${dest}${detail ? `: ${detail}` : ''}`,
  updateUsage: (token) => `baocut update acepta --check o --rollback (uno de los dos): ${token}`,
  updateUnavailable:
    'baocut update actualiza el paquete independiente de línea de comandos. Este baocut pertenece a la app de BaoCut, que se actualiza sola (BaoCut → Comprobar actualizaciones), o a Homebrew (brew upgrade --cask baocut)',
  upToDate: (current) => `Al día: ${current}`,
  available: (latest, current) => `${latest} está disponible (tienes ${current})`,
  downloading: (version, build, megabytes) => `Descargando ${version} (build ${build}), ${megabytes} MB…`,
  updated: (from, to) => `Actualizado ${from} → ${to}`,
  rolledBack: (from, to) => `Se volvió de ${from} a ${to}`,
  rollbackHint: 'Para volver atrás: baocut update --rollback',
  entrySwitched: (path) => `${path} ahora apunta a esa versión`,
  entryNotInstalled: (path) => `${path} no está instalado: baocut cli install pone baocut en el PATH`,
  entryLeftAlone: (path) =>
    `${path} apunta a algo que no es este paquete y no se ha tocado: baocut cli install lo hace apuntar aquí`,
  removedVersions: (versions) => `Versiones antiguas eliminadas: ${versions.join(', ')}`,
  runtimeStillRunning: (pid) =>
    `Un Runtime (pid ${pid}) sigue ejecutando la versión con la que se inició; cuando se detenga, el siguiente comando iniciará la nueva (baocut runtime stop lo detiene ahora)`,
  systemTooOld: (required, system) => `La nueva versión necesita macOS ${required}; este Mac tiene ${system}`,
  feedFailed: (url, detail) => `No se pudo leer el feed de actualizaciones ${url}: ${detail}`,
  feedMissing: (url) =>
    `El feed de actualizaciones ${url} aún no tiene paquete de línea de comandos: vuelve a intentarlo tras la próxima versión`,
  downloadFailed: (url, detail) => `No se pudo descargar ${url}: ${detail}`,
  verifyFailed: (detail) => `El paquete descargado no superó las comprobaciones y no se instaló: ${detail}`,
  unsignedBuild:
    'Este paquete no está firmado, así que no puede comprobar la firma de una actualización. Descarga el paquete independiente desde la página de versiones de BaoCut',
  noPrevious: (dir) => `No hay ninguna versión anterior a la que volver en ${dir}`,
  inProgress: (pid) => `Hay otro baocut update (pid ${pid}) en ejecución: espera a que termine`,
};
