import { pluralForm } from '@baocut/protocol';
import type { ResourceCapacityMessages } from './resource-capacity-copy.ts';

export const ru: ResourceCapacityMessages = {
  sources: {
    system: "Определено системой",
    setting: "Задано вручную",
    'unified-estimate': "Оценено по объединённой памяти",
    unknown: "Неизвестно",
    statfs: "Свободное место на диске с временными файлами",
  },
  dimensions: { memory: "Память", gpuMemory: "Память GPU", cpuThreads: "Потоки CPU", scratchDisk: "Место для временных файлов" },
  unknown: "Неизвестно",
  threads: (n: number) => pluralForm('ru', n, { one: `${n} поток`, few: `${n} потока`, many: `${n} потоков`, other: `${n} потока` }),
  unifiedMemory: "Общая с основной памятью; использование GPU также учитывается в памяти",
  inUse: (amount) => `${amount} используется`,
  backgroundAvailable: (amount) => `${amount} доступно фоновым задачам`,
  demandPart: (dimension, amount) => `${dimension} ${amount}`,
  joinDemand: (parts) => parts.join(", "),
  noDemand: "Не использует локальные ресурсы",
  auto: "Авто",
  autoWith: (value) => `Авто (${value})`,
};
