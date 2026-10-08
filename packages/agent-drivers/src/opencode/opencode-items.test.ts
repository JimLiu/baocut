import { describe, expect, it } from 'vitest';
import { majorVersion, parseOpenCodeVersion } from './opencode-binary.ts';
import { accountOf, driverModels, modelRef } from './opencode-models.ts';
import { approvalOf, editDiff, permissionRules, toolItem, type ToolState } from './opencode-items.ts';
import { parseFrame } from './opencode-server.ts';

/** 纯函数：版本、模型 id、权限规则、权限请求与工具步骤的映射、SSE 帧。样本取自 OpenCode 2.0.24 的真实输出。 */

const PATCH = 'Index: notes.txt\n===\n--- notes.txt\n+++ notes.txt\n@@ -1,3 +1,3 @@\n alpha\n-beta\n+BETA\n gamma\n';

describe('版本', () => {
  it('认 2.x 的 `opencode v2.0.24` 与 1.x 的裸版本号', () => {
    expect(parseOpenCodeVersion('opencode v2.0.24\n')).toBe('2.0.24');
    expect(parseOpenCodeVersion('1.18.34\n')).toBe('1.18.34');
    expect(parseOpenCodeVersion('v2.1.0-beta.3')).toBe('2.1.0');
    expect(parseOpenCodeVersion('error: something')).toBeNull();
    expect(majorVersion('1.18.34')).toBe(1);
    expect(majorVersion('2.0.24')).toBe(2);
  });
});

describe('模型', () => {
  it('id 写成 provider/model，按第一个斜杠拆回去', () => {
    expect(modelRef('anthropic/claude-sonnet-5', null)).toEqual({ providerID: 'anthropic', id: 'claude-sonnet-5' });
    expect(modelRef('openrouter/meta/llama', 'high')).toEqual({ providerID: 'openrouter', id: 'meta/llama', variant: 'high' });
    expect(modelRef('no-slash', null)).toBeNull();
  });

  it('只留启用的模型，variants 当推理强度，默认模型打标', () => {
    const models = driverModels(
      [
        { id: 'a', providerID: 'p', name: 'A', enabled: true, variants: [{ id: 'default' }, { id: 'low' }, { id: 'high' }] },
        { id: 'b', providerID: 'p', enabled: false },
      ],
      'p/a',
    );
    expect(models).toEqual([
      {
        id: 'p/a',
        label: 'A',
        description: null,
        tier: null,
        isDefault: true,
        efforts: [
          { id: 'low', label: 'low' },
          { id: 'high', label: 'high' },
        ],
        defaultEffort: null,
      },
    ]);
  });

  it('账号：只有自带的 OpenCode Zen 时为 null', () => {
    expect(accountOf([{ id: 'opencode', name: 'OpenCode Zen', activation: 'enabled' }])).toBeNull();
    expect(accountOf([{ id: 'opencode' }, { id: 'anthropic', name: 'Anthropic', activation: 'enabled' }])).toBe('Anthropic');
  });
});

describe('访问模式 → 权限规则', () => {
  const effect = (mode: Parameters<typeof permissionRules>[0], action: string) =>
    permissionRules(mode).find((r) => r.action === action)?.effect;

  it('plan 拒绝编辑，命令与目录外来问；ask 到 auto 都来问，由 Harness 查表；fullAccess 放行', () => {
    expect(effect('plan', 'edit')).toBe('deny');
    expect(effect('plan', 'shell')).toBe('ask');
    for (const mode of ['ask', 'autoAcceptEdits', 'auto'] as const) {
      expect(effect(mode, 'edit')).toBe('ask');
      expect(effect(mode, 'shell')).toBe('ask');
      expect(effect(mode, 'external_directory')).toBe('ask');
    }
    expect(effect('fullAccess', 'edit')).toBe('allow');
    expect(effect('fullAccess', 'shell')).toBe('allow');
  });

  it('每一档都拒绝 question（BaoCut 没有回答表单的通道）', () => {
    for (const mode of ['plan', 'ask', 'autoAcceptEdits', 'auto', 'fullAccess'] as const) expect(effect(mode, 'question')).toBe('deny');
  });
});

