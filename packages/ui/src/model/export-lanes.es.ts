import type { ExportLanesMessages } from './export-lanes.ts';
import { pluralForm } from '@baocut/protocol';
export const es: ExportLanesMessages = {
 hidden: 'Oculto en la línea de tiempo', otherSolo: 'Otra pista está en modo solo', muted: 'Silenciado en la línea de tiempo', otherSoloAudio: 'Otra pista está en modo solo', subtitles: 'Subtítulos',
 names: (names: readonly string[]) => names.join(', '), sound: (reason: string) => `Sonido: ${reason}`,
 clips: (n: number) => `${n} ${pluralForm('es', n, { one: 'clip', other: 'clips' })}`,
 sounds: (n: number) => `${n} ${pluralForm('es', n, { one: 'clip de audio', other: 'clips de audio' })}`,
};
