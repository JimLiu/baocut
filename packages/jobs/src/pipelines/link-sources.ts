import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * 原始链接的暂存（架构设计 §7.9）：规范化去掉了查询参数（签名、令牌）的链接，下载时仍要原样的那一个。它不进任务记录
 * （`jobs.*` 读得到冻结的参数），只存在这个文件里（权限 0600），按摘要（`sourceRef`）引用。
 *
 * 生命周期：提交时写入；流程完成时删除；Runtime 启动时只留下还没完成的从链接导入流程引用的（失败、取消、中断的还能重试），
 * 其余删掉。
 */
export interface LinkSources {
  put(ref: string, url: string): Promise<void>;
  get(ref: string): Promise<string | null>;
  delete(ref: string): Promise<void>;
  /** 只留下 `keep` 里的。 */
  prune(keep: ReadonlySet<string>): Promise<void>;
}

/** 文件实现：整个文件一个 JSON 对象，原子写。 */
export class FileLinkSources implements LinkSources {
  readonly #file: string;
  #chain: Promise<unknown> = Promise.resolve();

  constructor(file: string) {
    this.#file = file;
  }

  put(ref: string, url: string): Promise<void> {
    return this.#change((all) => {
      all[ref] = url;
    });
  }

  async get(ref: string): Promise<string | null> {
    await this.#chain.catch(() => {});
    return (await this.#read())[ref] ?? null;
  }

  delete(ref: string): Promise<void> {
    return this.#change((all) => {
      delete all[ref];
    });
  }

  prune(keep: ReadonlySet<string>): Promise<void> {
    return this.#change((all) => {
      for (const ref of Object.keys(all)) if (!keep.has(ref)) delete all[ref];
    });
  }

  async #read(): Promise<Record<string, string>> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.#file, 'utf8')) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
    } catch {
      return {};
    }
  }

  #change(fn: (all: Record<string, string>) => void): Promise<void> {
    const next = this.#chain
      .catch(() => {})
      .then(async () => {
        const all = await this.#read();
        const before = JSON.stringify(all);
        fn(all);
        if (JSON.stringify(all) === before) return;
        if (Object.keys(all).length === 0) {
          await fs.rm(this.#file, { force: true });
          return;
        }
        await fs.mkdir(path.dirname(this.#file), { recursive: true });
        const tmp = `${this.#file}.${randomUUID()}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(all), { mode: 0o600 });
        await fs.rename(tmp, this.#file);
      });
    this.#chain = next;
    return next;
  }
}
