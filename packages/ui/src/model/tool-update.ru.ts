import type { ToolUpdateMessages } from './tool-update.ts';

export const ru: ToolUpdateMessages = {
  standalone: "Официальный отдельный исполняемый файл",
  updateInTerminal: "Обновить в терминале",
  unknownInstall: "Не удалось определить способ установки yt-dlp. Выполните команду для вашего способа установки, затем нажмите «Проверить снова».",
  cannotRun: "BaoCut не может выполнить эту команду за вас.",
  thenRecheck: "Затем нажмите «Проверить снова».",
  runThenRecheck: "Выполните эту команду в терминале, затем нажмите «Проверить снова».",
  updateWith: (method) => `Обновить через ${method}`,
  stoppedTitle: "Обновление остановлено",
  stoppedBody: "Возможно, команда выполнена лишь частично. Проверьте вывод ниже, затем нажмите «Проверить снова», чтобы подтвердить текущую версию yt-dlp.",
  failedTitle: (exitCode) => (exitCode === null ? "Обновление не завершено" : `Обновление не завершено (код завершения ${exitCode})`),
  failedBody: (error) => `${error ? `${error.replace(/[。.]$/, "")}. ` : ""}Установленный yt-dlp не затронут. Вывод ниже; можно также скопировать команду, выполнить в терминале, затем нажать «Проверить снова».`,
  updatedTo: (version) => `Обновлено до ${version}`,
  upToDate: (version) => (version ? `Уже актуально (${version})` : "Уже актуально"),
  logTruncated: "… (предыдущий вывод пропущен; полный вывод в записи задачи)\n",
  logStopped: "(Остановлено)",
  logExitCode: (exitCode) => `(Код завершения ${exitCode})`,
};
