import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { installEntryOf, installOf, repoRootOf } from './install-identity.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('installEntryOf', () => {
  it('maps a packaged macOS script to the app bundle', () => {
    expect(installEntryOf('/Applications/BaoCut.app/Contents/Resources/app.asar/out/main/runtime.js', 'darwin')).toBe('/Applications/BaoCut.app');
  });

  it('maps a packaged Windows script to the install directory', () => {
    expect(installEntryOf('C:\\Users\\me\\AppData\\Local\\Programs\\BaoCut\\resources\\app.asar\\out\\main\\runtime.js', 'win32')).toBe(
      'C:\\Users\\me\\AppData\\Local\\Programs\\BaoCut',
    );
  });

  it('maps a standalone CLI package script to the package root', () => {
    const root = '/Users/me/.local/share/baocut/versions/3.17.0-build.93';
    const app = `${root}/BaoCut CLI.app/Contents/Resources/app`;
    const manifest = (file: string) => file === `${app}/baocut-standalone.json`;
    expect(installOf(`${app}/out/main/runtime.js`, 'darwin', manifest)).toEqual({ kind: 'standalone', entry: root });
    const winRoot = 'C:\\Users\\me\\AppData\\Local\\BaoCut\\cli\\versions\\3.17.0-build.93';
    const winManifest = (file: string) => file === `${winRoot}\\resources\\app\\baocut-standalone.json`;
    expect(installEntryOf(`${winRoot}\\resources\\app\\out\\main\\runtime.js`, 'win32', winManifest)).toBe(winRoot);
    // The manifest alone is not enough: the layout has to match too.
    expect(installOf('/tmp/loose/app/out/main/runtime.js', 'darwin', (file) => file === '/tmp/loose/app/baocut-standalone.json')).toBeNull();
    expect(installOf(`${app}/out/main/runtime.js`, 'darwin', () => false)).toBeNull();
  });

  it('maps a source script to the repository root', () => {
    expect(installEntryOf(path.join(repoRoot, 'apps/runtime/src/main.ts'))).toBe(repoRoot);
    expect(installOf(path.join(repoRoot, 'apps/desktop/out/main/runtime.js'))).toEqual({ kind: 'repo', entry: repoRoot });
    expect(repoRootOf(path.join(repoRoot, 'packages/runtime-storage/src'))).toBe(repoRoot);
  });
});
