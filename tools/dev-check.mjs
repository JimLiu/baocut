// 开发环境的只读检查；仅 Cargo 的发现会补齐当前进程 PATH，不安装系统工具。
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureCargo } from './cargo-path.mjs';

export function checkEnvironment({
  platform = process.platform,
  arch = process.arch,
  nodeVersion = process.versions.node,
  lite = false,
  probe = (command, args) => spawnSync(command, args, { encoding: 'utf8', timeout: 15_000 }).status === 0,
} = {}) {
  const checks = [];
  const add = (label, ok, hint, required = true) => checks.push({ label, ok, hint, required });
  const [major, minor] = nodeVersion.split('.').map(Number);
  add('Node.js 22.18+', major > 22 || (major === 22 && minor >= 18), 'Install Node.js 22.18+ from https://nodejs.org and reopen your terminal.');
  if (lite) return checks;

  add('Cargo', probe('cargo', ['--version']), 'Install Rust from https://rustup.rs and reopen your terminal.');
  add('rustc', probe('rustc', ['--version']), 'Run rustup default stable; then rerun npm run doctor.');
  add('CMake', probe('cmake', ['--version']), 'Install CMake and add its bin directory to PATH (macOS: brew install cmake).');
  if (platform === 'win32') {
    add('MSVC C++ compiler', probe('cl.exe', ['/?']), 'Install Visual Studio with Desktop development with C++ and a Windows SDK; use an x64 Native Tools Command Prompt or Developer PowerShell configured for x64.');
  } else if (platform === 'darwin') {
    add('Apple C++ compiler', probe('xcrun', ['--find', 'clang++']), 'Install Xcode Command Line Tools: xcode-select --install.');
    if (arch === 'arm64') {
      add('Metal compiler (MLX)', probe('xcrun', ['--find', 'metal']), 'Install full Xcode, select it with xcode-select, and if needed run xcodebuild -downloadComponent MetalToolchain. See README.md.');
    }
  } else {
    add('C++ compiler', probe('c++', ['--version']), 'Install a C++ compiler (Debian/Ubuntu: sudo apt install build-essential).');
  }
  for (const command of ['ffmpeg', 'ffprobe']) {
    add(command, probe(command, ['-version']), 'Install FFmpeg with ffprobe and add both to PATH (macOS: brew install ffmpeg). Media analysis, transcription preparation and export need them.', false);
  }
  return checks;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lite = process.argv.includes('--lite');
  if (!lite) ensureCargo(false);
  const checks = checkEnvironment({ lite });
  for (const { label, ok, hint, required } of checks) {
    console.log(`[${ok ? 'OK' : required ? 'MISSING' : 'WARN'}] ${label}`);
    if (!ok) console.log(`  ${hint}`);
  }
  if (lite) {
    console.log('Lite mode skips native and WASM builds. On a fresh checkout, video editing, preview, export, local inference and speech processing are unavailable. Existing build outputs may still be used.');
  }
  const failed = checks.some(({ ok, required }) => required && !ok);
  if (failed) {
    console.log('Fix the missing tools above and rerun npm run doctor. Installation steps: README.md#run-from-source / README.zh-Hans.md.');
    if (checks[0].ok && !lite) console.log('For shell/UI development without Rust, use npm run dev:lite.');
  } else {
    console.log('Prerequisite checks passed. Agent features additionally need a signed-in agent engine. Builds may still report SDK or dependency errors.');
  }
  process.exitCode = failed ? 1 : 0;
}
