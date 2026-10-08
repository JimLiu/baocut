import { describe, expect, it } from 'vitest';
import type { NodeHealth, PairedNode, ShareStatus } from '@baocut/protocol';
import { describeNode, formatShareStatus, parseCapabilitySwitch } from './nodes-output.ts';

const status = (overrides: Partial<ShareStatus> = {}): ShareStatus => ({
  enabled: true,
  listening: true,
  error: null,
  nodeId: 'node_abc',
  name: 'Studio',
  port: 47610,
  addresses: ['192.168.1.20'],
  allowAnySource: false,
  capabilities: { transcribe: { enabled: true } },
  pairing: null,
  clients: [],
  jobs: { running: 0, queued: 0 },
  ...overrides,
});

const health = (enabled: boolean): NodeHealth => ({
  schema: 'baocut.node-health/v1',
  nodeId: 'node_abc',
  name: 'Studio',
  nodeProtocolVersion: 1,
  minNodeProtocolVersion: 1,
  runtimeVersion: '0.1.0',
  platform: { os: 'darwin', arch: 'arm64' },
  capabilities: {
    transcribe: {
      enabled,
      bundles: [{ bundleId: 'fake@cpu', backend: 'candle', device: 'cpu', state: 'installed' }],
      running: 0,
      queued: 1,
    },
  },
});

const paired = (overrides: Partial<PairedNode> = {}): PairedNode => ({
  nodeId: 'node_abc',
  alias: 'Studio',
  name: 'Studio',
  host: '192.168.1.20',
  port: 47610,
  pairedAt: '2026-10-01T00:00:00.000Z',
  health: health(true),
  problem: null,
  ...overrides,
});

describe('baocut share 的能力开关', () => {
  it('状态里逐项列出能力的开关；关闭的给出打开的命令', () => {
    const on = formatShareStatus(status());
    expect(on).toContain('能力：');
    expect(on).toContain('  转写（transcribe）：已打开');

    const off = formatShareStatus(status({ capabilities: { transcribe: { enabled: false }, align: { enabled: true } } }));
    expect(off).toContain('  转写（transcribe）：已关闭（baocut share capability transcribe on 打开）');
    // 不认识的能力照原名显示。
    expect(off).toContain('  align（align）：已打开');
    expect(off.indexOf('能力：')).toBeLessThan(off.findIndex((line) => line.startsWith('已配对的电脑：')));
  });

  it('share 关着时也显示能力的开关', () => {
    const lines = formatShareStatus(
      status({ enabled: false, listening: false, addresses: [], capabilities: { transcribe: { enabled: false } } }),
    );
    expect(lines[0]).toBe('共享这台电脑：已关闭');
    expect(lines).toContain('  转写（transcribe）：已关闭（baocut share capability transcribe on 打开）');
  });

  it('capability <能力> <on|off>', () => {
    expect(parseCapabilitySwitch(['transcribe', 'off'])).toEqual({ capability: 'transcribe', enabled: false });
    expect(parseCapabilitySwitch(['transcribe', 'on'])).toEqual({ capability: 'transcribe', enabled: true });
    // 认不认识这种能力由 Runtime 判断（invalid-request），这里只查形状。
    expect(parseCapabilitySwitch(['download', 'on'])).toEqual({ capability: 'download', enabled: true });
    for (const args of [[], ['transcribe'], ['transcribe', 'yes'], ['transcribe', 'on', 'extra']]) {
      expect(() => parseCapabilitySwitch(args)).toThrow(/baocut share capability <能力> <on\|off>/);
    }
  });

  it('nodes 列表：节点关闭了转写的共享时报告不可用与原因', () => {
    expect(describeNode(paired())).toBe('Studio  node_abc  192.168.1.20:47610  可用 · 模型 fake@cpu · 运行 0 排队 1');
    expect(describeNode(paired({ health: health(false) }))).toBe(
      'Studio  node_abc  192.168.1.20:47610  不可用 · 节点关闭了转写的共享（需要那台电脑打开）',
    );
    expect(describeNode(paired({ health: null, problem: 'unreachable' }))).toBe('Studio  node_abc  192.168.1.20:47610  连不上');
  });
});
