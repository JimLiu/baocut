import { describe, expect, it } from 'vitest';
import { BUILTIN_DRIVER_IDS, DRIVER_ID_PATTERN, isBuiltinDriverId, RpcError } from '@baocut/protocol';
import { ACP_CATALOG, type AcpCatalogEntry } from './acp-catalog.ts';
import {
  catalogRequest,
  customLoginCommand,
  customRequest,
  hasErrors,
  isCustomDriver,
  isProviderExists,
  launcherOf,
  launchLine,
  listedInPicker,
  MORE_BUILTIN_IDS,
  parseEnv,
  searchCatalog,
  splitCommand,
  validateCustom,
} from './agent-catalog.ts';

const catalog: AcpCatalogEntry[] = [
  {
    id: 'goose',
    name: 'goose',
    version: '1.33.1',
    description: '开源、可扩展的本地智能体。',
    command: ['goose', 'acp'],
    docs: 'https://example.test/goose',
  },
  {
    id: 'auggie',
    name: 'Auggie CLI',
    version: '0.33.0',
    description: '长于在大型代码库里检索上下文。',
    command: ['npx', '-y', '@augmentcode/auggie@0.33.0', '--acp'],
    env: { AUGMENT_DISABLE_AUTO_UPDATE: '1' },
    docs: 'https://example.test/auggie',
  },
  {
    id: 'fast-agent',
    name: 'fast-agent',
    version: '0.9.22',
    description: '可接多家模型服务。',
    command: ['uvx', '--from', 'fast-agent-acp==0.9.22', 'fast-agent-acp', '-x'],
    docs: 'https://example.test/fast-agent',
  },
];

describe('目录搜索', () => {
  it('每个词都要在名字、id、介绍或命令里出现，不分大小写；已添加的打标', () => {
    expect(searchCatalog(catalog, '', []).map((e) => e.id)).toEqual(['goose', 'auggie', 'fast-agent']);
    expect(searchCatalog(catalog, 'AUGGIE', []).map((e) => e.id)).toEqual(['auggie']);
    expect(searchCatalog(catalog, '代码库', []).map((e) => e.id)).toEqual(['auggie']);
    expect(searchCatalog(catalog, 'uvx', []).map((e) => e.id)).toEqual(['fast-agent']);
    expect(searchCatalog(catalog, 'npx acp', []).map((e) => e.id)).toEqual(['auggie']);
    expect(searchCatalog(catalog, 'goose 不存在', [])).toEqual([]);
    expect(searchCatalog(catalog, '  ', ['goose']).map((e) => e.added)).toEqual([true, false, false]);
  });
});

