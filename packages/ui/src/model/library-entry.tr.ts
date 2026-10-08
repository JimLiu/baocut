import type { LibraryEntryMessages } from './library-entry.ts';

export const tr: LibraryEntryMessages = {
versionConflict: 'Bu öğe az önce başka yerde değişti; düzenlemeniz kaydedilmedi. En güncel sürüm yeniden yüklendi. Değişikliğinizi yeniden yapın.', failed: (action, message) => `${action} yapılamadı: ${message}`,
};
