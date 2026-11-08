import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { executableName, findBundledBinary, findBundledTool, findBundledToolDir } from './bundled-binary.ts';

const roots: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundled-binary-'));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function touch(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
}

describe('findBundledBinary', () => {
  it('adds .exe only on Windows', () => {
    expect(executableName('model-worker', 'win32')).toBe('model-worker.exe');
    expect(executableName('model-worker', 'darwin')).toBe('model-worker');
    expect(executableName('model-worker', 'linux')).toBe('model-worker');
  });

  it('uses BAOCUT_BIN_DIR first, with the platform suffix', () => {
    const bin = tmp();
    const repo = tmp();
    touch(path.join(bin, 'engine-host.exe'));
    touch(path.join(repo, 'target/release/engine-host.exe'));
    expect(findBundledBinary('engine-host', repo, { BAOCUT_BIN_DIR: bin }, 'win32')).toBe(path.join(bin, 'engine-host.exe'));
  });

  it('does not fall back to cargo output when BAOCUT_BIN_DIR is given but lacks the file', () => {
    const bin = tmp();
    const repo = tmp();
    touch(path.join(repo, 'target/release/engine-host'));
    expect(findBundledBinary('engine-host', repo, { BAOCUT_BIN_DIR: bin }, 'darwin')).toBeNull();
  });

  it('falls back to the cargo target directory in development', () => {
    const repo = tmp();
    touch(path.join(repo, 'target/debug/speech-worker'));
    expect(findBundledBinary('speech-worker', path.join(repo, 'packages/x/src'), {}, 'darwin')).toBe(
      path.join(repo, 'target/debug/speech-worker'),
    );
    expect(findBundledBinary('model-worker', repo, {}, 'darwin')).toBeNull();
  });

  it.each(['darwin', 'win32', 'linux'] as const)('selects the latest development worker on %s', (platform) => {
    const repo = tmp();
    const exe = executableName('model-worker', platform);
    const release = path.join(repo, 'target/release', exe);
    const debug = path.join(repo, 'target/debug', exe);
    touch(release);
    touch(debug);
    fs.utimesSync(release, 1000, 1000);
    fs.utimesSync(debug, 2000, 2000);
    expect(findBundledBinary('model-worker', repo, {}, platform)).toBe(debug);
  });
});

describe('findBundledTool', () => {
  it('looks in the tool subdirectory of BAOCUT_BIN_DIR only, with the platform suffix', () => {
    const bin = tmp();
    const repo = tmp();
    touch(path.join(bin, 'audiocpp/audiocpp_cli.exe'));
    touch(path.join(repo, 'target/audiocpp/audiocpp_cli.exe'));
    expect(findBundledTool('audiocpp', 'audiocpp_cli', repo, { BAOCUT_BIN_DIR: bin }, 'win32')).toBe(path.join(bin, 'audiocpp/audiocpp_cli.exe'));
    expect(findBundledTool('audiocpp', 'audiocpp_server', repo, { BAOCUT_BIN_DIR: bin }, 'win32')).toBeNull();
  });

  it('falls back to the tool subdirectory of the cargo target directory in development', () => {
    const repo = tmp();
    touch(path.join(repo, 'target/audiocpp/audiocpp_cli'));
    expect(findBundledTool('audiocpp', 'audiocpp_cli', path.join(repo, 'packages/x/src'), {}, 'darwin')).toBe(
      path.join(repo, 'target/audiocpp/audiocpp_cli'),
    );
    expect(findBundledTool('audiocpp', 'audiocpp_cli', tmp(), {}, 'darwin')).toBeNull();
  });
});

describe('findBundledToolDir', () => {
  it('looks in BAOCUT_BIN_DIR only when it is given', () => {
    const bin = tmp();
    const repo = tmp();
    touch(path.join(bin, 'litertlm-runtime/litert-lm.dll'));
    touch(path.join(repo, 'target/litertlm-runtime/litert-lm.dll'));
    expect(findBundledToolDir('litertlm-runtime', repo, { BAOCUT_BIN_DIR: bin })).toBe(path.join(bin, 'litertlm-runtime'));
    expect(findBundledToolDir('audiocpp', repo, { BAOCUT_BIN_DIR: bin })).toBeNull();
  });

  it('falls back to the cargo target directory in development', () => {
    const repo = tmp();
    touch(path.join(repo, 'target/litertlm-runtime/litert-lm.dll'));
    expect(findBundledToolDir('litertlm-runtime', path.join(repo, 'packages/x/src'), {})).toBe(path.join(repo, 'target/litertlm-runtime'));
    expect(findBundledToolDir('litertlm-runtime', tmp(), {})).toBeNull();
  });
});
