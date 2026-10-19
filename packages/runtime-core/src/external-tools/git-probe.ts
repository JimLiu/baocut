import { execFile } from 'node:child_process';
import type { Localized } from '@baocut/protocol';
import { RcGit } from '@baocut/protocol/messages/runtime-core';

/**
 * macOS 上的 `/usr/bin/git`（版本记录设计 §6）：没装开发者工具（Xcode 或 Command Line Tools）时它是占位程序，执行它会弹出安装窗口。
 * 只有 `xcode-select -p` 成功时才用它；不执行 `/usr/bin/git` 本身来判断。结果在这次运行里记住（装上之后重启 Runtime 生效）。
 */
const MACOS_STUB = '/usr/bin/git';

let developerTools: Promise<boolean> | null = null;

export async function macosGitUsable(file: string, platform: NodeJS.Platform): Promise<Localized | null> {
  if (platform !== 'darwin' || file !== MACOS_STUB) return null;
  developerTools ??= hasDeveloperTools();
  return (await developerTools) ? null : RcGit.xcodeStub();
}

function hasDeveloperTools(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('/usr/bin/xcode-select', ['-p'], { timeout: 5_000, windowsHide: true }, (error) => resolve(!error));
  });
}

/** 测试用：忘掉记住的结果。 */
export function resetDeveloperToolsProbe(value?: boolean): void {
  developerTools = value === undefined ? null : Promise.resolve(value);
}
