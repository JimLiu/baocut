import type { JobsPipelineRunnerMessages } from './pipeline-runner.ts';
export const es: JobsPipelineRunnerMessages = {
 unknownPipeline: (p) => `No hay un flujo llamado «${p.name}»`, entryTargetUnsupported: 'Este Runtime no puede abrir vídeos desde elementos de Space', targetMismatch: 'Los parámetros target y videoId hacen referencia a vídeos diferentes',
 noLibrary: 'Este Runtime no tiene una biblioteca del usuario', notPipeline: 'Esta tarea no es un flujo', notRetryable: 'Solo se pueden reintentar flujos fallidos, cancelados o interrumpidos',
 pipelineMissing: (p) => `Este Runtime no tiene un flujo llamado «${p.name}»`, alreadyRetrying: 'El flujo ya se está reintentando', cannotOpenTarget: 'Este Runtime no puede abrir el vídeo de destino del flujo',
 targetReplaced: 'Ahora hay otro vídeo en la ubicación de destino. Empieza de nuevo.', pipelineFailed: 'El flujo encontró un error', stepFailed: 'El paso encontró un error',
 interrupted: 'El Runtime se detuvo antes de terminar el flujo. Usa pipelines.retry para continuar desde el paso donde se detuvo.', subtask: (p) => `${p.step}: ${p.label}`,
};
