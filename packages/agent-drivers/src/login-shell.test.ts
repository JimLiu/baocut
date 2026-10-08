import { describe, expect, it } from 'vitest';
import { mergeLoginEnv, parseEnv0, resolveLoginShellEnv, stripHostSessionEnv } from './login-shell.ts';

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
