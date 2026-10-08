import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { DISTRIBUTED_NOTICES, thirdPartyNotices } from './third-party-notices.ts';

const root = resolve(import.meta.dirname, '..');

describe('license and third-party notice distribution', () => {
  it('ships the complete notices and original license as readable, unchanged files', async () => {
    const directory = realpathSync(mkdtempSync(resolve(tmpdir(), 'baocut-notices-')));
    try {
      writeFileSync(resolve(directory, 'index.html'), '<html><body></body></html>');
      const output = resolve(directory, 'dist');
      await build({
        configFile: false, root: directory, logLevel: 'silent', plugins: [thirdPartyNotices(root)],
        build: { outDir: output },
      });
      for (const { source, fileName } of DISTRIBUTED_NOTICES) {
        expect(readFileSync(resolve(output, fileName))).toEqual(readFileSync(resolve(root, source)));
      }
      expect(readFileSync(resolve(output, 'LICENSE'))).toEqual(readFileSync(resolve(root, 'LICENSE')));
      const license = readFileSync(resolve(output, 'crates/model-runtime/licenses/speech-swift.txt'), 'utf8');
      const notices = readFileSync(resolve(output, 'THIRD_PARTY_NOTICES.md'), 'utf8');
      const licenseLink = notices.match(/\[上游 LICENSE 的原文副本\]\(([^)]+)\)/)?.[1];
      expect(licenseLink).toBeDefined();
      expect(readFileSync(resolve(output, licenseLink!), 'utf8')).toBe(license);
      expect(license).toContain('Copyright 2025 Ivan Digital');
      expect(license).toContain('4. Redistribution.');
      expect(license).toContain('8. Limitation of Liability.');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('fails the build when an original license is missing', async () => {
    const directory = realpathSync(mkdtempSync(resolve(tmpdir(), 'baocut-notices-missing-')));
    try {
      writeFileSync(resolve(directory, 'index.html'), '<html><body></body></html>');
      writeFileSync(resolve(directory, 'THIRD_PARTY_NOTICES.md'), '# Notices');
      writeFileSync(resolve(directory, 'LICENSE'), readFileSync(resolve(root, 'LICENSE')));
      await expect(build({
        configFile: false, root: directory, logLevel: 'silent', plugins: [thirdPartyNotices(directory)],
      })).rejects.toThrow('speech-swift.txt');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('fails the build when the BaoCut license is missing', async () => {
    const directory = realpathSync(mkdtempSync(resolve(tmpdir(), 'baocut-license-missing-')));
    try {
      writeFileSync(resolve(directory, 'index.html'), '<html><body></body></html>');
      await expect(build({
        configFile: false, root: directory, logLevel: 'silent', plugins: [thirdPartyNotices(directory)],
      })).rejects.toThrow('LICENSE');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('retains attribution and modification notices in every listed implementation file', () => {
    const notices = readFileSync(resolve(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    const section = notices.split('## speech-swift\n')[1]?.split('\n## ')[0];
    expect(section).toBeDefined();
    for (const row of section!.split('\n').filter(line => line.startsWith('| `'))) {
      expect(row.split('|'), row).toHaveLength(5);
    }
    const paths = [...section!.matchAll(/^\| `(crates\/model-runtime\/src\/[^`]+\.rs)` \|/gm)].map(match => match[1]!);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      const header = readFileSync(resolve(root, path), 'utf8').split('\n').slice(0, 15).join('\n');
      expect(header, path).toContain('Copyright 2025 Ivan Digital');
      expect(header, path).toContain('SPDX-License-Identifier: Apache-2.0');
      expect(header, path).toContain('修改：');
      expect(header, path).toContain('speech-swift');
    }
  });
});
