import { describe, expect, it } from 'vitest';
import {
  createLoginShellEnvResolver,
  mergeLoginEnv,
  parseEnv0,
  resolveLoginShellEnv,
  stripHostSessionEnv,
  toolSearchPath,
  type LoginShellFailure,
} from './login-shell.ts';

describe('stripHostSessionEnv', () => {
  it('按前缀去掉宿主 Claude Code 会话的变量，保留用户自己配的与无关的', () => {
    const env = {
      // 宿主会话（Claude Code 桌面版里实测漏下来的一部分）
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'sdk-ts',
      CLAUDE_EFFORT: 'high',
      CLAUDE_CODE_EFFORT_LEVEL: 'max',
      CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL: 'true',
      CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: 'true',
      CLAUDE_CODE_USER_EMAIL: 'someone@example.com',
      CLAUDE_CODE_SESSION_ID: 'abc',
      CLAUDE_AGENT_SDK_VERSION: '0.3.288',
      CLAUDE_PID: '123',
      CLAUDE_SOMETHING_NEW: 'x',
      // 用户自己配的
      CLAUDE_CONFIG_DIR: '/Users/me/.claude-work',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_USE_VERTEX: '1',
      CLAUDE_CODE_OAUTH_TOKEN: 'token',
      CLAUDE_CODE_GIT_BASH_PATH: 'C:\\Git\\bin\\bash.exe',
      ANTHROPIC_BASE_URL: 'https://gateway.example.com',
      ANTHROPIC_API_KEY: 'key',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'my-opus',
      // 无关的
      PATH: '/usr/bin',
      HOME: '/Users/me',
      MY_CLAUDE_HELPER: 'kept',
    };
    const out = stripHostSessionEnv(env);
    for (const key of [
      'CLAUDECODE',
      'CLAUDE_CODE_ENTRYPOINT',
      'CLAUDE_EFFORT',
      'CLAUDE_CODE_EFFORT_LEVEL',
      'CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL',
      'CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING',
      'CLAUDE_CODE_USER_EMAIL',
      'CLAUDE_CODE_SESSION_ID',
      'CLAUDE_AGENT_SDK_VERSION',
      'CLAUDE_PID',
      'CLAUDE_SOMETHING_NEW',
    ]) {
      expect(out).not.toHaveProperty(key);
    }
    expect(out).toEqual({
      CLAUDE_CONFIG_DIR: '/Users/me/.claude-work',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_USE_VERTEX: '1',
      CLAUDE_CODE_OAUTH_TOKEN: 'token',
      CLAUDE_CODE_GIT_BASH_PATH: 'C:\\Git\\bin\\bash.exe',
      ANTHROPIC_BASE_URL: 'https://gateway.example.com',
      ANTHROPIC_API_KEY: 'key',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'my-opus',
      PATH: '/usr/bin',
      HOME: '/Users/me',
      MY_CLAUDE_HELPER: 'kept',
    });
    // 不改传入的对象。
    expect(env.CLAUDECODE).toBe('1');
  });
});

describe('登录 shell 的环境', () => {
  it('parseEnv0：NUL 分隔，值里可以有换行与等号；去掉 shell 自己的状态', () => {
    const text = [
      'GEMINI_API_KEY=k=1',
      'MULTI=a\nb',
      'PWD=/x',
      'OLDPWD=/y',
      'SHLVL=2',
      '_=/usr/bin/env',
      'BAOCUT_LOGIN_SHELL_PROBE=1',
      'bad',
      '',
    ].join('\0');
    expect(parseEnv0(text)).toEqual({ GEMINI_API_KEY: 'k=1', MULTI: 'a\nb' });
  });

  it('mergeLoginEnv：只在登录 shell 里有的补上，两边都有的以当前进程为准，PATH 合并且登录 shell 的在前', () => {
    const merged = mergeLoginEnv(
      { GEMINI_API_KEY: 'from-shell', BAOCUT_HOME: '/shell/home', PATH: '/opt/homebrew/bin:/usr/bin' },
      { BAOCUT_HOME: '/runtime/home', PATH: '/usr/bin:/bin' },
    );
    expect(merged).toEqual({ GEMINI_API_KEY: 'from-shell', BAOCUT_HOME: '/runtime/home', PATH: '/opt/homebrew/bin:/usr/bin:/bin' });
    expect(mergeLoginEnv(null, { PATH: '/bin', A: '1' })).toEqual({ PATH: '/bin', A: '1' });
  });

  it.skipIf(process.platform === 'win32')('resolveLoginShellEnv：真的起一次登录 shell，读到整份环境', async () => {
    const env = await resolveLoginShellEnv();
    expect(env?.HOME).toBeTruthy();
    expect(env?.PATH).toBeTruthy();
    expect(env).not.toHaveProperty('BAOCUT_LOGIN_SHELL_PROBE');
  });
});