describe('权限请求 → 审批', () => {
  const cwd = '/work';

  it('shell 是命令，规则按 commandRule', () => {
    const out = approvalOf({ id: 'per_1', sessionID: 's', action: 'shell', resources: ['npm install left-pad'] }, cwd);
    expect(out.request).toEqual({ kind: 'command', command: 'npm install left-pad', cwd, reason: null, rule: 'npm install' });
    expect(out.grantKey).toBe('command:npm install');
    expect(out.escalation).toBe(false);
  });

  it('edit 是文件修改，文件取元数据里的相对路径', () => {
    const out = approvalOf(
      {
        id: 'per_2',
        sessionID: 's',
        action: 'edit',
        resources: ['notes.txt'],
        metadata: { files: [{ file: 'notes.txt', patch: PATCH, status: 'modified' }] },
      },
      cwd,
    );
    expect(out.request).toEqual({ kind: 'file-change', reason: null, files: ['notes.txt'], rule: null });
    expect(out.grantKey).toBe('file-change');
  });

  it('external_directory 算越界', () => {
    const out = approvalOf({ id: 'per_3', sessionID: 's', action: 'external_directory', resources: ['/etc/*'] }, cwd);
    expect(out.request.kind).toBe('tool');
    expect(out.escalation).toBe(true);
  });
});

describe('工具步骤', () => {
  const base: ToolState = {
    id: 'call_1',
    name: 'edit',
    input: { path: '/work/notes.txt', oldString: 'beta', newString: 'BETA' },
    status: 'completed',
    content: 'Edited notes.txt (1 replacement)',
    metadata: { files: [{ file: 'notes.txt', patch: PATCH, status: 'modified', additions: 1, deletions: 1 }] },
    error: null,
    startedAt: 1000,
    endedAt: 1250,
  };

  it('文件修改的输出是 OpenCode 给的统一 diff', () => {
    expect(toolItem(base, '/work', [])).toEqual({
      kind: 'tool-call',
      id: 'call_1',
      tool: 'file-change',
      title: 'notes.txt',
      detail: 'modified notes.txt',
      output: PATCH,
      status: 'completed',
      exitCode: null,
      durationMs: 250,
    });
  });

  it('没有元数据时由 oldString / newString 拼 diff', () => {
    const item = toolItem({ ...base, metadata: null }, '/work', []);
    expect(item.title).toBe('notes.txt');
    expect(item.output).toBe(editDiff('notes.txt', base.input));
    expect(item.output).toContain('-beta\n+BETA');
  });

  it('shell 的标题是命令，MCP 工具按服务名前缀认', () => {
    expect(toolItem({ ...base, name: 'shell', input: { command: 'echo hi' }, metadata: null, content: 'hi' }, '/work', []).title).toBe(
      'echo hi',
    );
    expect(toolItem({ ...base, name: 'shell', input: { command: 'ls' }, metadata: null }, '/work', []).tool).toBe('command');
    expect(toolItem({ ...base, name: 'baocut_project_read', input: {}, metadata: null }, '/work', ['baocut']).tool).toBe('mcp');
    expect(toolItem({ ...base, name: 'glob', input: { pattern: '**/x' }, metadata: null }, '/work', []).title).toBe('glob **/x');
  });
});

describe('SSE 帧', () => {
  it('解析 data 行，忽略心跳注释', () => {
    expect(parseFrame(': heartbeat')).toBeNull();
    expect(parseFrame('data: {"id":"evt_1","type":"server.connected","data":{}}')).toEqual({
      id: 'evt_1',
      type: 'server.connected',
      data: {},
    });
    expect(parseFrame('data: not json')).toBeNull();
  });
});
