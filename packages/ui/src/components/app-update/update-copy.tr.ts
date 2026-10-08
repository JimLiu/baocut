import type { UpdateMessages, UpdateStep } from './update-copy.ts';

const STEP: Record<UpdateStep, string> = {'install': 'Yükleme başlatılamadı', 'check': 'Güncellemeler denetlenemedi', 'download': 'İndirme başlatılamadı', 'cancel': 'İndirme iptal edilemedi', 'retry': 'Yeniden denenemedi', 'downloadPage': 'İndirme sayfası açılamadı'};

export const tr: UpdateMessages = {
failed: (step, message) => `${STEP[step]}: ${message}`, progress: 'İndirme ilerlemesi', notes: 'Bu sürümdeki yenilikler', close: 'Kapat',
};
