import type { RcGitMessages } from './rc-git.ts';

export const es: RcGitMessages = {
  gitPurpose: 'Hace commit en git de los archivos de BaoCut de un proyecto (opcional)',
  gitMissingRemedyMac: 'Instala git: ejecuta xcode-select --install en Terminal para obtener las Command Line Tools, o instálalo con Homebrew (brew install git)',
  gitMissingRemedyWin: 'Instala Git for Windows desde https://git-scm.com/download/win',
  gitMissingRemedyLinux: 'Instala git con tu gestor de paquetes',
  xcodeStub: '/usr/bin/git solo ofrece instalar las Command Line Tools hasta que estén instaladas',

  notRepo: 'Este proyecto no está en un repositorio git',
  initRemedy: 'Usa «Inicializar git» en los ajustes del proyecto de la app de escritorio de BaoCut o ejecuta baocut projects git-init, o ejecuta tú mismo git init donde quieras el repositorio',
  initHome: 'BaoCut no crea un repositorio git en tu carpeta personal: todas las carpetas que contiene parecerían parte de un mismo repositorio para otras herramientas',
  initUserFolder: (p) =>
    `BaoCut no crea un repositorio git en una carpeta de usuario estándar (${p.path}): todas las carpetas que contiene parecerían parte de un mismo repositorio para otras herramientas`,
  initVolumeRoot: 'BaoCut no crea un repositorio git en la raíz de un volumen o unidad',
  initInsideRepo: 'Este proyecto ya está en un repositorio git',
  initElsewhere: 'Primero mueve el proyecto a su propia carpeta, o ejecuta git init tú mismo donde quieras el repositorio',
  pausedLocked: 'Otro comando de git está usando el repositorio (existe index.lock)',
  lockedRemedy: 'Deja que termine el otro comando de git. BaoCut lo intenta de nuevo en el siguiente commit y nunca borra el archivo de bloqueo; si no hay ningún comando de git en marcha, bórralo tú',
  pausedMerge: 'El repositorio está en medio de una fusión (merge)',
  pausedRebase: 'El repositorio está en medio de un rebase',
  pausedCherryPick: 'El repositorio está en medio de un cherry-pick',
  pausedRevert: 'El repositorio está en medio de un revert',
  pausedBisect: 'El repositorio está en medio de un bisect',
  pausedDetached: 'HEAD está desacoplado (el repositorio no está en ninguna rama)',
  repoStateRemedy: 'Termínalo o anúlalo en git; después BaoCut vuelve a hacer commits',
  detachedRemedy: 'Cambia a una rama en git; después BaoCut vuelve a hacer commits',
  pausedLocalConfig:
    'La configuración local del repositorio ejecuta programas o incluye otros archivos (filtros o include), así que BaoCut no ejecuta comandos de git que lean tus archivos',
  pausedLocalConfigChanged: 'Los filtros o include locales del repositorio cambiaron después de que los permitieras, así que BaoCut volvió a pausar sus commits',
  localConfigRemedy: 'Revisa las entradas y los comandos que ejecutan, y luego permítelos en los ajustes del proyecto de la app de escritorio de BaoCut o con baocut projects git-allow',
  gitFailed: (p) => `git falló en este repositorio: ${p.detail}`,

  manageOnlyInAppOrCli: 'Solo la aplicación de escritorio o la CLI pueden inicializar git o permitir filtros locales',
  digestChanged: 'La configuración local cambió después de revisarla; revisa las entradas de nuevo',
  commitFailed: (p) => `No se pudo hacer commit en git: ${p.detail}`,
  initFailed: (p) => `No se pudo inicializar git: ${p.detail}`,

  commitSummary: (p) => `Hacer commit en git de los archivos de BaoCut del proyecto «${p.name}»`,
  commitTitle: (p) => `BaoCut: actualizar ${p.names}`,
};
