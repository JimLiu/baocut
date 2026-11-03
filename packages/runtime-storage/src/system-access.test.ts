import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FULL_DISK_ACCESS, isMacProtectedPath, probeFullDiskAccess, systemAccessDetails } from './system-access.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const errno = (code: string) => Object.assign(new Error(code), { code });

describe('probeFullDiskAccess', () => {
  it('reports nothing off macOS', async () => {
    expect(await probeFullDiskAccess('win32')).toBeUndefined();
    expect(await probeFullDiskAccess('linux')).toBeUndefined();
  });

  it('is granted when the probe file opens, unknown when it is missing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-fda-'));
    dirs.push(dir);
    const probe = path.join(dir, 'TCC.db');
    await fs.writeFile(probe, '');
    expect(await probeFullDiskAccess('darwin', probe)).toBe('granted');
    expect(await probeFullDiskAccess('darwin', path.join(dir, 'absent.db'))).toBeUndefined();
  });

  it('is missing when the system refuses to open the probe file', async () => {
    // A directory cannot be opened for reading as a file on every platform, so use an unreadable file when permissions are enforced.
    if (process.platform === 'win32' || process.getuid?.() === 0) return;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-fda-'));
    dirs.push(dir);
    const probe = path.join(dir, 'TCC.db');
    await fs.writeFile(probe, '', { mode: 0o000 });
    expect(await probeFullDiskAccess('darwin', probe)).toBe('missing');
  });
});

describe('systemAccessDetails', () => {
  const home = '/Users/a';

  it('treats volumes, Desktop, Documents, Downloads and Safari data as protected', () => {
    for (const target of ['/Volumes/ExtremeSSD/Downie', '/Volumes/x', '/Users/a/Desktop/a.mp4', '/Users/a/Documents', '/Users/a/Downloads/v/x.mp4', '/Users/a/Library/Safari/Bookmarks.plist', '/Users/a/Library/Containers/com.apple.Safari/Data']) {
      expect(isMacProtectedPath(target, home), target).toBe(true);
    }
    for (const target of ['/Users/a/BaoCut/p1', '/Users/a/Library/Application Support/BaoCut', '/Users/a/DesktopNotes', '/VolumesX/a', '/tmp/x']) {
      expect(isMacProtectedPath(target, home), target).toBe(false);
    }
  });

  it('only marks EPERM on macOS under a protected path', () => {
    expect(systemAccessDetails(errno('EPERM'), '/Volumes/ExtremeSSD/Downie', 'darwin', home)).toEqual({ systemAccess: FULL_DISK_ACCESS, path: '/Volumes/ExtremeSSD/Downie' });
    expect(systemAccessDetails(errno('EACCES'), '/Volumes/ExtremeSSD/Downie', 'darwin', home)).toBeNull();
    expect(systemAccessDetails(errno('EPERM'), '/Users/a/BaoCut', 'darwin', home)).toBeNull();
    expect(systemAccessDetails(errno('EPERM'), '/Volumes/x', 'win32', home)).toBeNull();
    expect(systemAccessDetails(new Error('plain'), '/Volumes/x', 'darwin', home)).toBeNull();
  });
});
