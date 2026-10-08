import type { JobsLocalProviderMessages } from './local-provider.ts';
import { pluralForm } from '../../i18n.ts';
export const es: JobsLocalProviderMessages = {
 assetUnreadable: 'No se pudo leer el material', notHandled: (p) => `El proveedor local no ejecuta ${p.capability}`,
 referenceChanged: 'La grabación de referencia cambió después de enviarla', referenceUnreadable: 'No se pudo leer la grabación de referencia',
 speechOutputWrong: (p) => `El resultado sintetizado no es ${p.file} en staging`, stemOutputWrong: (p) => `El resultado separado no es ${p.file} en staging`, speakersOutputWrong: (p) => `El resultado de identificación de hablantes no es ${p.file} en staging`,
 imageNoInput: 'La generación local de imágenes no tiene un archivo de entrada', imageOutputWrong: (p) => `El resultado de imagen no es ${p.file} en staging`,
 runtimeStopping: 'El Runtime se está cerrando', bundleRequired: 'La inferencia local necesita un paquete de modelos', bundleDisabled: 'El paquete de modelos está desactivado',
 workerBusy: 'El Worker de este paquete de modelos está ejecutando otra tarea', workerVersionChanged: 'La versión del Worker difiere del primer intento, por lo que no se reintentará automáticamente',
 noOutput: 'job.run devolvió completed sin un resultado', workerExitedDuringJob: 'Model Worker terminó durante la tarea', inferenceFailed: (p) => `La inferencia falló: ${p.code}`,
 stagingUnwritable: 'No se pudo escribir el resultado en staging; comprueba el espacio en disco', workerUnsupported: (p) => `Model Worker no admite esta tarea: ${p.message}`, jobRunReturned: (p) => `job.run devolvió ${p.code}`,
 workerNotFound: 'Model Worker (model-worker) no encontrado', workerCannotStart: 'No se pudo iniciar Model Worker', workerExitedOnStart: 'Model Worker terminó justo después de iniciarse',
 handshakeFailed: 'El intercambio inicial de Model Worker falló', contractMismatch: 'La versión del contrato de Model Worker no coincide', backendUnavailable: (p) => `Este Model Worker no puede usar el backend ${p.backend}`,
 cannotSeparate: 'Este Model Worker aún no puede separar voces y fondo localmente con este modelo', cannotGenerateImage: 'Este Model Worker aún no puede generar imágenes localmente con este modelo',
 cannotDiarize: 'Este Model Worker aún no puede identificar hablantes localmente', cannotTranscribe: 'Este Model Worker aún no puede transcribir localmente con este modelo', cannotSynthesize: 'Este Model Worker aún no puede sintetizar voz localmente con este modelo',
 loadFailed: (p) => `La carga del paquete de modelos falló: ${p.reason}`, workerExitedOnLoad: 'Model Worker terminó durante la carga',
 crashedRepeatedly: (p) => `Falló ${p.count} ${pluralForm('es', p.count, { one: 'vez', other: 'veces' })} en ${p.minutes} ${pluralForm('es', p.minutes, { one: 'minuto', other: 'minutos' })}`,
 readingDroppedOne: (p) => `El carácter ${p.at} no se sintetizó con la lectura «${p.reading}» (${p.origin})`, readingDroppedRange: (p) => `Los caracteres ${p.from}–${p.to} no se sintetizaron con la lectura «${p.reading}» (${p.origin})`,
};
