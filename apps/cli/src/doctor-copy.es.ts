import type { DoctorMessages } from './doctor-copy.ts';

export const es: DoctorMessages = {
  help: [
    'baocut doctor',
    '',
    'Por qué BaoCut no arranca o no puede leer algo: qué baocut encuentran los terminales, qué Runtime iniciaría',
    'la CLI y con qué directorio, si responde el almacén de credenciales y el Acceso total al disco en macOS.',
    'Cada comprobación es ok, warn, fail o skip, con un comando de solución cuando lo hay; next es la solución',
    'del primer problema. Solo lectura: nunca inicia un Runtime ni lee ninguna clave (la comprobación del Llavero',
    'solo pregunta si existe una clave inventada). Pregunta al usuario antes de ejecutar las soluciones.',
    '',
    'Opciones: --json',
  ].join('\n'),
  checkName: {
    entry: 'Línea de comandos',
    runtime: 'Runtime',
    credentials: 'Credenciales',
    fullDiskAccess: 'Acceso total al disco',
  },
  remedyLabel: 'solución',

  entryApp: (found, version) => `Los terminales ejecutan ${found}, la línea de comandos de la app de BaoCut${version ? ` ${version}` : ''}`,
  entryOtherApp: (found, target, app) =>
    `Los terminales ejecutan ${found} (${target}), no la línea de comandos de la app de BaoCut en ${app}`,
  entryNoApp: (found, target) => `Los terminales ejecutan ${found} (${target}); no se encontró la app de BaoCut`,
  entryMissing: 'Los terminales no encuentran baocut. Instálalo desde la app de BaoCut (no hacen falta permisos de administrador).',
  entryMissingNoApp: 'Los terminales no encuentran baocut y no se encontró la app de BaoCut en las ubicaciones habituales',

  runtimeRunning: (version, pid, by) =>
    `En ejecución: versión ${version}, proceso ${pid}, iniciado por ${by === 'cli' ? 'la línea de comandos' : 'la app de BaoCut'}`,
  runtimeStopped: (entry) => `No está en ejecución. El próximo comando lo inicia en segundo plano con ${entry}`,
  runtimeUnreachable: (pid, reason) => `Hay un Runtime en ejecución (proceso ${pid}), pero no responde: ${reason}`,
  runtimeNoLaunch:
    'No está en ejecución y no hay ningún Runtime que iniciar: instala la app de BaoCut, ejecuta desde el repositorio o establece BAOCUT_RUNTIME_ENTRY en la entrada del Runtime.',

  credentialsFile: (file) => `Esta versión guarda las claves en un archivo: ${file}`,
  credentialsKeychain: (platform) =>
    platform === 'win32' ? 'El Administrador de credenciales de Windows responde' : 'El Llavero de macOS responde',
  credentialsDenied:
    'El Llavero denegó el acceso. Por SSH o sin una sesión iniciada en el escritorio, macOS puede mantenerlo bloqueado: ejecuta baocut en un terminal del escritorio o desbloquea el llavero de inicio de sesión.',
  credentialsNoHelper: (file) =>
    `Falta el asistente de credenciales${file ? ` (${file})` : ''}, así que no se pueden leer las claves. Reinstala la app de BaoCut.`,
  credentialsUnavailable: (reason) => `No se pudo acceder al almacén de credenciales: ${reason}`,
  credentialsUnknown: 'BAOCUT_RUNTIME_ENTRY decide dónde se guardan las claves; no se comprobó',
  credentialsTimedOut: (seconds) => `el asistente no respondió en ${seconds} s`,

  fdaGranted: 'El Acceso total al disco está activado',
  fdaMissingApp:
    'El Acceso total al disco está desactivado para BaoCut.app, así que puede que no se lean los archivos de ubicaciones protegidas (Escritorio, Documentos, Descargas, otros discos). Activa BaoCut en Ajustes del Sistema › Privacidad y seguridad › Acceso total al disco y vuelve a ejecutar baocut doctor.',
  fdaMissingCli: (app) =>
    `El Acceso total al disco está desactivado para el Runtime que inició la línea de comandos; macOS se lo atribuye a ${app ?? 'la app que ejecutó el comando (tu terminal o la app que aloja al agente)'}. Activa esa app en Ajustes del Sistema › Privacidad y seguridad › Acceso total al disco y vuelve a abrirla, o detén este Runtime (baocut runtime stop) y abre la app de BaoCut; después vuelve a ejecutar baocut doctor.`,
  fdaNotRunning: 'Solo se comprueba con un Runtime en ejecución',
};
