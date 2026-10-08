import type { ModelsLocalMessages } from './models-local-copy.ts';
export const es: ModelsLocalMessages = {
 reason: { unsupported: 'No compatible con este ordenador', resource: 'Desactivado', 'worker-missing': 'Falta Model Worker', 'missing-manifest': 'Falta el manifiesto', 'missing-file': 'Faltan archivos', 'size-mismatch': 'El tamaño del archivo no coincide', 'hash-mismatch': 'La suma de verificación no coincide', incomplete: 'Faltan componentes', 'load-failed': 'No se pudo cargar', relocating: 'Moviendo' },
 chipDefault: 'Predeterminado', chipLoading: 'Cargando', chipReady: 'Cargado', chipBusy: 'En curso', chipUnloading: 'Descargando de memoria', chipUnavailable: 'No disponible', chipMissing: (names) => `Falta: ${names.join(', ')}`,
 capability: { transcribe: 'Transcribir', align: 'Alinear', synthesize: 'Sintetizar', image: 'Imagen', separate: 'Separar', diarize: 'Diarización de hablantes' },
 auto: 'Automático', notInstalled: (name) => `${name} (sin instalar)`,
 componentName: { aligner: 'Alineador forzado', speaker: 'Representación del hablante', vad: 'VAD (detección de actividad de voz)', tokenizer: 'Tokenizador', segmentation: 'Segmentación de hablantes', codec: 'Códec de voz', aux: 'Modelos auxiliares' },
 componentDesc: { vad: 'Detecta los tramos en los que alguien habla', aligner: 'Alinea el texto con el tiempo de cada palabra', tokenizer: 'Convierte entre el texto y los tokens del modelo', speaker: 'Distingue a los hablantes', segmentation: 'Detecta dónde empieza y deja de hablar cada persona', codec: 'Convierte los tokens acústicos de nuevo en una forma de onda', aux: 'Modelos adicionales que necesita el modelo principal' }, weights: 'Pesos del modelo',
};
