import type { HarnessProjectsMessages } from './harness-projects.ts';

export const ru: HarnessProjectsMessages = {
  conversationNotFound: (p) => `Сессия не найдена: ${p.id}`,
  projectNotFound: (p) => `Проект не найден: ${p.id}`,
  folderInaccessible: (p) => `Папка не существует или недоступна: ${p.dir}`,
  markerReadFailed: (p) => `Не удалось прочитать маркер проекта: ${p.error}`,
  markerNewer: (p) => `Этот проект создан более новой версией BaoCut (версия маркера проекта ${p.version}). Обновите BaoCut и откройте снова`,
  untitledProject: "Проект без названия",
  createFolderFailed: (p) => `Не удалось создать папку проекта: ${p.error}`,
  tooManySameName: "Слишком много папок проектов с таким именем. Выберите другое имя",
  markerNotWritable: (p) => `Папка проекта недоступна для записи, не удалось записать маркер проекта .bcut/project.json: ${p.dir}`,
  markerWriteFailed: (p) => `Не удалось записать маркер проекта: ${p.error}`,
};
