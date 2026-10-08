import type { ServicesApiMessages } from './services-api-copy.ts';
import { pluralForm } from '@baocut/protocol';
export const es: ServicesApiMessages = {
 capabilities: { transcribe: 'Transcribir', synthesizeSpeech: 'Sintetizar voz', generateImage: 'Generar imágenes', generateText: 'Generar texto' },
 endpoints: { models: 'Listar modelos', model: 'Obtener un modelo', info: 'Información del servicio y versión de la interfaz', transcriptions: 'Transcribir audio', speech: 'Sintetizar voz', images: 'Generar imágenes', chat: 'Generar texto (chat)' },
 routing: {
 online: { label: 'Servicios en línea', desc: 'Reenviar solicitudes a servicios en la nube conectados (puede tener coste; los datos salen de este ordenador)' },
 nodes: { label: 'Nodos de LAN', desc: 'Reenviar solicitudes a otros ordenadores emparejados' },
 agent: { label: 'Agentes', desc: 'Reenviar solicitudes a runtimes de agentes con sesión iniciada en este ordenador (como Codex)' },
 },
 modelsAvailable: (n) => `${n} ${pluralForm('es', n, { one: 'modelo disponible', other: 'modelos disponibles' })}`,
 notRouted: 'Hay modelos disponibles, pero el enrutamiento está desactivado para su categoría; las solicitudes reciben 503 por ahora',
 noModels: 'Aún no hay modelos disponibles; las solicitudes reciben 503 por ahora', defaultModel: 'Modelo predeterminado',
 target: (provider, model) => `${provider} · ${model}`, aliasProviderMissing: 'No se encuentra este proveedor; las solicitudes reciben 404',
 aliasNotRouted: 'El enrutamiento está desactivado para esta categoría; las solicitudes reciben 404',
 aliasProviderUnavailable: 'Este proveedor no está disponible ahora', aliasModelUnavailable: 'Este modelo no está disponible ahora',
 targetNotRouted: 'Enrutamiento desactivado', targetUnavailable: 'No disponible ahora', aliasNameEmpty: 'Introduce un nombre, como whisper-1',
 aliasNameSlash: 'Los nombres no pueden contener «/»: <provider>/<model> es la forma canónica y los alias no pueden coincidir con ella',
 aliasNameChars: 'Usa solo letras, dígitos y . _ : -, empezando con una letra o un dígito',
 aliasNameTaken: (name) => `«${name}» ya existe; para cambiar su destino, primero elimina esa fila`,
};
