import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '@baocut/harness';
import { ClaudeDriver } from './claude-driver.ts';
import { firstSentence, userText } from './claude-import.ts';

/**
 * 导入 Claude Code 的本机会话（产品设计 §3.1「导入外部会话」）：读临时配置目录里手写的记录文件，不碰本机真实的 `~/.claude`。
 * 子智能体、元信息、工具结果与本机命令的输出不算用户的话；工具调用只留标题，失败的按工具结果标出来。
 */

const SESSION = '11111111-2222-3333-4444-555555555555';
const OTHER = '66666666-7777-8888-9999-000000000000';

const user = (text: unknown, extra: Record<string, unknown> = {}) => ({
  type: 'user',
  sessionId: SESSION,
  cwd: '/work/promo',
  timestamp: '2026-10-29T08:00:00.000Z',
  message: { role: 'user', content: text },
  ...extra,
});
const assistant = (content: unknown[], timestamp = '2026-10-29T08:01:00.000Z') => ({
  type: 'assistant',
  sessionId: SESSION,
  cwd: '/work/promo',
  timestamp,
  message: { role: 'assistant', content },
});

describe('Claude Code 的本机会话', () => {
  let dir: string;
  let driver: ClaudeDriver;

  async function write(project: string, id: string, lines: unknown[], mtime: Date): Promise<void> {
    const file = path.join(dir, 'projects', project, `${id}.jsonl`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n{broken`);
    await fs.utimes(file, mtime, mtime);
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-claude-import-'));
    driver = new ClaudeDriver(silentLogger, { locate: async () => null, configDir: dir });
    await write(
      '-work-promo',
      SESSION,
      [
        { type: 'queue-operation', operation: 'enqueue', sessionId: SESSION },
        user('Caveat: local commands below.', { isMeta: true }),
        user('Cut the intro to 10 seconds. Then add captions.'),
        assistant([
          { type: 'text', text: 'Looking at the timeline.' },
          { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls -la\nwc -l', description: 'List files' } },
          { type: 'tool_use', id: 'tu2', name: 'Edit', input: { file_path: '/work/promo/cut.json' } },
        ]),
        user([{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }], { toolUseResult: { stdout: 'ok' } }),
        user([{ type: 'tool_result', tool_use_id: 'tu2', content: 'denied', is_error: true }]),
        assistant([{ type: 'text', text: 'Trimmed to 10 seconds.' }], '2026-10-29T08:02:00.000Z'),
        { ...user('sub-agent prompt'), isSidechain: true },
        user(
          '<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args>keep captions</command-args>',
        ),
        user('<local-command-stdout>Compacted</local-command-stdout>'),
        assistant([{ type: 'tool_use', id: 'tu3', name: 'mcp__baocut__videos_open', input: {} }], '2026-10-29T08:03:00.000Z'),
      ],
      new Date('2026-10-29T09:00:00.000Z'),
    );
    await write(
      '-work-other',
      OTHER,
      [{ ...user('Older one'), sessionId: OTHER, cwd: '/work/other' }],
      new Date('2026-10-01T09:00:00.000Z'),
    );
    // 只有元信息、没有用户的话的记录不列。
    await write('-work-empty', 'empty', [user('meta', { isMeta: true })], new Date('2026-10-30T09:00:00.000Z'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('按修改时间列出：第一句话、目录、用户发过几次话', async () => {
    expect(await driver.listNativeSessions({ limit: 10 })).toEqual([
      {
        nativeId: SESSION,
        cwd: '/work/promo',
        title: 'Cut the intro to 10 seconds.',
        turns: 2,
        updatedAt: '2026-10-29T09:00:00.000Z',
        persistence: { driverId: 'claude', data: { sessionId: SESSION } },
      },
      {
        nativeId: OTHER,
        cwd: '/work/other',
        title: 'Older one',
        turns: 1,
        updatedAt: '2026-10-01T09:00:00.000Z',
        persistence: { driverId: 'claude', data: { sessionId: OTHER } },
      },
    ]);
    expect(await driver.listNativeSessions({ limit: 1 })).toHaveLength(1);
  });

  it('读出每一轮：回复文字合并，工具调用只留标题，失败的标出来；斜杠命令写成 /命令 参数', async () => {
    const history = await driver.readNativeSession(SESSION);
    expect(history.persistence).toEqual({ driverId: 'claude', data: { sessionId: SESSION } });
    expect(history.cwd).toBe('/work/promo');
    expect(history.title).toBe('Cut the intro to 10 seconds.');
    expect(history.turns).toEqual([
      {
        user: 'Cut the intro to 10 seconds. Then add captions.',
        startedAt: '2026-10-29T08:00:00.000Z',
        endedAt: '2026-10-29T08:02:00.000Z',
        steps: [
          { kind: 'message', text: 'Looking at the timeline.' },
          { kind: 'tool', tool: 'command', title: 'ls -la', detail: 'List files', status: 'completed' },
          { kind: 'tool', tool: 'other', title: 'Edit /work/promo/cut.json', detail: null, status: 'failed' },
          { kind: 'message', text: 'Trimmed to 10 seconds.' },
        ],
      },
      {
        user: '/compact keep captions',
        startedAt: '2026-10-29T08:00:00.000Z',
        endedAt: '2026-10-29T08:03:00.000Z',
        steps: [{ kind: 'tool', tool: 'mcp', title: 'baocut · videos_open', detail: null, status: 'completed' }],
      },
    ]);
  });

  it('找不到的会话（或不像会话 id 的）是 not-found', async () => {
    await expect(driver.readNativeSession('nope')).rejects.toMatchObject({ code: 'not-found' });
    await expect(driver.readNativeSession('../../etc/passwd')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('第一句话：按句号断开，压成一行，过长截断', () => {
    expect(firstSentence('做个片头。再加字幕')).toBe('做个片头。');
    expect(firstSentence('Line one\nline two')).toBe('Line one line two');
    expect(firstSentence('x'.repeat(200))).toHaveLength(160);
    expect(userText({ type: 'user', message: { content: [{ type: 'text', text: '<system-reminder>x</system-reminder>' }] } })).toBeNull();
  });
});
