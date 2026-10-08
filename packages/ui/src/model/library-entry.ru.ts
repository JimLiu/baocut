import type { LibraryEntryMessages } from './library-entry.ts';

export const ru: LibraryEntryMessages = {
  versionConflict: 'Эта запись только что изменена в другом месте, поэтому ваша правка не сохранена. Последняя версия загружена заново. Внесите изменения ещё раз.',
  failed: (action: string, message: string) => `Не удалось выполнить действие «${action}»: ${message}`,
};
