import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultSessionsDir, resolveRuntimeHome } from './home.ts';

const user = path.resolve('/Users/me');

describe('无项目会话的工作目录（架构设计 §3.10）', () => {
  it('默认 Home 用系统给应用的数据目录；不论有没有显式给出 BAOCUT_HOME（桌面端拉起时总会给）都一样', () => {
    const implicit = resolveRuntimeHome({}, 'darwin', user);
    const explicit = resolveRuntimeHome({ BAOCUT_HOME: path.join(user, '.baocut') }, 'darwin', user);
    expect(implicit.scratchDir).toBe(path.join(user, 'Library', 'Application Support', 'BaoCut', 'Sessions'));
    expect(explicit.scratchDir).toBe(implicit.scratchDir);
    // 旧版本放在 Home 里：启动时搬过来。
    expect(implicit.legacyScratchDir).toBe(path.join(user, '.baocut', 'scratch'));
  });

  it('别的 Home（开发、测试）跟着放到 <home>/scratch；BAOCUT_SESSIONS_DIR 优先', () => {
    const dev = resolveRuntimeHome({ BAOCUT_HOME: path.join(user, 'repo', '.dev', 'baocut-home') }, 'darwin', user);
    expect(dev.scratchDir).toBe(path.join(user, 'repo', '.dev', 'baocut-home', 'scratch'));
    expect(dev.legacyScratchDir).toBeNull();
    const custom = resolveRuntimeHome({ BAOCUT_SESSIONS_DIR: path.join(user, 'sessions') }, 'darwin', user);
    expect(custom.scratchDir).toBe(path.join(user, 'sessions'));
    expect(custom.legacyScratchDir).toBe(path.join(user, '.baocut', 'scratch'));
  });

  it('各平台的应用数据目录', () => {
    expect(defaultSessionsDir({ LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, 'win32', 'C:\\Users\\me')).toBe(
      'C:\\Users\\me\\AppData\\Local\\BaoCut\\Sessions',
    );
    expect(defaultSessionsDir({}, 'win32', 'C:\\Users\\me')).toBe('C:\\Users\\me\\AppData\\Local\\BaoCut\\Sessions');
    expect(defaultSessionsDir({}, 'linux', '/home/me')).toBe('/home/me/.local/share/BaoCut/Sessions');
    expect(defaultSessionsDir({ XDG_DATA_HOME: '/data' }, 'linux', '/home/me')).toBe('/data/BaoCut/Sessions');
  });
});
