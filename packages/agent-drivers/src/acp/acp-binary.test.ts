import { describe, expect, it } from 'vitest';
import { acpPathVariable, acpSearch } from './acp-binary.ts';
import { ACP_PRESETS } from './acp-presets.ts';
import { nodeCliCommand, parseCmdShimTarget } from '../cli-command.ts';

describe('Qwen CLI discovery and launch', () => {
  it('finds native executables and npm shims on Windows, including relocated AppData', () => {
    const search = acpSearch(ACP_PRESETS.qwen, 'win32', { APPDATA: 'D:\\账户 甲\\Roaming' }, 'C:\\Users\\用户');
    expect(search.names).toEqual(['qwen.exe', 'qwen.cmd']);
    expect(search.locations).toContain('D:\\账户 甲\\Roaming\\npm\\qwen.cmd');
    expect(search.locations).toContain('C:\\Users\\用户\\.local\\bin\\qwen.exe');
    expect(acpSearch(ACP_PRESETS.qwen, 'win32', { APPDATA: '\\\\server\\用户资料' }, 'C:\\Users\\用户').locations)
      .toContain('\\\\server\\用户资料\\npm\\qwen.cmd');
    const entry = parseCmdShimTarget('"%dp0%\\node.exe" "%dp0%\\node_modules\\@qwen-code\\qwen-code\\dist\\index.js" %*', 'D:\\账户 甲\\Roaming\\npm');
    expect(nodeCliCommand(entry!)).toEqual({ file: 'node', args: ['D:\\账户 甲\\Roaming\\npm\\node_modules\\@qwen-code\\qwen-code\\dist\\index.js'] });
  });

  it('uses the normal command and local bin on macOS/Linux, and supports manual overrides', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const search = acpSearch(ACP_PRESETS.qwen, platform, {}, '/Users/用户');
      expect(search.names).toEqual(['qwen']);
      expect(search.locations).toContain('/Users/用户/.local/bin/qwen');
    }
    expect(acpPathVariable(ACP_PRESETS.qwen)).toBe('BAOCUT_QWEN_PATH');
    expect(nodeCliCommand('/opt/qwen')).toEqual({ file: '/opt/qwen', args: [] });
    expect(nodeCliCommand('C:\\Qwen Code\\qwen.exe')).toEqual({ file: 'C:\\Qwen Code\\qwen.exe', args: [] });
  });
});

describe('Antigravity CLI discovery', () => {
  it('finds the native installer location under LOCALAPPDATA on Windows, including relocated and non-ASCII profiles', () => {
    const search = acpSearch(ACP_PRESETS.antigravity, 'win32', { LOCALAPPDATA: 'D:\\账户 甲\\Local' }, 'C:\\Users\\用户');
    expect(search.names).toEqual(['agy.exe', 'agy.cmd']);
    expect(search.locations).toContain('D:\\账户 甲\\Local\\agy\\bin\\agy.exe');
    expect(acpSearch(ACP_PRESETS.antigravity, 'win32', {}, 'C:\\Users\\用户').locations).toContain('C:\\Users\\用户\\AppData\\Local\\agy\\bin\\agy.exe');
    expect(acpPathVariable(ACP_PRESETS.antigravity)).toBe('BAOCUT_ANTIGRAVITY_PATH');
  });

  it('uses ~/.local/bin on macOS/Linux and never a Windows-only location', () => {
    const search = acpSearch(ACP_PRESETS.antigravity, 'darwin', { LOCALAPPDATA: 'C:\\x' }, '/Users/用户');
    expect(search.names).toEqual(['agy']);
    expect(search.locations).toEqual(['/Users/用户/.local/bin/agy', '/opt/homebrew/bin/agy', '/usr/local/bin/agy']);
  });
});
