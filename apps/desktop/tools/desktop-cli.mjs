import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WINDOWS_LAUNCHER = '@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"%~dp0BaoCut.exe" "%~dp0resources\\app.asar\\out\\main\\cli.js" %*\r\nexit /b %errorlevel%\r\n';

/** Stage launchers as extraFiles: macOS paths are relative to Contents, Windows to the app root. */
export function stageDesktopCli(directory, platform) {
  if (platform !== 'darwin' && platform !== 'win32') throw new Error(`Unsupported desktop CLI platform: ${platform}`);
  mkdirSync(directory, {recursive: true});
  const mac = platform === 'darwin';
  const file = path.join(directory, mac ? 'baocut-cli' : 'baocut.cmd');
  if (mac) {
    // Contents/MacOS must contain signable Mach-O code, not a shell script whose
    // signature lives in extended attributes and can disappear during archiving.
    const source = fileURLToPath(new URL('./desktop-cli-mac.c', import.meta.url));
    execFileSync('xcrun', ['clang', '-arch', process.arch === 'x64' ? 'x86_64' : 'arm64', '-Os', '-Wall', '-Wextra', '-Werror', '-mmacosx-version-min=14.0', source, '-o', file], {stdio: 'pipe'});
  } else {
    writeFileSync(file, WINDOWS_LAUNCHER, {mode: 0o755});
  }
  return {from: file, to: mac ? 'MacOS/baocut-cli' : 'baocut.cmd'};
}
