import { describe, expect, it, vi } from 'vitest';
import { TOOL_DEFINITIONS, type ToolDefinition } from '@open-artifact/protocol';
import { ArtifactTools, artifactRisk, type ArtifactsBackend } from './artifact-tools.ts';
import type { ToolPrincipal, ToolScope } from './tool-scope.ts';

const def = (name: string): ToolDefinition => TOOL_DEFINITIONS.find((d) => d.name === name)!;
const withRemote = (d: ToolDefinition): ToolDefinition => ({ ...d, annotations: { ...d.annotations, openWorldHint: true } });

describe('artifactRisk', () => {
  it('按动作种类：读与打开是 read，写是 edit，删除、交出与分享是 high，没列出的按 edit', () => {
    expect(artifactRisk(def('Artifact'), 'list')).toBe('read');
    expect(artifactRisk(def('Artifact'), 'open')).toBe('read');
    expect(artifactRisk(def('Artifact'), 'publish')).toBe('edit');
    expect(artifactRisk(def('Artifact'), 'delete')).toBe('high');
    expect(artifactRisk(def('Artifact'), 'share')).toBe('high');
    expect(artifactRisk(def('Artifact'), 'mystery')).toBe('edit');
    expect(artifactRisk(undefined, 'list')).toBe('edit');
    expect(artifactRisk(def('ArtifactComments'), 'reply')).toBe('edit');
  });

  it('remoteActions 只在装了远程类型（openWorldHint）时算 high；没装时读照旧是 read', () => {
    expect(def('ArtifactData').remoteActions).toContain('list');
    expect(artifactRisk(def('ArtifactData'), 'list')).toBe('read');
    expect(artifactRisk(withRemote(def('ArtifactData')), 'list')).toBe('high');
    expect(artifactRisk(withRemote(def('ArtifactComments')), 'wait')).toBe('read');
    expect(artifactRisk(withRemote(def('Artifact')), 'list')).toBe('read');
  });
});

describe('ArtifactTools.dispatch', () => {
  const agent = { kind: 'agent', conversationId: 'conv_1' } as unknown as ToolPrincipal;
  const setup = (result: Awaited<ReturnType<ArtifactsBackend['call']>> = { content: [{ type: 'text', text: 'ok' }] }) => {
    const authorize = vi.fn((principal: ToolPrincipal, write: boolean) => ({ principal, write }));
    const confirm = vi.fn(async () => undefined);
    const call = vi.fn(async () => result);
    const tools = new ArtifactTools({
      scope: { authorize, confirm } as unknown as ToolScope,
      backend: { definitions: () => TOOL_DEFINITIONS, call },
    });
    return { tools, authorize, confirm, call };
  };

  it('读不问；写按访问模式授权、确认后以会话的身份交给 daemon', async () => {
    const { tools, authorize, confirm, call } = setup();
    await tools.dispatch('Artifact', { action: 'list' }, agent);
    expect(authorize).toHaveBeenLastCalledWith(agent, false);
    expect(confirm).not.toHaveBeenCalled();
    await tools.dispatch('Artifact', { action: 'delete', url: 'open-artifact://artifact/a1' }, agent);
    expect(authorize).toHaveBeenLastCalledWith(agent, true);
    expect(confirm).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tool: 'Artifact', risk: 'high' }));
    expect(call).toHaveBeenLastCalledWith('Artifact', { action: 'delete', url: 'open-artifact://artifact/a1' }, 'conv_1');
  });

  it('daemon 答错误时抛 ToolError，带上 fix 与 next；只给会话里的智能体，不认识的工具拒绝', async () => {
    const { tools } = setup({ error: { code: 'not_found', message: 'No such artifact', fix: 'List artifacts first' }, next: 'Artifact list' } as never);
    await expect(tools.dispatch('Artifact', { action: 'list' }, agent)).rejects.toMatchObject({ code: 'not_found', message: 'No such artifact' });
    await expect(tools.dispatch('Nope', { action: 'list' }, agent)).rejects.toMatchObject({ code: 'UNKNOWN_TOOL' });
    await expect(tools.dispatch('Artifact', { action: 'list' }, { kind: 'service' } as unknown as ToolPrincipal)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
