import type { SandboxMessages } from './sandbox-copy.ts';

export const ru: SandboxMessages = {
  help: `Использование:
  baocut sandbox create <папка> [--link-accounts-from <home>]
                                   Готовит отдельную папку Runtime для разработки и тестов: саму папку с папкой projects
                                   внутри, bin/baocut, который запускает CLI этой копии репозитория с этой папкой, и
                                   env.sh / env.ps1, которые переключают на неё shell. Повторный запуск обновляет эти файлы.
                                   Только из копии репозитория; никогда не стандартная ~/.baocut
    --link-accounts-from <home>    Также связывает, только для чтения, аккаунты моделей той папки (обычно ~/.baocut), как
                                   baocut models accounts link --from. Вызовы идут через ваши настоящие аккаунты и оплачиваются`,
  defaultHome: (dir) => `${dir} — стандартная папка Runtime с вашими настоящими данными; выберите для песочницы другую папку`,
  needsSourceCli:
    'baocut sandbox create работает только из копии репозитория (node apps/cli/src/main.ts sandbox create …). Этот CLI запускает Runtime приложения BaoCut, который хранит ключи в системной связке ключей, общей для всех папок: песочница там может перезаписать или удалить ваши настоящие ключи',
  unknownStore: (entry) => `BAOCUT_RUNTIME_ENTRY указывает на ${entry}, и неизвестно, где этот Runtime хранит ключи. Уберите переменную перед созданием песочницы`,
  notEmpty: (dir) => `В ${dir} уже есть файлы, и это не папка BaoCut; выберите новую или пустую папку`,
  notFolder: (dir) => `${dir} — не папка`,
  created: (dir) => `Песочница готова: ${dir}`,
  refreshed: (dir) => `Песочница обновлена: ${dir}`,
  projects: (dir) => `  Проекты  ${dir}`,
  cli: (file) => `  baocut   ${file} (запускает CLI этой копии)`,
  useHeader: 'Чтобы пользоваться ею в shell:',
  useShell: (file) => `  ${file}`,
  usePowerShell: (file) => `  ${file}   (PowerShell)`,
  useNote:
    'После этого baocut в этом shell и запущенные из него агенты работают с песочницей; другие shell по-прежнему используют ~/.baocut. Её Runtime хранит ключи в файле внутри песочницы',
  linkFailed: (dir) => `Песочница в ${dir} готова; связать аккаунты не удалось:`,
};
