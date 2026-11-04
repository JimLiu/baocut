import type { TaskFactsMessages } from './task-facts.ts';

export const tr: TaskFactsMessages = {
  fact: {
    kind: 'Tür',
    submitter: 'Başlatan',
    status: 'Durum',
    startedAt: 'Başlangıç',
    runsOn: 'Çalıştığı yer',
    language: 'Dil',
    request: 'Talimatlar',
    phase: 'Aşama',
    images: 'Görseller',
    took: 'Geçen süre',
    left: 'Kalan süre',
    cost: 'Maliyet',
  },
  imageCount: (count: number) => `${count} görsel`,
};