describe('自定义命令', () => {
  it('命令按空白拆，引号里的一段算一个参数', () => {
    expect(splitCommand('  my-agent   --acp ')).toEqual(['my-agent', '--acp']);
    expect(splitCommand(`agent --config "~/My Agents/a.toml" 'x y'`)).toEqual(['agent', '--config', '~/My Agents/a.toml', 'x y']);
    expect(splitCommand('')).toEqual([]);
  });

  it('环境变量每行 KEY=VALUE，空行忽略，写错的报第一处行号', () => {
    expect(parseEnv('A=1\n\n B_2 = two words \nC=')).toEqual({ env: { A: '1', B_2: 'two words', C: '' }, bad: null });
    expect(parseEnv('A=1\nnot-a-pair').bad).toBe(2);
    expect(parseEnv('=1').bad).toBe(1);
    expect(parseEnv('1A=x').bad).toBe(1);
    expect(parseEnv(`${'A'.repeat(129)}=x`).bad).toBe(1);
  });

  const ok = { id: 'my-agent', name: '我的 Agent', command: 'my-agent --acp', env: '' };

  it('填对了没有错误', () => {
    expect(validateCustom(ok, ['claude'])).toEqual({});
    expect(hasErrors(validateCustom(ok, []))).toBe(false);
  });

  it('id、名字与命令必填', () => {
    expect(Object.keys(validateCustom({ id: '', name: '', command: '', env: '' }, [])).sort()).toEqual(['command', 'id', 'name']);
    expect(validateCustom({ ...ok, name: '   ' }, []).name).toMatch(/名字/);
    expect(validateCustom({ ...ok, name: '名'.repeat(101) }, []).name).toMatch(/最长 100/);
  });

  it('id 小写字母开头、只用 a-z0-9-，最长与协议一致（63）', () => {
    for (const id of ['1agent', 'My-agent', 'my_agent', '-a', 'agent!'])
      expect(validateCustom({ ...ok, id }, []).id, id).toMatch(/小写字母开头/);
    expect(validateCustom({ ...ok, id: 'a'.repeat(63) }, []).id).toBeUndefined();
    expect(validateCustom({ ...ok, id: 'a'.repeat(64) }, []).id).toMatch(/最长 63/);
  });

  it('不撞内置（即使这一版没带它的 Driver）、已添加与目录里的 id', () => {
    expect(validateCustom({ ...ok, id: 'copilot' }, []).id).toMatch(/「copilot」是 BaoCut 内置 Agent 的 id/);
    expect(validateCustom({ ...ok, id: 'claude' }, ['claude'], { claude: 'Claude Code' }).id).toMatch(
      /「claude」是 BaoCut 内置 Agent 的 id（Claude Code）/,
    );
    expect(validateCustom({ ...ok, id: 'goose' }, ['goose'], { goose: 'goose' }).id).toMatch(/已经有一个 Agent 用了「goose」，/);
    expect(validateCustom({ ...ok, id: 'my-x' }, ['my-x'], { 'my-x': 'X' }).id).toMatch(/「my-x」（X）/);
  });

  it('只收一条命令：管道、重定向与 && 不生效；参数最多 64 个', () => {
    expect(validateCustom({ ...ok, command: 'my-agent --acp | tee log' }, []).command).toMatch(/只填一条命令/);
    expect(validateCustom({ ...ok, command: 'a && b' }, []).command).toMatch(/只填一条命令/);
    expect(validateCustom({ ...ok, command: 'a > out' }, []).command).toMatch(/只填一条命令/);
    expect(validateCustom({ ...ok, command: Array.from({ length: 65 }, (_, i) => `a${i}`).join(' ') }, []).command).toMatch(/最多 64/);
  });

  it('Runtime 以 AGENT_PROVIDER_EXISTS 拒绝时认得出来，别的冲突不算', () => {
    expect(isProviderExists(new RpcError('conflict', 'x', { code: 'AGENT_PROVIDER_EXISTS', driverId: 'goose' }))).toBe(true);
    expect(isProviderExists(new RpcError('conflict', 'x', { code: 'OTHER' }))).toBe(false);
    expect(isProviderExists(new RpcError('invalid-request', 'x', { code: 'AGENT_PROVIDER_EXISTS' }))).toBe(false);
    expect(isProviderExists(new Error('x'))).toBe(false);
  });

  it('环境变量写错时报行号', () => {
    expect(validateCustom({ ...ok, env: 'OK=1\nbad line' }, []).env).toMatch(/第 2 行/);
  });

  it('表单变成 agents.addProvider 的参数：去掉首尾空白，没有环境变量时不带 env', () => {
    expect(customRequest({ id: ' my-agent ', name: ' 我的 Agent ', command: 'my-agent --acp', env: '' })).toEqual({
      id: 'my-agent',
      name: '我的 Agent',
      command: ['my-agent', '--acp'],
    });
    expect(customRequest({ ...ok, env: 'TOKEN_FILE=~/a b' }).env).toEqual({ TOKEN_FILE: '~/a b' });
    expect(catalogRequest(catalog[1]!)).toEqual({
      id: 'auggie',
      name: 'Auggie CLI',
      command: ['npx', '-y', '@augmentcode/auggie@0.33.0', '--acp'],
      env: { AUGMENT_DISABLE_AUTO_UPDATE: '1' },
    });
    expect('env' in catalogRequest(catalog[0]!)).toBe(false);
  });
});

