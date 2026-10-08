import type { ToolUpdateMessages } from './tool-update.ts';
export const es: ToolUpdateMessages = {
  standalone: 'Binario independiente oficial', updateInTerminal: 'Actualizar en Terminal',
  unknownInstall: 'No se puede determinar cómo se instaló este yt-dlp. Ejecuta el comando que corresponda a tu instalación y haz clic en «Comprobar de nuevo».',
  cannotRun: 'BaoCut no puede ejecutar este comando por ti.',
  thenRecheck: 'Después, haz clic en «Comprobar de nuevo».',
  runThenRecheck: 'Ejecuta este comando en Terminal y haz clic en «Comprobar de nuevo».',
  updateWith: (method: string) => `Actualizar con ${method}`,
  stoppedTitle: 'Actualización detenida',
  stoppedBody: 'Puede que el comando solo se haya ejecutado en parte. Revisa la salida de abajo y haz clic en «Comprobar de nuevo» para confirmar la versión actual de yt-dlp.',
  failedTitle: (exitCode: string | null) => exitCode === null ? 'La actualización no terminó' : `La actualización no terminó (código de salida ${exitCode})`,
  failedBody: (error: string | null) => `${error ? `${error.replace(/[。.]$/, '')}. ` : ''}Tu yt-dlp actual no se ve afectado. La salida está abajo; también puedes copiar el comando, ejecutarlo en Terminal y hacer clic en «Comprobar de nuevo».`,
  updatedTo: (version: string) => `Actualizado a ${version}`,
  upToDate: (version: string | null) => version ? `Ya está actualizado (${version})` : 'Ya está actualizado',
  logTruncated: '… (se omitió la salida anterior; la salida completa está en el registro de la tarea)\n',
  logStopped: '(Detenido)', logExitCode: (exitCode: string) => `(Código de salida ${exitCode})`,
};
