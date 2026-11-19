import fs from 'node:fs/promises';

/**
 * 不经 Electron asar 补丁的 `fs.promises`。主进程里的 `fs` 把 `.asar` 文件当成目录：递归删除一个装着 `app.asar` 的目录
 * （解开的新包）会钻进去，删不掉这个文件，最后以 `ENOTEMPTY` 失败。Electron 自带的 `original-fs` 是没打补丁的原版；
 * 不在 Electron 里（测试）时用普通的 `fs`。`require` 在运行时取，打包器不去解析这个只有 Electron 才有的模块。
 */
function unpatched(): typeof fs {
  if (!process.versions.electron || typeof require !== 'function') return fs;
  try {
    return (require('original-fs') as typeof import('node:fs')).promises;
  } catch {
    return fs;
  }
}

/** 递归删掉文件或目录（不存在也算成功），里面的 `.asar` 按普通文件删。 */
export async function removeTree(target: string): Promise<void> {
  await unpatched().rm(target, { recursive: true, force: true });
}
