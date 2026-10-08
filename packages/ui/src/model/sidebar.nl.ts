import { pluralForm } from '@baocut/protocol';
import type { SidebarMessages } from './sidebar.ts';
export const nl: SidebarMessages = { status: { waiting: 'Wacht op goedkeuring', failed: 'Mislukt', running: 'Bezig', unread: 'Klaar, ongelezen' }, stopping: 'Bezig met stoppen', count: { waiting: (n) => `${n} ${pluralForm('nl', n, { one: 'wacht', other: 'wachten' })} op goedkeuring`, failed: (n) => `${n} mislukt`, running: (n) => `${n} bezig`, unread: (n) => `${n} klaar, ongelezen` } };
