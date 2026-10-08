import type { ServicesMcpMessages } from './services-mcp-copy.ts';
export const es: ServicesMcpMessages = {
 levels: {
 read: { title: 'Solo lectura', desc: 'Ver información del vídeo, transcripciones y estado del procesamiento' },
 ask: { title: 'Preguntar antes de cambiar', desc: 'Confirmar en BaoCut antes de transcribir, editar, exportar o generar' },
 auto: { title: 'Permitir sin preguntar', desc: 'Las escrituras, tareas y generaciones se ejecutan de inmediato sin confirmación; ideal si solo lo usas tú' },
 },
 scopeAll: (total) => `Todos los vídeos (${total})`, scopeNone: 'Ningún vídeo expuesto', scopeOne: (name) => `«${name}»`, scopeSome: (n) => `${n} vídeos seleccionados`,
 access: (level) => `${level} · token obligatorio`, subOn: (scope, access) => `${scope} · ${access}`, subOff: (scope, access) => `Al iniciar: ${scope} · ${access}`,
 groups: {
 read: { label: 'Leer', hint: 'Solo lectura; no modifica vídeos y responde de inmediato' },
 edit: { label: 'Editar', hint: 'Escribe en el vídeo; cada llamada es un paso que se puede deshacer' },
 job: { label: 'Tareas', hint: 'Trabajo de larga duración; devuelve un ID de tarea de inmediato. Usa jobs_inspect para ver el progreso y los resultados' },
 generate: { label: 'Generar', hint: 'Sintetiza voz a partir de texto y crea imágenes a partir de prompts; no necesita un vídeo' },
 },
 tools: {
 videos_list: 'Listar vídeos', videos_create: 'Crear vídeo', videos_inspect: 'Inspeccionar vídeo', documents_read: 'Leer documentos',
 edits_apply: 'Editar vídeo', edits_undo: 'Deshacer cambios', captions_create: 'Crear capa de subtítulos', videos_frames: 'Capturar fotogramas de vídeo',
 videos_history: 'Ver historial de cambios', documents_put: 'Escribir documento', assets_import: 'Importar materiales', compositions_import: 'Importar gráfico animado', compositions_preview: 'Previsualizar gráfico animado', assets_prune: 'Limpiar materiales sin usar', chapters_adopt: 'Usar capítulos de origen', edits_ops: 'Ver operaciones de edición',
 models_capabilities: 'Ver capacidades de modelos', models_list: 'Listar paquetes de modelos locales', transcribe: 'Transcribir', translate: 'Traducir', dub: 'Traducir y doblar',
 speak: 'Sintetizar voz', image: 'Generar imagen', jobs_inspect: 'Consultar tareas', jobs_wait: 'Esperar tarea', jobs_list: 'Listar tareas', jobs_cancel: 'Cancelar tarea',
 jobs_retry: 'Reintentar flujo fallido', export: 'Exportar', space_list: 'Listar elementos de Space', space_search: 'Buscar transcripciones en varios vídeos',
 projects_list: 'Listar proyectos', skills_list: 'Listar skills', skills_read: 'Leer skill', library_list: 'Listar biblioteca', library_show: 'Ver elemento de biblioteca', download: 'Descargar desde enlace',
 },
 gates: { answer: 'Responde directamente', auto: "Se ejecuta directamente", ask: 'Pregunta antes de llamar', hidden: 'No se ofrece con acceso de solo lectura' },
 toolsSummary: (exposed, total, ask, writes) => {
 const tail = ask ? ` · ${ask} preguntan antes de llamar` : writes ? ' · No se necesita confirmación' : ' · Todas de solo lectura';
 return `${exposed} de ${total} herramientas ofrecidas${tail}`;
 },
 outcomes: { ok: 'Completado', denied: 'No permitido', videoNotFound: 'Vídeo fuera del ámbito', unknownTool: 'Herramienta no ofrecida' },
 requestLine: (tool, video) => `${tool} · «${video}»`, joinKinds: (labels) => labels.join(', '),
 grantLine: (kinds, recipient, purpose, estimate) => `Se enviará ${kinds} a ${recipient} (${purpose})${estimate ? ` · Unos ${estimate.amount} ${estimate.currency}` : ''}`,
};
