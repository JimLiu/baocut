import type { ResourceCapacityMessages } from './resource-capacity-copy.ts';

export const tr: ResourceCapacityMessages = {
sources: { system: 'Sistem algıladı', setting: 'Elle ayarlandı', 'unified-estimate': 'Birleşik bellekten tahmini', unknown: 'Bilinmiyor', statfs: 'Geçici dosyaların bulunduğu diskteki boş alan' }, dimensions: { memory: 'Bellek', gpuMemory: 'GPU belleği', cpuThreads: 'CPU iş parçacıkları', scratchDisk: 'Geçici disk alanı' }, unknown: 'Bilinmiyor', threads: (n) => `${n} iş parçacığı`, unifiedMemory: 'Bellekle ortak; GPU kullanımı belleğe de sayılır', inUse: (amount) => `${amount} kullanılıyor`, backgroundAvailable: (amount) => `Arka plan görevleri için ${amount} kullanılabilir`, demandPart: (dimension, amount) => `${dimension} ${amount}`, joinDemand: (parts) => parts.join(', '), noDemand: 'Yerel kaynak kullanmaz', auto: 'Otomatik', autoWith: (value) => `Otomatik (${value})`,
};