describe('登录 shell 探测的失败与重试（issue 139）', () => {
  const GUI_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
  const BREW_PATH = `/opt/homebrew/bin:${GUI_PATH}`;
  const ok = { stdout: `banner__BAOCUT_ENV__PATH=${BREW_PATH}\0HOME=/Users/me\0__BAOCUT_ENV__` };

  function setup(results: Array<() => Promise<{ stdout: string }>>) {
    let clock = 1_000;
    let calls = 0;
    const failures: LoginShellFailure[] = [];
    const resolve = createLoginShellEnvResolver({
      platform: 'darwin',
      env: () => ({ SHELL: '/bin/zsh', PATH: GUI_PATH }),
      now: () => clock,
      retryMs: 30_000,
      run: async () => results[Math.min(calls++, results.length - 1)]!(),
      onFailure: (failure) => failures.push(failure),
    });
    return { resolve, failures, calls: () => calls, advance: (ms: number) => (clock += ms) };
  }

  it('第一次失败不缓存：冷却期内不重探，过了冷却期再探就拿到 Homebrew 的 PATH', async () => {
    const t = setup([() => Promise.reject(Object.assign(new Error('boom'), { code: 'ENOENT' })), async () => ok]);
    expect(await t.resolve()).toBeNull();
    expect(await t.resolve()).toBeNull();
    expect(t.calls()).toBe(1);
    t.advance(30_000);
    expect((await t.resolve())?.PATH).toBe(BREW_PATH);
    expect(t.calls()).toBe(2);
    // 成功后一直用，不再探测。
    t.advance(60_000);
    expect((await t.resolve())?.HOME).toBe('/Users/me');
    expect(t.calls()).toBe(2);
    expect(t.failures).toEqual([{ kind: 'spawn', shell: '/bin/zsh', retryAt: 31_000 }]);
  });

  it('并发的调用共用同一次探测', async () => {
    const t = setup([async () => ok]);
    const [a, b] = await Promise.all([t.resolve(), t.resolve()]);
    expect(a).toBe(b);
    expect(t.calls()).toBe(1);
  });

  it('失败按类别报告：超时、非零退出、标记缺失、输出超限', async () => {
    const t = setup([
      () => Promise.reject(Object.assign(new Error('timeout'), { killed: true, signal: 'SIGTERM', code: null })),
      () => Promise.reject(Object.assign(new Error('exit'), { code: 2 })),
      async () => ({ stdout: 'no markers here' }),
      () => Promise.reject(Object.assign(new Error('big'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' })),
    ]);
    for (let i = 0; i < 4; i++) {
      expect(await t.resolve()).toBeNull();
      t.advance(30_000);
    }
    expect(t.failures.map((f) => [f.kind, f.exitCode])).toEqual([
      ['timeout', undefined],
      ['exit', 2],
      ['output', undefined],
      ['output', undefined],
    ]);
    // 报告里没有环境内容。
    expect(JSON.stringify(t.failures)).not.toContain('PATH');
  });

  it('Windows 不探测，结果是 null 且不报失败', async () => {
    let calls = 0;
    const failures: LoginShellFailure[] = [];
    const resolve = createLoginShellEnvResolver({
      platform: 'win32',
      run: async () => {
        calls++;
        return ok;
      },
      onFailure: (failure) => failures.push(failure),
    });
    expect(await resolve()).toBeNull();
    expect(await resolve()).toBeNull();
    expect(calls).toBe(0);
    expect(failures).toEqual([]);
  });
});

describe('toolSearchPath', () => {
  const GUI_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
  it('探测失败、只有 GUI 的精简 PATH 时，补上存在的标准目录（排在最后）', () => {
    expect(toolSearchPath(null, GUI_PATH, 'darwin', ['/opt/homebrew/bin', '/usr/local/bin'])).toBe(
      `${GUI_PATH}:/opt/homebrew/bin:/usr/local/bin`,
    );
  });

  it('登录 shell 的 PATH（含自定义 Homebrew 前缀）在前，标准目录不重复', () => {
    const login = { PATH: '/Users/me/homebrew/bin:/opt/homebrew/bin:/usr/bin' };
    expect(toolSearchPath(login, GUI_PATH, 'darwin', ['/opt/homebrew/bin'])).toBe('/Users/me/homebrew/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin');
  });

  it('标准目录都不存在时（确实没装）只用原来的 PATH', () => {
    expect(toolSearchPath(null, GUI_PATH, 'darwin', [])).toBe(GUI_PATH);
  });

  it('Windows 不补目录', () => {
    expect(toolSearchPath(null, 'C:\\Windows', 'win32', ['/opt/homebrew/bin'])).toBe('C:\\Windows');
  });
});