describe('启动方式', () => {
  it('npx / uvx 现取现用：记下带版本的包名与前提；其余为 null', () => {
    expect(launcherOf(catalog[0]!.command)).toBeNull();
    expect(launcherOf(catalog[1]!.command)).toEqual({ kind: 'npx', spec: '@augmentcode/auggie@0.33.0', needs: 'Node.js' });
    expect(launcherOf(catalog[2]!.command)).toEqual({ kind: 'uvx', spec: 'fast-agent-acp==0.9.22', needs: 'uv' });
    expect(launcherOf(['npx', '-y'])).toBeNull();
  });

  it('启动命令整行：环境变量在前；只有变量名时值写成 …；有空格的参数加引号', () => {
    expect(launchLine(catalog[1]!.command, catalog[1]!.env)).toBe('AUGMENT_DISABLE_AUTO_UPDATE=1 npx -y @augmentcode/auggie@0.33.0 --acp');
    expect(launchLine(['a', 'b c'])).toBe('a "b c"');
    expect(launchLine(['my-agent', '--acp'], ['TOKEN', 'LOG'])).toBe('TOKEN=… LOG=… my-agent --acp');
  });

  it('登录命令：npx / uvx 起它自己（不带 ACP 参数），其余起程序本身', () => {
    expect(customLoginCommand(catalog[1]!.command)).toBe('npx -y @augmentcode/auggie@0.33.0');
    expect(customLoginCommand(catalog[2]!.command)).toBe('uvx --from fast-agent-acp==0.9.22 fast-agent-acp');
    expect(customLoginCommand(catalog[0]!.command)).toBe('goose');
  });
});

describe('选择器里列谁', () => {
  const d = (id: string, state: 'ready' | 'not-installed' | 'signed-out', source: 'builtin' | 'custom' = 'builtin') => ({
    id,
    state,
    source,
  });

  it('检测到的都进；没检测到的只有常驻的内置几家进，「更多」四家与添加的不进', () => {
    expect(listedInPicker(d('claude', 'not-installed'))).toBe(true);
    expect(listedInPicker(d('copilot', 'not-installed'))).toBe(true);
    expect(listedInPicker(d('gemini', 'not-installed'))).toBe(false);
    expect(listedInPicker(d('gemini', 'ready'))).toBe(true);
    expect(listedInPicker(d('goose', 'not-installed', 'custom'))).toBe(false);
    expect(listedInPicker(d('goose', 'signed-out', 'custom'))).toBe(true);
    expect(isCustomDriver(d('goose', 'ready', 'custom'))).toBe(true);
    expect(isCustomDriver(d('claude', 'ready'))).toBe(false);
  });
});

describe('目录数据', () => {
  it('33 条，id 合规、不重复、不含内置；npx 条目钉住版本', () => {
    expect(ACP_CATALOG).toHaveLength(33);
    const ids = ACP_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of ACP_CATALOG) {
      expect(DRIVER_ID_PATTERN.test(e.id), e.id).toBe(true);
      expect(isBuiltinDriverId(e.id), e.id).toBe(false);
      expect(e.command.length, e.id).toBeGreaterThan(0);
      expect(e.description.length, e.id).toBeGreaterThan(0);
      expect(e.docs, e.id).toMatch(/^https:\/\//);
      const launcher = launcherOf(e.command);
      if (launcher?.kind === 'npx') expect(launcher.spec, e.id).toMatch(/.@\d/);
    }
    for (const id of MORE_BUILTIN_IDS) expect((BUILTIN_DRIVER_IDS as readonly string[]).includes(id)).toBe(true);
  });
});
