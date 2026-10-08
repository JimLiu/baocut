// 让构建脚本找得到 cargo。PATH 里没有时，依次到 CARGO_HOME/bin（缺省 ~/.cargo/bin）与 rustup 本体所在的目录里找：
// Homebrew 的 rustup 是 keg-only，cargo、rustc 这些代理只在它自己的 bin 目录里，不链进 Homebrew 的 bin；
// 用 rustup-init 装的，从图形界面起的进程也常常没有 ~/.cargo/bin。
// 找到就加到本进程 PATH 的最前面，之后起的 cargo、rustc、rustup 与 cargo 再起的工具都从这里来。

import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

const suffix = process.platform === 'win32' ? '.exe' : '';

function find(name, dirs) {
  return dirs.map((dir) => join(dir, name + suffix)).find((file) => existsSync(file));
}

/** 确保 cargo 在 PATH 上；哪里都找不到时提示安装 Rust 并以非零退出。 */
export function ensureCargo() {
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  if (find('cargo', dirs)) return;
  const rustup = find('rustup', dirs);
  const candidates = [join(process.env.CARGO_HOME || join(homedir(), '.cargo'), 'bin')];
  if (rustup) candidates.push(dirname(realpathSync(rustup)));
  const cargo = find('cargo', candidates);
  if (!cargo) {
    console.error('没有找到 cargo：先装 Rust（https://rustup.rs）');
    process.exit(1);
  }
  console.log(`PATH 里没有 cargo，改用 ${cargo}`);
  process.env.PATH = [dirname(cargo), ...dirs].join(delimiter);
}
