import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/**
 * 主进程的第二种身份：代码包的 Electron 离屏宿主（架构设计 §8.3）。Runtime 以 `<Electron> --composition-host <host.cjs>` 拉起它
 * （`packages/code-runtime/src/composition-host.ts`）。
 *
 * 打包后的应用不认命令行里的脚本参数，总是加载 asar 里的 `out/main/index.js`；所以入口先看 `process.argv` 有没有这个开关，
 * 有就只跑宿主脚本，不起 Runtime、不开窗口。开发态的 Electron（default_app）跳过 `-` 开头的未知参数，把脚本当应用文件直接加载，
 * 不经过这里。
 */

export const COMPOSITION_HOST_SWITCH = '--composition-host';

/** `--composition-host <脚本>` 给的脚本路径；没有这个开关时是 null，有开关没给脚本时是空字符串。 */
export function compositionHostScript(argv: readonly string[]): string | null {
  const index = argv.indexOf(COMPOSITION_HOST_SWITCH);
  if (index < 0) return null;
  const script = argv[index + 1];
  return script && !script.startsWith('-') ? script : '';
}

/** 宿主自己的 Electron 数据目录：脚本旁边的 `profile/`，不碰应用的数据目录。 */
export function compositionHostProfileDir(script: string): string {
  return path.join(path.dirname(script), 'profile');
}

/**
 * 跑宿主脚本。必须同步 require：脚本在 ready 之前调 `disableHardwareAcceleration` / `appendSwitch`，等到 whenReady 就晚了。
 * 脚本自己发 `ready`、按 stdin 关闭退出。
 */
export function runCompositionHost(script: string): void {
  if (!script) {
    process.stderr.write(`[composition-host] ${COMPOSITION_HOST_SWITCH} needs the host script path\n`);
    process.exit(2);
  }
  const resolved = path.resolve(script);
  const profile = compositionHostProfileDir(resolved);
  fs.mkdirSync(profile, { recursive: true });
  // Electron 自己的数据（缓存、Cookie、日志、崩溃转储）落在宿主的目录里。
  for (const name of ['userData', 'sessionData', 'logs', 'crashDumps'] as const) app.setPath(name, path.join(profile, name));
  require(resolved);
}
