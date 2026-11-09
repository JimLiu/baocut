import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { installEntryOf, repoRootOf } from './install-identity.js';

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

  it('maps a source script to the repository root', () => {
    expect(installEntryOf(path.join(repoRoot, 'apps/runtime/src/main.ts'))).toBe(repoRoot);
    expect(repoRootOf(path.join(repoRoot, 'packages/runtime-storage/src'))).toBe(repoRoot);
  });
});
