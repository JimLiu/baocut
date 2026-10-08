import type { DriversPiMessages } from './drivers-pi.ts';
export const es: DriversPiMessages = {
 plan: 'Cuentas de modelos en Pi', installHint: 'Instala Pi con npm (npm install -g @earendil-works/pi-coding-agent, necesita Node.js)',
 signedOut: 'Pi no ha iniciado sesión. Ejecuta pi en un terminal e introduce /login, o establece una clave de API de un proveedor de modelos (por ejemplo, ANTHROPIC_API_KEY).',
 rpcFailed: (p) => `El modo RPC de Pi no pudo iniciarse: ${p.error}`, processStartFailed: (p) => `El proceso de Pi no pudo iniciarse: ${p.error}`,
 processExited: (p) => `El proceso de Pi terminó (código ${p.code}, señal ${p.signal})${p.tail ? `: ${p.tail}` : ''}`, processClosed: 'El proceso de Pi está cerrado',
 requestTimeout: (p) => `Pi no respondió a ${p.command} en ${p.ms} ms`, stdinUnwritable: 'No se puede escribir en stdin de Pi', commandFailed: (p) => `${p.command} de Pi falló`,
 toolFallback: 'Herramienta', sessionFileMissing: 'archivo de sesión no encontrado', withStderr: (p) => `${p.error} (${p.tail})`,
 mcpNameInvalid: (p) => `El nombre del servidor MCP ${p.name} contiene caracteres que Pi no admite (solo letras, dígitos, _ y -), por lo que no se puede usar en esta sesión.`,
 modelFormat: (p) => `Los modelos de Pi deben escribirse como provider/id: ${p.model}`, switchModelFailed: (p) => `Pi no pudo cambiar al modelo ${p.model}: ${p.error}`,
 effortUnsupported: (p) => `Pi no tiene el nivel de esfuerzo de razonamiento «${p.level}», por lo que este turno usa su ajuste actual.`,
 effortFailed: (p) => `Pi no pudo establecer el esfuerzo de razonamiento (${p.error}), por lo que este turno usa su ajuste actual.`,
 mcpConnectFailed: (p) => `Pi no pudo conectarse al servidor MCP de BaoCut, por lo que las herramientas de BaoCut (leer y escribir proyectos, subtítulos y demás) no están disponibles en esta sesión: ${p.error}`,
 extensionError: (p) => `Una extensión de Pi falló: ${p.error}`, modelCallFailed: 'La llamada al modelo de Pi falló', notice: (p) => `Pi: ${p.message}`,
 extensionAsked: (p) => `Una extensión de Pi quería preguntarte algo${p.title ? ` («${p.title}»)` : ''}. BaoCut aún no puede transmitir este tipo de pregunta, por lo que la canceló por ti.`,
 fullAccessOnly: (p) => `Pi no puede preguntar antes de cada acción, por lo que BaoCut solo puede ejecutarlo en modo «${p.mode}»: no preguntará antes de ejecutar comandos o cambiar archivos.`,
};
