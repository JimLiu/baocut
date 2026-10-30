import type { PlanMessages } from './plan-copy.ts';

export const tr: PlanMessages = {
  title: 'Ajanın onayınızı bekleyen bir planı var',
  modeLabel: 'Uygulama sırasında erişim modu',
  implement: 'Planı uygula',
  keepPlanning: 'Planlamaya devam et',
  hint: 'Ya da mesaj kutusunda ajana neyi değiştireceğini söyleyin.',
  kind: 'Plan',
  approved: (mode) => `Onaylandı · ${mode} ile uygulanıyor`,
  declined: 'Onaylanmadı',
  byMessage: 'Mesajla yanıtlandı',
  cancelled: 'Durduruldu',
  rowLead: 'Plan uygun mu?',
  followUp: 'Yukarıdaki planı uygula.',
  failed: (message) => `Gönderilemedi: ${message}`,
};
