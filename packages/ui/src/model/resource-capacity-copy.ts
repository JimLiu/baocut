import { defineMessages } from '@baocut/protocol';
import { zhHans } from './resource-capacity-copy.zh-Hans.ts';
import { zhHant } from './resource-capacity-copy.zh-Hant.ts';
import { ja } from './resource-capacity-copy.ja.ts';
import { ko } from './resource-capacity-copy.ko.ts';
import { es } from './resource-capacity-copy.es.ts';
import { fr } from './resource-capacity-copy.fr.ts';
import { de } from './resource-capacity-copy.de.ts';
import { nl } from './resource-capacity-copy.nl.ts';
import { ptBR } from './resource-capacity-copy.pt-BR.ts';
import { it } from './resource-capacity-copy.it.ts';
import { ru } from './resource-capacity-copy.ru.ts';
import { pl } from './resource-capacity-copy.pl.ts';
import { tr } from './resource-capacity-copy.tr.ts';
import { vi } from './resource-capacity-copy.vi.ts';

/** 设置 › 诊断「资源调度」的文案：容量来源、维度名、用量说法与覆盖框占位（译文在 `resource-capacity-copy.<语言>.ts`）。 */
const en = {
  sources: {
    system: 'Detected by system',
    setting: 'Set manually',
    'unified-estimate': 'Estimated from unified memory',
    unknown: 'Unknown',
    statfs: 'Free space on the disk holding temporary files',
  },
  dimensions: { memory: 'Memory', gpuMemory: 'GPU memory', cpuThreads: 'CPU threads', scratchDisk: 'Temporary disk space' },
  unknown: 'Unknown',
  threads: (n: number) => `${n} ${n === 1 ? 'thread' : 'threads'}`,
  unifiedMemory: 'Shared with memory; GPU usage also counts toward memory',
  inUse: (amount: string) => `${amount} in use`,
  backgroundAvailable: (amount: string) => `${amount} available to background tasks`,
  demandPart: (dimension: string, amount: string) => `${dimension} ${amount}`,
  joinDemand: (parts: readonly string[]) => parts.join(', '),
  noDemand: 'Uses no local resources',
  auto: 'Auto',
  autoWith: (value: string) => `Auto (${value})`,
};

export type ResourceCapacityMessages = typeof en;
export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
