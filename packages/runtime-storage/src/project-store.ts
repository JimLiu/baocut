import type { Id, Project } from '@baocut/protocol';
import { readJson, writeJsonAtomic } from './json-file.ts';

interface ProjectsFile {
  schemaVersion: 1;
  projects: Project[];
}

/**
 * 项目登记（架构设计 §1.5、§5.1）：项目的标识在目录里的 `.bcut/project.json`（`project-marker.ts`），
 * 这里只是「标识 → 最后见到的路径」的索引，加上显示名、置顶与归档。登记丢了可以由标记重建。
 * 路径是规范化的绝对路径（realpath）。
 */
export class ProjectStore {
  readonly #file: string;
  #projects = new Map<Id, Project>();
  #saving: Promise<void> = Promise.resolve();

  constructor(file: string) {
    this.#file = file;
  }

  async load(): Promise<Project[]> {
    const data = await readJson<ProjectsFile>(this.#file);
    // 0.1 写下的登记没有置顶与归档：补上默认值。
    this.#projects = new Map((data?.projects ?? []).map((p) => [p.id, { ...p, pinned: p.pinned ?? false, archived: p.archived ?? false }]));
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
    this.#saving = this.#saving.catch(() => {}).then(() => writeJsonAtomic(this.#file, snapshot));
    return this.#saving;
  }

  flush(): Promise<void> {
    return this.#saving;
  }
}
