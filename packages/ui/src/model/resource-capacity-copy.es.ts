import type { ResourceCapacityMessages } from './resource-capacity-copy.ts';
import { pluralForm } from '@baocut/protocol';
export const es: ResourceCapacityMessages = {
 sources: { system: 'Detectado por el sistema', setting: 'Establecido manualmente', 'unified-estimate': 'Estimado a partir de la memoria unificada', unknown: 'Desconocido', statfs: 'Espacio libre en el disco de archivos temporales' },
 dimensions: { memory: 'Memoria', gpuMemory: 'Memoria de GPU', cpuThreads: 'Hilos de CPU', scratchDisk: 'Espacio de disco temporal' },
 unknown: 'Desconocido', threads: (n) => `${n} ${pluralForm('es', n, { one: 'hilo', other: 'hilos' })}`,
 unifiedMemory: 'Compartida con la memoria; el uso de GPU también cuenta como uso de memoria',
 inUse: (amount) => `${amount} en uso`, backgroundAvailable: (amount) => `${amount} disponibles para tareas en segundo plano`,
 demandPart: (dimension, amount) => `${dimension} ${amount}`, joinDemand: (parts) => parts.join(', '), noDemand: 'No usa recursos locales',
 auto: 'Automático', autoWith: (value) => `Automático (${value})`,
};
