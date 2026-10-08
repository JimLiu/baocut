import type { ModelCheckMessages, CheckSubject } from './model-check-copy.ts';
const outputWrong: Record<CheckSubject, string> = {
 transcribe: 'El modelo se ejecuta, pero no puede reconocer la voz de la muestra',
 synthesize: 'El modelo se ejecuta, pero la voz que produce no es correcta',
 image: 'El modelo se ejecuta, pero la imagen que dibuja no es correcta',
 separate: 'El modelo se ejecuta, pero no separó la voz del fondo',
};
export const es: ModelCheckMessages = {
 label: { check: 'Comprobar', checkFull: 'Comprobar modelo', recheck: 'Comprobar de nuevo', repair: 'Reparar…', repairSub: 'Solo vuelve a descargar los archivos dañados', details: 'Detalles técnicos', hideDetails: 'Ocultar detalles técnicos', copy: 'Copiar detalles técnicos', copied: 'Detalles técnicos copiados', copyFailed: 'No se pudo copiar. Selecciona el texto de arriba y cópialo tú.', cancel: 'Cancelar', retry: 'Reintentar', pickRef: 'Elegir otra grabación…', useSample: 'Usar grabación de muestra' },
 caption: 'Comprobar confirma que un modelo funciona; Reparar solo vuelve a descargar los archivos dañados. Al eliminar un modelo, se conservan los componentes compartidos que otros modelos todavía usan.',
 head: { running: 'Comprobando…', repairing: 'Reparando…', failed: 'La comprobación falló:', notStarted: 'No se pudo iniciar la comprobación:' },
 sentence: (text) => `${text}.`,
 phase: { queued: 'En cola', loading: 'Cargando el modelo', running: 'Ejecutando una muestra breve', verifying: 'Verificando el resultado', repairing: 'Descargando de nuevo los archivos dañados; se comprueba automáticamente al terminar la reparación' },
 checkSentences: {
 APP_FILE_MISSING: () => ({ text: 'Falta un archivo incluido en BaoCut; no es un problema del modelo', todo: 'Reinstalar BaoCut lo soluciona. Los modelos que ya has descargado no se ven afectados.' }),
 MODEL_FILES_DAMAGED: () => ({ text: 'Los archivos del modelo están dañados', todo: 'Reparar vuelve a descargar los archivos dañados.' }),
 MODEL_OUTPUT_WRONG: (subject) => ({ text: outputWrong[subject], todo: 'Primero repáralo. Si sigue ocurriendo después de reparar, copia los detalles técnicos y envíanoslos.' }),
 MODEL_OUT_OF_MEMORY: () => ({ text: 'No hay suficiente memoria, por lo que el modelo no pudo cargarse', todo: 'Cierra otros modelos grandes o aplicaciones que consuman mucha memoria y comprueba de nuevo.' }),
 MODEL_WORKER_FAILED: () => ({ text: 'El proceso en segundo plano que ejecuta el modelo encontró un error', todo: 'Comprueba de nuevo. Si sigue ocurriendo, reinicia BaoCut o copia los detalles técnicos y envíanoslos.' }),
 },
 unknown: { text: 'El modelo no funcionó correctamente', todo: 'Comprueba de nuevo. Si sigue ocurriendo, copia los detalles técnicos y envíanoslos.' },
 notStarted: {
 RUNTIME_UNREACHABLE: { text: 'El servicio en segundo plano de BaoCut no responde', todo: 'Comprueba de nuevo más tarde. Si sigue ocurriendo, reinicia BaoCut.' },
 MODEL_IN_USE: { text: 'Otra tarea está usando este modelo', todo: 'Espera a que termine esa tarea o cancélala en Tareas en segundo plano y comprueba de nuevo.' },
 MODEL_UNAVAILABLE: { text: 'Este modelo no se puede usar ahora', todo: 'Primero repáralo o actívalo de nuevo y comprueba de nuevo.' },
 RESOURCE_ADMISSION_UNSATISFIABLE: { text: 'Este ordenador no tiene memoria suficiente para ejecutar este modelo', todo: 'Cambia a un modelo más pequeño.' },
 WEB_METHOD_NOT_ALLOWED: { text: 'No se pueden comprobar modelos locales en el navegador', todo: 'Compruébalo en la aplicación de escritorio.' },
 OFFLINE_STRICT: { text: 'El modo sin conexión estricto está activado', todo: 'Desactívalo en Ajustes y comprueba de nuevo.' },
 },
 notStartedUnknown: { text: 'BaoCut no aceptó esta comprobación', todo: 'Comprueba de nuevo más tarde. Si sigue ocurriendo, copia los detalles técnicos y envíanoslos.' },
 detail: { code: (code) => `Código ${code}`, model: (id, when) => `Modelo ${id} · ${when}`, message: (message) => `Mensaje ${message}`, passed: (when) => `Comprobación superada · ${when}` },
 noticeText: (what) => `Este modelo no superó su última comprobación: ${what}`,
 refUnreadable: (file) => ({ text: `No se pudo leer tu grabación «${file}». Puede que el archivo esté dañado o no sea audio`, todo: 'Prueba otra grabación o escucha primero cómo suena con la grabación de muestra.' }),
 refUnknown: 'grabación',
 trySpeech: {
 noMemory: { text: 'No hay suficiente memoria para terminar la síntesis', todo: 'Cierra otros modelos grandes o aplicaciones que consuman mucha memoria y vuelve a intentarlo.' },
 modelError: { text: 'El modelo encontró un error y no produjo audio', todo: 'Comprueba el modelo para ver qué falló.' },
 other: (message) => ({ text: `No se pudo sintetizar: ${message}`, todo: 'Puedes volver a intentarlo. Si sigue ocurriendo, consulta los detalles en Tareas en segundo plano.' }),
 notStarted: (message) => ({ text: `No se pudo iniciar la síntesis: ${message}`, todo: '' }), noticeTodo: (todo) => `${todo} Es muy probable que una vista previa ahora también falle.`,
 },
 tryImage: {
 noMemory: { text: 'No hay suficiente memoria para terminar el dibujo', todo: 'Cierra otros modelos grandes y vuelve a intentarlo o reduce los pasos.' },
 modelError: { text: 'El modelo encontró un error y no dibujó nada', todo: 'Comprueba el modelo para ver qué falló.' },
 other: (message) => ({ text: `No se pudo dibujar: ${message}`, todo: 'Puedes volver a intentarlo. Si sigue ocurriendo, consulta los detalles en Tareas en segundo plano.' }),
 notStarted: (message) => ({ text: `No se pudo iniciar el dibujo: ${message}`, todo: '' }), noticeTodo: (todo) => `${todo} Es muy probable que un dibujo de prueba ahora también falle.`,
 },
};
