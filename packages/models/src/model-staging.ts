import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * 模型下载的暂存区（架构设计 §6.3）：`<models-root>/.bcut-staging/<owner>/<repo>@<revision>/`。没下完的文件是
 * `<path>.part`，核对过 sha256 的是 `<path>`。下载器写它，模型目录据它报告暂停的安装收到了多少字节。
 */

export const STAGING_DIR = '.bcut-staging';

/** 一个仓库版本的暂存目录。 */
export function stagingDirOf(root: string, repo: string, revision: string): string {
  const [owner = '', name = ''] = repo.split('/');
  return path.join(root, STAGING_DIR, owner, `${name}@${revision}`);
}

/** 暂存区里一个仓库版本已经收到的字节数（核对过的与没下完的都算）；没有暂存目录时 0。 */
export async function stagedBytes(root: string, repo: string, revision: string): Promise<number> {
  return dirBytes(stagingDirOf(root, repo, revision));
}

/** 删掉一个仓库版本的暂存目录。 */
export async function discardStaging(root: string, repo: string, revision: string): Promise<void> {
  await fs.rm(stagingDirOf(root, repo, revision), { recursive: true, force: true });
  await removeEmptyParents(path.dirname(stagingDirOf(root, repo, revision)), path.join(root, STAGING_DIR));
}

async function dirBytes(dir: string): Promise<number> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  let total = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirBytes(full);
    else if (entry.isFile()) total += (await fs.stat(full).catch(() => null))?.size ?? 0;
  }
  return total;
}

/** 从 `dir` 往上删空目录，到 `stop`（含）为止。 */
export async function removeEmptyParents(dir: string, stop: string): Promise<void> {
  let current = dir;
  while (current.startsWith(stop)) {
    const entries = await fs.readdir(current).catch(() => null);
    if (!entries || entries.length > 0) return;
    await fs.rmdir(current).catch(() => {});
    if (current === stop) return;
    current = path.dirname(current);
  }
}
