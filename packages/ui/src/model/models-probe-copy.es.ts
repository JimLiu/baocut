import type { ModelsProbeMessages } from './models-probe-copy.ts';
import { pluralForm } from '@baocut/protocol';
const countEs = (n: number, one: string, other: string) => `${n} ${pluralForm('es', n, { one, other })}`;
export const es: ModelsProbeMessages = {
 speechText: 'Hola, esta es una prueba de síntesis de voz de BaoCut.', noResult: 'La tarea terminó, pero no se recibió ningún resultado.',
 failed: 'La tarea falló.', cancelled: 'La tarea se canceló.', interrupted: 'El Runtime se reinició, por lo que esta prueba no terminó.',
 unknownOutcome: 'El Runtime se reinició antes de que esta llamada recibiera una respuesta, por lo que el resultado es desconocido.',
 audioFacts: (seconds, khz, type) => `${seconds} s · ${khz} kHz · ${type}`,
 videoFacts: (width, height, seconds, type) => `${width} × ${height} · ${seconds} s · ${type}`,
 textFacts: (entries, seconds, type) => `${countEs(entries, 'entrada', 'entradas')} · ${seconds} s · ${type}`,
 packageFacts: (files, type) => `${countEs(files, 'archivo', 'archivos')} · ${type}`,
 projectFacts: (clips, seconds, type) => `${countEs(clips, 'clip', 'clips')} · ${seconds} s · ${type}`,
 chars: (count) => `${count} caracteres`, inputTokens: (count) => `${count} tokens de entrada`, outputTokens: (count) => `${count} tokens de salida`,
 hitLimit: 'Se alcanzó el límite de salida', filtered: 'Bloqueado por el filtro de contenido del proveedor', untested: 'Sin probar', testing: 'Probando…', passed: 'Prueba superada', passedIn: (seconds) => `Prueba superada · ${seconds} s`,
};
