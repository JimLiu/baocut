import type { ModelsDirMessages } from './models-dir-copy.ts';
import { pluralForm } from '@baocut/protocol';
const modelsEs = (n: number) => `${n} ${pluralForm('es', n, { one: 'modelo', other: 'modelos' })}`;
const andEs = (items: readonly string[]) => new Intl.ListFormat('es', { type: 'conjunction' }).format(items);
export const es: ModelsDirMessages = {
 dir: {
 title: 'Carpeta de modelos', defaultChip: 'Predeterminada', envChip: 'Variable de entorno', change: 'Cambiar…', restore: 'Restaurar valor predeterminado',
 envNote: 'Establecida por la variable de entorno BAOCUT_MODELS_DIR. Para cambiarla, edita la variable de entorno y reinicia BaoCut.',
 shareHint: 'Si otras aplicaciones comparten esta carpeta, eliminar un modelo aquí elimina sus archivos de la carpeta y esas aplicaciones tampoco los encontrarán.',
 blockedPrefix: 'No se puede cambiar ahora:', viewTasks: 'Ver tareas', changeTitle: 'Cambiar carpeta de modelos', restoreTitle: 'Restaurar ubicación predeterminada',
 restoreLead: 'Cambiar la carpeta de modelos de nuevo a', checking: 'Revisando esta carpeta…', cancel: 'Cancelar', howTo: 'Qué hacer con los modelos existentes',
 moveOption: 'Mover allí los modelos existentes', switchOption: 'Cambiar solo la ubicación', confirmMove: 'Mover y cambiar', confirmSwitch: 'Cambiar ubicación',
 movingLabel: 'Moviendo modelos', stayOpen: 'No cierres BaoCut mientras tanto',
 missingDir: 'Esta carpeta no existe (también ocurre cuando una unidad externa no está conectada). Los modelos vuelven a funcionar al conectarla, o puedes elegir otra ubicación.',
 notWritableDir: 'BaoCut no tiene permiso para escribir en esta carpeta, por lo que no se pueden descargar modelos en ella.',
 loading: 'Leyendo la carpeta de modelos…', pickFailed: (message) => `No se pudo elegir la carpeta: ${message}`, same: 'Esta ya es la carpeta de modelos actual',
 },
 stats: (used, free, count) => [`${used} usados`, ...(free !== null ? [`${free} libres en el disco`] : []), `${modelsEs(count)} encontrados`].join(' · '),
 blocker: (downloading, testing, tasks) => {
 const parts: string[] = [];
 if (downloading.length) parts.push(`descargando ${andEs(downloading)}`);
 if (testing.length) parts.push(`comprobando ${andEs(testing)}`);
 if (tasks) parts.push(`${tasks} ${pluralForm('es', tasks, { one: 'tarea está usando', other: 'tareas están usando' })} modelos locales`);
 const text = parts.join('; ');
 return `${text.charAt(0).toUpperCase() + text.slice(1)}. Espera a que terminen antes de cambiar; de lo contrario, se moverían archivos mientras están en uso.`;
 },
 missingTitle: 'No se encuentra esta carpeta', missingText: 'Esta carpeta no existe. También ocurre cuando una unidad externa no está conectada; conéctala y vuelve a elegir.',
 notWritableTitle: 'No se puede escribir en esta carpeta',
 notWritableText: 'BaoCut no tiene permiso para escribir en esta carpeta, por lo que no se pueden descargar modelos en ella. Elige una ubicación con permiso de escritura o cambia sus permisos primero.',
 nestedTitle: 'No se puede colocar aquí', nestedText: 'La ubicación nueva y la carpeta de modelos actual se contienen entre sí (una está dentro de la otra). Elige una carpeta que no esté dentro de ella ni la contenga.',
 found: (count, bytes, free) => `${count ? `Se encontraron ${modelsEs(count)} descargados (${bytes}), disponibles para usar.` : 'Aún no hay modelos en esta carpeta. Los modelos que descargues después irán aquí.'}${free !== null ? ` ${free} libres en el disco.` : ''}`,
 moveNoFit: (required, free, short) => `Mover requiere ${required}, pero la unidad de destino solo tiene ${free} libres (faltan ${short}). No cabrá.`,
 moveSameVolume: (size) => `Mueve ${size} en la misma unidad, por lo que es rápido. Los archivos no se conservarán en la ubicación anterior después.`,
 moveOther: (size) => `Mueve ${size}. Los archivos no se conservarán en la ubicación anterior después.`,
 switchDescription: (count) => `Los archivos de la ubicación anterior se conservan, no se eliminan. Solo se pueden usar los ${count ? `${modelsEs(count)} ` : 'modelos '}que ya están en la ubicación nueva; el resto aparecen como no instalados.`,
 appliedMoving: (where) => `Se empezó a mover los modelos a ${where}`, appliedKept: (where) => `Carpeta de modelos cambiada a ${where} · Los archivos de la ubicación anterior se conservan`,
 applied: (where) => `Carpeta de modelos cambiada a ${where}`, moveWaiting: (to) => `Esperando para empezar a mover${to ? ` a ${to}` : ''}…`,
 moveValidating: (amount) => `Verificando los archivos copiados${amount ? ` (${amount})` : ''}…`, movePublishing: 'Terminando el traslado…',
 moving: (amount, to) => `Moviendo${amount ? ` ${amount}` : ''}${to ? ` a ${to}` : ''}…`,
};
