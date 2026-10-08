import type { ExportLanesMessages } from './export-lanes.ts';
import { pluralForm } from '@baocut/protocol';
export const nl: ExportLanesMessages = { hidden: 'Verborgen op de tijdlijn', otherSolo: 'Een ander spoor staat op solo', muted: 'Gedempt op de tijdlijn', otherSoloAudio: 'Een ander spoor staat op solo', subtitles: 'Ondertitels', names: (names) => names.join(', '), sound: (reason) => `Geluid: ${reason}`, clips: (n) => `${n} ${pluralForm('nl', n, { one: 'clip', other: 'clips' })}`, sounds: (n) => `${n} ${pluralForm('nl', n, { one: 'audioclip', other: 'audioclips' })}` };
