import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clientIdOfToken,
  codexSectionRange,
  hasMcpEntry,
  hostSkillsDir,
  jsonIndent,
  mcpHostConfig,
  parseAgentHost,
  readMcpEntryToken,
  writeMcpEntry,
} from './agent-hosts.ts';

/** 每个用例一个临时 HOME：位置全从这份环境变量算，不碰真实的宿主配置。 */
let home: string;
let env: NodeJS.ProcessEnv;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-agent-hosts-'));
  env = { HOME: home, PATH: '' };
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

const entry = { name: 'baocut', url: 'http://127.0.0.1:47620/mcp', token: 'bct_secret' };
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, any>;

describe('宿主的位置', () => {
  it('skills 目录：默认在 HOME 下，CLAUDE_CONFIG_DIR、CODEX_HOME 生效', () => {
    expect(hostSkillsDir('claude-code', env)).toBe(path.join(home, '.claude', 'skills'));
    expect(hostSkillsDir('codex', env)).toBe(path.join(home, '.codex', 'skills'));
    expect(hostSkillsDir('cursor', env)).toBe(path.join(home, '.cursor', 'skills'));
    expect(hostSkillsDir('gemini', env)).toBe(path.join(home, '.gemini', 'skills'));
    const custom = { ...env, CLAUDE_CONFIG_DIR: path.join(home, 'cc'), CODEX_HOME: path.join(home, 'cx') };
    expect(hostSkillsDir('claude-code', custom)).toBe(path.join(home, 'cc', 'skills'));
    expect(hostSkillsDir('codex', custom)).toBe(path.join(home, 'cx', 'skills'));
    expect(mcpHostConfig('claude-code', custom).file).toBe(path.join(home, 'cc', '.claude.json'));
    expect(mcpHostConfig('codex', custom).file).toBe(path.join(home, 'cx', 'config.toml'));
  });

  it('--agent 只认四个宿主', () => {
    expect(parseAgentHost('codex')).toBe('codex');
    expect(() => parseAgentHost(undefined)).toThrow(/缺少 --agent/);
    expect(() => parseAgentHost('vscode')).toThrow(/不认识的宿主「vscode」/);
  });
});

describe('写 MCP 配置', () => {
  it('Claude Code：令牌进 settings.json 的 env，.claude.json 只写引用；其余键原样保留', () => {
    fs.writeFileSync(
      path.join(home, '.claude.json'),
      JSON.stringify({ theme: 'dark', mcpServers: { other: { type: 'stdio', command: 'x' } } }),
    );
    fs.mkdirSync(path.join(home, '.claude'));
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ model: 'opus', env: { FOO: '1' } }));
    expect(hasMcpEntry('claude-code', env)).toBe(false);

    const written = writeMcpEntry('claude-code', env, entry, { runClaude: null });
    expect(written.tokenStorage).toBe('env');

    const root = readJson(path.join(home, '.claude.json'));
    expect(root.theme).toBe('dark');
    expect(root.mcpServers.other).toEqual({ type: 'stdio', command: 'x' });
    expect(root.mcpServers.baocut).toEqual({ type: 'http', url: entry.url, headers: { Authorization: 'Bearer ${BAOCUT_MCP_TOKEN}' } });
    expect(JSON.stringify(root)).not.toContain('bct_secret');
    const settings = readJson(path.join(home, '.claude', 'settings.json'));
    expect(settings).toEqual({ model: 'opus', env: { FOO: '1', BAOCUT_MCP_TOKEN: 'bct_secret' } });
    expect(hasMcpEntry('claude-code', env)).toBe(true);
  });

  it('Claude Code：PATH 上有 claude 时交给它（已有条目先删再加）', () => {
    const calls: string[][] = [];
    writeMcpEntry('claude-code', env, entry, { runClaude: (args) => calls.push(args) });
    expect(calls).toEqual([
      [
        'mcp',
        'add',
        '--scope',
        'user',
        '--transport',
        'http',
        'baocut',
        entry.url,
        '--header',
        'Authorization: Bearer ${BAOCUT_MCP_TOKEN}',
      ],
    ]);
    fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { baocut: {} } }));
    calls.length = 0;
    writeMcpEntry('claude-code', env, entry, { runClaude: (args) => calls.push(args) });
    expect(calls.map((args) => args[1])).toEqual(['remove', 'add']);
  });

  it('Cursor 与 Gemini CLI：明文请求头，新文件只给自己读写', () => {
    expect(writeMcpEntry('cursor', env, entry).tokenStorage).toBe('plaintext');
    const cursorFile = path.join(home, '.cursor', 'mcp.json');
    expect(readJson(cursorFile).mcpServers.baocut).toEqual({ url: entry.url, headers: { Authorization: 'Bearer bct_secret' } });
    if (process.platform !== 'win32') expect(fs.statSync(cursorFile).mode & 0o777).toBe(0o600);

    const geminiFile = path.join(home, '.gemini', 'settings.json');
    fs.mkdirSync(path.dirname(geminiFile));
    fs.writeFileSync(geminiFile, JSON.stringify({ general: { vimMode: true } }), { mode: 0o644 });
    writeMcpEntry('gemini', env, entry);
    const gemini = readJson(geminiFile);
    expect(gemini.general).toEqual({ vimMode: true });
    expect(gemini.mcpServers.baocut).toEqual({ url: entry.url, type: 'http', headers: { Authorization: 'Bearer bct_secret' } });
    if (process.platform !== 'win32') expect(fs.statSync(geminiFile).mode & 0o777).toBe(0o644);
  });

  it('读不懂的 JSON 报错，不覆盖', () => {
    const file = path.join(home, '.cursor', 'mcp.json');
    fs.mkdirSync(path.dirname(file));
    fs.writeFileSync(file, '{ broken');
    expect(() => writeMcpEntry('cursor', env, entry)).toThrow(/不是合法的 JSON，没有改动/);
    expect(fs.readFileSync(file, 'utf8')).toBe('{ broken');
  });

  it('Codex：只换 [mcp_servers.baocut] 那一段（含子表），其余原样', () => {
    const file = path.join(home, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(file));
    const before = [
      'model = "gpt-5"',
      '',
      '[mcp_servers.baocut]',
      'url = "http://old"',
      '',
      '[mcp_servers.baocut.env]',
      'X = "1"',
      '',
      '[mcp_servers.other]',
      'command = "x"',
      '',
    ].join('\n');
    fs.writeFileSync(file, before);
    expect(codexSectionRange(before, 'baocut')).toEqual({ start: 2, end: 7 });
    expect(hasMcpEntry('codex', env)).toBe(true);

    expect(writeMcpEntry('codex', env, entry).tokenStorage).toBe('plaintext');
    expect(fs.readFileSync(file, 'utf8')).toBe(
      [
        'model = "gpt-5"',
        '',
        '[mcp_servers.baocut]',
        `url = "${entry.url}"`,
        'http_headers = { Authorization = "Bearer bct_secret" }',
        '',
        '[mcp_servers.other]',
        'command = "x"',
        '',
      ].join('\n'),
    );
  });

  it('Codex：没有这一段时接在末尾', () => {
    const file = path.join(home, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(file));
    fs.writeFileSync(file, 'model = "gpt-5"\n');
    expect(hasMcpEntry('codex', env)).toBe(false);
    writeMcpEntry('codex', env, entry);
    expect(fs.readFileSync(file, 'utf8')).toBe(
      `model = "gpt-5"\n\n[mcp_servers.baocut]\nurl = "${entry.url}"\nhttp_headers = { Authorization = "Bearer bct_secret" }\n`,
    );
  });
});

