import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WINDOWS_LAUNCHER = '@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"%~dp0BaoCut.exe" "%~dp0resources\\app.asar\\out\\main\\cli.js" %*\r\nexit /b %errorlevel%\r\n';
/** The standalone command line package (CLI standalone design §9): its own Node, the unpacked app directory. */
export const STANDALONE_WINDOWS_LAUNCHER = '@echo off\r\nsetlocal\r\n"%~dp0node.exe" "%~dp0resources\\app\\out\\main\\cli.js" %*\r\nexit /b %errorlevel%\r\n';

function compileMac(source, output, defines = []) {
  const file = fileURLToPath(new URL(source, import.meta.url));
  execFileSync('xcrun', [
    'clang', '-arch', process.arch === 'x64' ? 'x86_64' : 'arm64', '-Os', '-Wall', '-Wextra', '-Werror', '-mmacosx-version-min=14.0',
    ...defines.map((define) => `-D${define}`), file, '-o', output,
  ], {stdio: 'pipe'});
}

/**
 * Stage launchers as extraFiles: macOS paths are relative to Contents, Windows to the app root. On macOS this is the
 * CLI launcher and the disclaim helper the CLI starts the Runtime through (Full Disk Access then counts for BaoCut.app).
 */
export function stageDesktopCli(directory, platform) {
  if (platform !== 'darwin' && platform !== 'win32') throw new Error(`Unsupported desktop CLI platform: ${platform}`);
  mkdirSync(directory, {recursive: true});
  if (platform === 'darwin') {
    // Contents/MacOS must contain signable Mach-O code, not a shell script whose
    // signature lives in extended attributes and can disappear during archiving.
    const launcher = path.join(directory, 'baocut-cli');
    const disclaim = path.join(directory, 'baocut-disclaim');
    compileMac('./desktop-cli-mac.c', launcher);
    compileMac('./disclaim-mac.c', disclaim);
    return [{from: launcher, to: 'MacOS/baocut-cli'}, {from: disclaim, to: 'MacOS/baocut-disclaim'}];
  }
  const file = path.join(directory, 'baocut.cmd');
  writeFileSync(file, WINDOWS_LAUNCHER, {mode: 0o755});
  return [{from: file, to: 'baocut.cmd'}];
}

/** Launchers of the standalone package: macOS `baocut-cli` (runs the bundled `node`) and the disclaim helper; Windows `baocut.cmd`. */
export function stageStandaloneCli(directory, platform) {
  if (platform !== 'darwin' && platform !== 'win32') throw new Error(`Unsupported standalone CLI platform: ${platform}`);
  mkdirSync(directory, {recursive: true});
  if (platform === 'darwin') {
    const launcher = path.join(directory, 'baocut-cli');
    const disclaim = path.join(directory, 'baocut-disclaim');
    compileMac('./desktop-cli-mac.c', launcher, [
      'BAOCUT_CLI_RUNTIME="node"',
      'BAOCUT_CLI_SCRIPT="../Resources/app/out/main/cli.js"',
      'BAOCUT_CLI_ELECTRON_AS_NODE=0',
    ]);
    compileMac('./disclaim-mac.c', disclaim);
    return {launcher, disclaim};
  }
  const launcher = path.join(directory, 'baocut.cmd');
  writeFileSync(launcher, STANDALONE_WINDOWS_LAUNCHER, {mode: 0o755});
  return {launcher, disclaim: null};
}
