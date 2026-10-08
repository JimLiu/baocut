import type { ThreadMessages } from './thread-copy.ts';
import { pluralForm } from '@baocut/protocol';
export const es: ThreadMessages = {
  videoTools: { videos_list: 'Listar vídeos', videos_create: 'Nuevo vídeo', videos_inspect: 'Leer vídeo', edits_apply: 'Editar vídeo', edits_undo: 'Deshacer cambios' },
  toolTitle: (action: string, label: string) => `${action}: ${label}`,
  steps: { command: 'Ejecutar comando', read: 'Leer archivo', edit: 'Editar archivo', search: 'Buscar', other: 'Otra herramienta' },
  phrase: {
    command: 'ejecutó comandos',
    read: (count: number) => `leyó ${count} ${pluralForm('es', count, { one: 'archivo', other: 'archivos' })}`,
    edit: (count: number) => `editó ${count} ${pluralForm('es', count, { one: 'archivo', other: 'archivos' })}`,
    search: 'buscó',
    video: (count: number) => `confirmó ${count} ${pluralForm('es', count, { one: 'cambio de vídeo', other: 'cambios de vídeo' })}`,
    tool: 'llamó a herramientas',
  },
  summary: (phrases: readonly string[]) => { const text = phrases.join(', '); return text.charAt(0).toUpperCase() + text.slice(1); },
  thinking: 'Pensando', stepsFallback: 'Pasos',
};