describe('旧条目的令牌与配置的格式', () => {
  it('认出各宿主旧条目用的令牌与它的客户端 id', () => {
    expect(readMcpEntryToken('cursor', env)).toBeNull();
    writeMcpEntry('cursor', env, { ...entry, token: 'mcl_a.c2VjcmV0' });
    expect(readMcpEntryToken('cursor', env)).toBe('mcl_a.c2VjcmV0');
    writeMcpEntry('gemini', env, { ...entry, token: 'mcl_b.c2VjcmV0' });
    expect(readMcpEntryToken('gemini', env)).toBe('mcl_b.c2VjcmV0');
    writeMcpEntry('codex', env, { ...entry, token: 'mcl_c.c2VjcmV0' });
    expect(readMcpEntryToken('codex', env)).toBe('mcl_c.c2VjcmV0');
    writeMcpEntry('claude-code', env, { ...entry, token: 'mcl_d.c2VjcmV0' }, { runClaude: null });
    expect(readMcpEntryToken('claude-code', env)).toBe('mcl_d.c2VjcmV0');

    // Codex 的子表写法也认。
    const codex = path.join(home, '.codex', 'config.toml');
    fs.writeFileSync(
      codex,
      '[mcp_servers.baocut]\nurl = "x"\n\n[mcp_servers.baocut.http_headers]\nAuthorization = "Bearer mcl_e.c2VjcmV0"\n',
    );
    expect(readMcpEntryToken('codex', env)).toBe('mcl_e.c2VjcmV0');

    expect(clientIdOfToken('mcl_abc123.c2VjcmV0')).toBe('mcl_abc123');
    expect(clientIdOfToken('手写的令牌')).toBeNull();
    expect(clientIdOfToken('no-dot')).toBeNull();
  });

  it('JSON 沿用原来的缩进、换行符与结尾换行', () => {
    const file = path.join(home, '.cursor', 'mcp.json');
    fs.mkdirSync(path.dirname(file));
    fs.writeFileSync(file, '{\n    "mcpServers": {\n        "other": { "url": "y" }\n    }\n}');
    writeMcpEntry('cursor', env, entry);
    const text = fs.readFileSync(file, 'utf8');
    expect(text).toMatch(/^\{\n {4}"mcpServers": \{\n {8}"other": \{/);
    expect(text.endsWith('}')).toBe(true);

    fs.writeFileSync(file, '{\r\n\t"mcpServers": {}\r\n}\r\n');
    writeMcpEntry('cursor', env, entry);
    expect(fs.readFileSync(file, 'utf8')).toMatch(/^\{\r\n\t"mcpServers": \{\r\n\t\t"baocut"[\s\S]*\}\r\n$/);

    expect(jsonIndent('{"a":1}')).toBe(0);
    expect(jsonIndent('{}')).toBe(2);
    expect(jsonIndent('{\n  "a": 1\n}')).toBe(2);
  });

  it('Claude Code：写条目失败时把 settings.json 里的旧令牌放回去', () => {
    fs.mkdirSync(path.join(home, '.claude'));
    const settingsFile = path.join(home, '.claude', 'settings.json');
    fs.writeFileSync(settingsFile, JSON.stringify({ env: { BAOCUT_MCP_TOKEN: 'mcl_old.c2VjcmV0' } }, null, 2));
    expect(() =>
      writeMcpEntry('claude-code', env, entry, {
        runClaude: () => {
          throw new Error('claude 不在了');
        },
      }),
    ).toThrow('claude 不在了');
    expect(readJson(settingsFile).env).toEqual({ BAOCUT_MCP_TOKEN: 'mcl_old.c2VjcmV0' });
  });
});
