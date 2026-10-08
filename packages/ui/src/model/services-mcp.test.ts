import { describe, expect, it } from 'vitest';
import {
  MCP_SERVICE_TOOL_NAMES,
  type GrantRequestItem,
  type PendingApproval,
  type ServiceApproval,
  type SpaceEntry,
} from '@baocut/protocol';
import {
  approvalGrants,
  approvalSecondsLeft,
  grantLine,
  levelTitle,
  liveApprovalCount,
  liveApprovals,
  MCP_TOOLS,
  mcpScope,
  mcpSub,
  mcpToolTitle,
  outcomeLabel,
  pickedScope,
  requestLine,
  scopeVideos,
  toolGate,
  toolsSummary,
} from './services-mcp.ts';

function video(id: string, name: string, patch: Partial<SpaceEntry> = {}): SpaceEntry {
  return {
    id: `e-${id}`,
    kind: 'video',
    name,
    fileName: `${name}.mp4`,
    source: { projectId: 'p1', conversationId: null },
    relPath: `${name}.mp4`,
    size: 1,
    lastActivityAt: '2026-10-01T00:00:00.000Z',
    status: null,
    user: { favorite: false, displayName: null, trashedAt: null },
    ref: { videoId: id },
    ...patch,
  };
}

const names: Record<string, string> = { v1: '发布会', v2: '访谈' };
const nameOf = (id: string) => names[id];

describe('开放范围', () => {
  it('能选的视频：只要项目里、不在回收站的视频条目，按名字排、同一个只算一次；改过名用改后的', () => {
    const entries = [
      video('v2', '访谈'),
      video('v1', 'raw', { user: { favorite: false, displayName: '发布会', trashedAt: null } }),
      video('v1', '发布会-副本'),
      video('v3', '旧片', { user: { favorite: false, displayName: null, trashedAt: '2026-10-02T00:00:00.000Z' } }),
      video('v4', '散片', { source: { projectId: null, conversationId: 'c1' } }),
      { ...video('v5', '图'), kind: 'image' as const },
    ];
    expect(scopeVideos(entries)).toEqual([
      { videoId: 'v1', name: '发布会' },
      { videoId: 'v2', name: '访谈' },
    ]);
  });

  it('一句话：全部写总数，一个写名字（找不到写 ID），多个写数目，空名单直说', () => {
    expect(mcpScope('all', 3, nameOf)).toBe('所有视频（3）');
    expect(mcpScope({ ids: ['v1'] }, 3, nameOf)).toBe('「发布会」');
    expect(mcpScope({ ids: ['vx'] }, 3, nameOf)).toBe('「vx」');
    expect(mcpScope({ ids: ['v1', 'v2'] }, 3, nameOf)).toBe('其中 2 个视频');
    expect(mcpScope({ ids: [] }, 3, nameOf)).toBe('没有开放任何视频');
  });

  it('勾选之后：勾满等于全部，去重并丢掉不认识的；一部不剩是空名单，不悄悄放宽', () => {
    const all = ['v1', 'v2', 'v3'];
    expect(pickedScope(['v1', 'v2', 'v3'], all)).toBe('all');
    expect(pickedScope(['v2', 'v2', 'vx'], all)).toEqual({ ids: ['v2'] });
    expect(pickedScope([], all)).toEqual({ ids: [] });
    expect(pickedScope([], [])).toEqual({ ids: [] });
  });

  it('服务卡副行：开着说开放了什么，关着说启动后开放什么，起停中只说范围', () => {
    expect(levelTitle('ask')).toBe('修改前询问');
    expect(mcpSub('on', '所有视频（3）', 'read')).toBe('所有视频（3） · 只读 · 需要令牌');
    expect(mcpSub('off', '「发布会」', 'auto')).toBe('启动后开放「发布会」 · 直接放行 · 需要令牌');
    expect(mcpSub('starting', '「发布会」', 'auto')).toBe('「发布会」');
  });
});

