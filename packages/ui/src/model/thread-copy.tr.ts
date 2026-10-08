import type { ThreadMessages } from './thread-copy.ts';

export const tr: ThreadMessages = {
  videoTools: {
    videos_list: 'Videoları listele',
    videos_create: 'Yeni video',
    videos_inspect: 'Videoyu oku',
    edits_apply: 'Videoyu düzenle',
    edits_undo: 'Düzenlemeleri geri al',
  },
  toolTitle: (action: string, label: string) => `${action}: ${label}`,
  steps: { command: 'Komut çalıştır', read: 'Dosyayı oku', edit: 'Dosyayı düzenle', search: 'Ara', other: 'Diğer araç' },
  phrase: {
    command: 'komutlar çalıştırdı',
    read: (count: number) => `${count} dosya okudu`,
    edit: (count: number) => `${count} dosya düzenledi`,
    search: 'arama yaptı',
    video: (count: number) => `${count} video düzenlemesi kaydetti`,
    tool: 'araçlar çağırdı',
  },
  summary: (phrases: readonly string[]) => phrases.join(', '),
  thinking: 'Düşünüyor',
  stepsFallback: 'Adımlar',
};
