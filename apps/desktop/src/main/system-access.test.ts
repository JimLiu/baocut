import { expect, it, vi } from 'vitest';
import { FULL_DISK_ACCESS_URL, openFullDiskAccess, relaunchForAccess } from './system-access.ts';

it('opens only the fixed Full Disk Access pane, and only on macOS', async () => {
  const open = vi.fn(async () => {});
  await openFullDiskAccess(open, 'darwin');
  expect(open).toHaveBeenCalledWith('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles');
  expect(FULL_DISK_ACCESS_URL).toMatch(/^x-apple\.systempreferences:/);
  await expect(openFullDiskAccess(open, 'win32')).rejects.toThrow();
  await expect(openFullDiskAccess(open, 'linux')).rejects.toThrow();
  expect(open).toHaveBeenCalledTimes(1);
});

it('relaunches after confirmation and does nothing when the user cancels', async () => {
  const calls: string[] = [];
  const host = (ok: boolean) => ({
    platform: 'darwin' as const,
    confirm: async () => ok,
    prepare: () => void calls.push('prepare'),
    relaunch: () => void calls.push('relaunch'),
    quit: () => void calls.push('quit'),
  });
  expect(await relaunchForAccess(host(false))).toBe(false);
  expect(calls).toEqual([]);
  expect(await relaunchForAccess(host(true))).toBe(true);
  expect(calls).toEqual(['prepare', 'relaunch', 'quit']);
  await expect(relaunchForAccess({ ...host(true), platform: 'win32' })).rejects.toThrow();
});