describe('工具目录', () => {
  it('目录照协议常量；不认识的工具名照写', () => {
    expect(MCP_TOOLS.map((t) => t.name)).toEqual(MCP_SERVICE_TOOL_NAMES.map((t) => t.name));
    expect(mcpToolTitle('edits_apply')).toBe('修改视频');
    expect(mcpToolTitle('mystery')).toBe('mystery');
    const groupOf = (name: string) => MCP_TOOLS.find((t) => t.name === name)!.group;
    expect([groupOf('videos_list'), groupOf('edits_apply'), groupOf('download'), groupOf('jobs_cancel'), groupOf('speak')]).toEqual([
      'read',
      'edit',
      'job',
      'job',
      'generate',
    ]);
  });

  it('去向：读取直接应答；写入在只读下不提供，询问档调用前询问，放行档直接执行', () => {
    const read = MCP_TOOLS.find((t) => t.name === 'videos_list')!;
    const write = MCP_TOOLS.find((t) => t.name === 'export')!;
    expect(toolGate(read, 'read')).toBe('answer');
    expect(toolGate(write, 'read')).toBe('hidden');
    expect(toolGate(write, 'ask')).toBe('ask');
    expect(toolGate(write, 'auto')).toBe('auto');
  });

  it('段标题旁的一句：提供几个、几个要询问', () => {
    const total = MCP_TOOLS.length;
    const reads = MCP_TOOLS.filter((t) => t.access === 'read').length;
    expect(toolsSummary('read')).toBe(`提供 ${reads} / ${total} 个工具 · 全部只读`);
    expect(toolsSummary('ask')).toBe(`提供 ${total} / ${total} 个工具 · ${total - reads} 个调用前询问`);
    expect(toolsSummary('auto')).toBe(`提供 ${total} / ${total} 个工具 · 不需要确认`);
  });
});

describe('最近请求', () => {
  it('结果：成功、常见的拒绝说人话，其余照写错误码', () => {
    expect(outcomeLabel('ok')).toBe('成功');
    expect(outcomeLabel('SERVICE_APPROVAL_DENIED')).toBe('没有放行');
    expect(outcomeLabel('VIDEO_NOT_FOUND')).toBe('视频不在范围里');
    expect(outcomeLabel('INTERNAL')).toBe('INTERNAL');
  });

  it('一行：工具与视频名；视频不在列表里写 ID', () => {
    const base = { at: '2026-10-03T08:00:00Z', clientId: 'c1', clientName: 'Claude', outcome: 'ok' };
    expect(requestLine({ ...base, tool: 'videos_list', videoId: null }, nameOf)).toBe('videos_list');
    expect(requestLine({ ...base, tool: 'edits_apply', videoId: 'v1' }, nameOf)).toBe('edits_apply · 「发布会」');
    expect(requestLine({ ...base, tool: 'edits_apply', videoId: 'vx' }, nameOf)).toBe('edits_apply · 「vx」');
  });
});

describe('服务审批', () => {
  const now = Date.parse('2026-10-03T08:00:00Z');
  const approval = (approvalId: string, serviceId: ServiceApproval['serviceId'], secondsLeft: number): ServiceApproval => ({
    approvalId,
    serviceId,
    clientId: 'c1',
    clientName: 'Claude',
    tool: 'export',
    video: { videoId: 'v1', name: '发布会' },
    summary: '导出',
    createdAt: new Date(now - 10_000).toISOString(),
    expiresAt: new Date(now + secondsLeft * 1000).toISOString(),
  });

  it('剩余秒数向上取整，过了或日期坏了是 0', () => {
    expect(approvalSecondsLeft({ expiresAt: new Date(now + 1500).toISOString() }, now)).toBe(2);
    expect(approvalSecondsLeft({ expiresAt: new Date(now - 1).toISOString() }, now)).toBe(0);
    expect(approvalSecondsLeft({ expiresAt: 'x' }, now)).toBe(0);
  });

  it('只给这个服务的、还没过时限的；rail 角标数所有服务的', () => {
    const list = [approval('a1', 'mcp', 30), approval('a2', 'mcp', 0), approval('a3', 'model-api', 20)];
    expect(liveApprovals(list, 'mcp', now).map((a) => a.approvalId)).toEqual(['a1']);
    expect(liveApprovals(list, 'model-api', now).map((a) => a.approvalId)).toEqual(['a3']);
    expect(liveApprovalCount(list, now)).toBe(2);
  });

  const grant: GrantRequestItem = {
    capability: 'transcribe',
    dataKinds: ['audio'],
    recipient: 'openai',
    videoId: 'v1',
    purpose: '转录',
    reason: 'none',
    cost: 'unknown',
    estimate: null,
    maxCalls: null,
  };

  it('外发授权从 tasks 主题的统一列表按 approvalId 找，没有就是空', () => {
    const pending = [{ approvalId: 'a1', grants: [grant] }, { approvalId: 'a2' }] as PendingApproval[];
    expect(approvalGrants(pending, 'a1')).toEqual([grant]);
    expect(approvalGrants(pending, 'a2')).toEqual([]);
    expect(approvalGrants(pending, 'a9')).toEqual([]);
  });

  it('外发授权的一句：数据、收件方、用途，有估算带上金额', () => {
    expect(grantLine(grant)).toBe('要把音频发给 openai（转录）');
    expect(grantLine({ ...grant, dataKinds: ['transcript', 'document'], estimate: { amount: '0.02', currency: 'USD' } })).toBe(
      '要把文稿与译文、文本与提示词发给 openai（转录） · 约 0.02 USD',
    );
  });
});
