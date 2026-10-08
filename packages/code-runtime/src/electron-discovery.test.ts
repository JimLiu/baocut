import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveElectronBinary } from './composition-host.ts';

const roots: string[] = [];
function installation() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-electron-discovery-'));
  roots.push(root);
  const dir = path.join(root, 'node_modules', 'electron');
  fs.mkdirSync(dir, { recursive: true });
  const marker = path.join(root, 'download-attempted');
  fs.writeFileSync(path.join(dir, 'index.js'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'download'); throw new Error('installer ran');`);
  return { root, dir, marker, from: path.join(root, 'entry.cjs') };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('Electron discovery without installation side effects', () => {
  it('returns unavailable before the binary is downloaded without executing the package entry', () => {
    const app = installation();
    expect(resolveElectronBinary({}, app.from)).toBeNull();
    expect(fs.existsSync(app.marker)).toBe(false);
  });

  it('reads the installed executable without executing the package entry', () => {
    const app = installation();
    fs.mkdirSync(path.join(app.dir, 'dist'));
    const executable = path.join(app.dir, 'dist', 'electron.exe');
    fs.writeFileSync(executable, 'installed');
    fs.writeFileSync(path.join(app.dir, 'path.txt'), 'electron.exe\n');
    expect(resolveElectronBinary({}, app.from)).toBe(executable);
    expect(fs.existsSync(app.marker)).toBe(false);
  });

  it('returns unavailable when the recorded binary is missing', () => {
    const app = installation();
    fs.writeFileSync(path.join(app.dir, 'path.txt'), 'electron.exe');
    expect(resolveElectronBinary({}, app.from)).toBeNull();
    expect(fs.existsSync(app.marker)).toBe(false);
  });

  it('honors the Electron distribution override', () => {
    const app = installation();
    fs.writeFileSync(path.join(app.dir, 'path.txt'), 'electron.exe');
    const executable = path.join(app.root, 'electron.exe');
    fs.writeFileSync(executable, 'installed');
    expect(resolveElectronBinary({ ELECTRON_OVERRIDE_DIST_PATH: app.root }, app.from)).toBe(executable);
    expect(fs.existsSync(app.marker)).toBe(false);
  });
});
