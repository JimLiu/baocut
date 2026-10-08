import type { Id, Project } from '@baocut/protocol';
import { JsonStoreFile, isPlainObject, type StoreOptions } from './store-file.ts';

interface ProjectsFile {
  schemaVersion: 1;
  projects: Project[];
}

/**
 * 项目登记（架构设计 §1.5、§5.1）：项目的标识在目录里的 `.bcut/project.json`（`project-marker.ts`），
 * 这里只是「标识 → 最后见到的路径」的索引，加上显示名、置顶与归档。登记丢了可以由标记重建。
 * 路径是规范化的绝对路径（realpath）。
 * 文件坏了改名保留、从空开始（标记还在，打开项目时重新登记）；更新版本写下的不改写（`store-file.ts`）。
 */
export class ProjectStore {
  readonly #file: JsonStoreFile;
  #projects = new Map<Id, Project>();
  #saving: Promise<void> = Promise.resolve();

  constructor(file: string, options: StoreOptions = {}) {
    this.#file = new JsonStoreFile(file, options.log);
  }

  async load(): Promise<Project[]> {
    const { value } = await this.#file.read({
      recognize: (raw) =>
        Array.isArray(raw.projects)
          ? raw.projects.filter((p): p is Project => isPlainObject(p) && typeof p.id === 'string' && typeof p.path === 'string')
          : null,
    });
    // 0.1 写下的登记没有置顶与归档：补上默认值。
    this.#projects = new Map((value ?? []).map((p) => [p.id, { ...p, pinned: p.pinned ?? false, archived: p.archived ?? false }]));
    return this.list();
  }

  list(): Project[] {
    return [...this.#projects.values()];
  }

  get(id: Id): Project | undefined {
    return this.#projects.get(id);
  }

  findByPath(path: string): Project | undefined {
    return this.list().find((p) => p.path === path);
  }

  put(project: Project): Promise<void> {
    this.#projects.set(project.id, project);
    const snapshot: ProjectsFile = { schemaVersion: 1, projects: this.list() };
    this.#saving = this.#saving.catch(() => {}).then(() => this.#file.write(snapshot));
    return this.#saving;
  }

  flush(): Promise<void> {
    return this.#saving;
  }
}
