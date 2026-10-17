import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const MAC_LAUNCHER = `#!/bin/sh
# Resolve links so a user-created PATH symlink still follows app updates.
SOURCE=$0
while [ -L "$SOURCE" ]; do
  BASE=$(CDPATH= cd -P -- "$(dirname -- "$SOURCE")" && pwd) || exit 1
  SOURCE=$(readlink "$SOURCE") || exit 1
  case $SOURCE in /*) ;; *) SOURCE=$BASE/$SOURCE ;; esac
done
BASE=$(CDPATH= cd -P -- "$(dirname -- "$SOURCE")" && pwd) || exit 1
export ELECTRON_RUN_AS_NODE=1
exec "$BASE/BaoCut" "$BASE/../Resources/app.asar/out/main/cli.js" "$@"
`;
const WINDOWS_LAUNCHER = '@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"%~dp0BaoCut.exe" "%~dp0resources\\app.asar\\out\\main\\cli.js" %*\r\nexit /b %errorlevel%\r\n';

/** Stage launchers as extraFiles: macOS paths are relative to Contents, Windows to the app root. */
export function stageDesktopCli(directory, platform) {
  if (platform !== 'darwin' && platform !== 'win32') throw new Error(`Unsupported desktop CLI platform: ${platform}`);
  mkdirSync(directory, {recursive: true});
  const mac = platform === 'darwin';
  const file = path.join(directory, mac ? 'baocut-cli' : 'baocut.cmd');
  writeFileSync(file, mac ? MAC_LAUNCHER : WINDOWS_LAUNCHER, {mode: 0o755});
  return {from: file, to: mac ? 'MacOS/baocut-cli' : 'baocut.cmd'};
}
