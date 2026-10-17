import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { loadSnapshot, snapshotFile } from './snapshot.ts';

it('uses the shipped catalog beside a bundled CLI and retains the source fallback', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-cli-snapshot-'));
  try {
    expect(snapshotFile(dir)).toBe(path.join(dir,'..','generated','catalog.json'));
    const file = path.join(dir,'generated','cli-catalog.json');
    fs.mkdirSync(path.dirname(file),{recursive:true});
    const catalog = {interfaceVersion:'test-v1',tools:[{name:'videos_inspect'}]};
    fs.writeFileSync(file,JSON.stringify(catalog));
    expect(snapshotFile(dir)).toBe(file);
    expect(loadSnapshot(snapshotFile(dir))).toEqual(catalog);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
