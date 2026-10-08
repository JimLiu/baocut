import { TEXT_EFFORTS } from '@baocut/protocol';
import type { TextMessages } from './text-copy.ts';
export const es: TextMessages = {
 help: `Uso:
  baocut text <prompt> [options]   Llamar una vez a un modelo de texto; un prompt de - se lee de stdin. El texto completo va
                                   a stdout (con --out va al archivo y stdout recibe la tarea y el
                                   resultado como JSON); el progreso, las advertencias y la versión del modelo van a stderr
    --system <text>                Mensaje de sistema
    --json-schema <file>           Salida estructurada: se devuelve y valida con este JSON Schema (su
                                   raíz es un objeto); si no coincide, la tarea falla con MODEL_OUTPUT_INVALID
    --provider <id>                Proveedor del catálogo como openai, google o anthropic, o custom:<name>;
                                   el predeterminado si se omite (esta capacidad no tiene predeterminado integrado)
    --model <id>                   Modelo; el predeterminado del proveedor si se omite
    --max-output-tokens <n>        Límite de salida; el del modelo si se omite. El texto sin formato recortado
                                   se imprime igualmente, con una advertencia output-truncated
    --effort <${TEXT_EFFORTS.join('|')}>
                                   Esfuerzo de razonamiento; el nivel más cercano si el modelo no tiene este,
                                   se ignora si no puede ajustarlo (se explica en stderr)
    --temperature <0–2>            Solo para modelos que lo admiten
    --seed <n>                     Solo para modelos que lo admiten
    --out <file>                   Escribir el texto completo en este archivo`,
 stdinPromptHint: 'Escribe el prompt y pulsa Ctrl-D para terminar:', missingPrompt: 'Falta el prompt', jsonSchemaUnreadable: (file, reason) => `No se puede leer el JSON Schema ${file}: ${reason}`, jsonSchemaNotObject: 'El archivo --json-schema debe contener un objeto JSON', singleModel: 'text solo acepta un --model', maxOutputTokensInvalid: '--max-output-tokens debe ser un entero positivo', effortChoices: (efforts) => `--effort debe ser uno de ${efforts.join(', ')}`, temperatureRange: '--temperature debe estar entre 0 y 2', seedInvalid: '--seed debe ser un entero', noTextResult: 'La tarea terminó, pero no devolvió texto', fetchOutputFailed: (artifactId, status) => `No se pudo obtener el resultado ${artifactId}: HTTP ${status}`, written: (file) => `Escrito ${file}`, modelLine: (provider, model, usage) => `${provider} / ${model}${usage ? `, entrada ${usage.input} / salida ${usage.output} tokens` : ''}`,
};
