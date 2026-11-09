import { describe, expect, it } from 'vitest';
import type { AgentSkillLocation, AgentSkillStatus, CliEntryStatus, Project } from '@baocut/protocol';
import {
  agentSkillOverview,
  cliEntryDir,
  cliEntryRow,
  compareVersions,
  isInstalled,
  locationAction,
  pathInDir,
  projectAt,
  projectChoices,
  removalDeletesFiles,
  tildePath,
  userHomeOf,
} from './agent-skill-install.ts';

const loc = (root: string | null, folder: AgentSkillLocation['folder'], extra: Partial<AgentSkillLocation> = {}): AgentSkillLocation => ({
  root,
  folder,
  path: `${root ?? '/Users/a'}/${folder}/baocut`,
  state: 'none',
  mode: null,
  version: null,
  linkTarget: null,
  ...extra,
});

const status = (locations: AgentSkillLocation[]): AgentSkillStatus => ({
  version: '1.2.0',
  source: '/Applications/BaoCut.app/Contents/Resources/agent-skill/baocut',
  bundled: true,
  appOutsideApplications: false,
  cli: { entry: null, onPath: null },
  locations,
  dirs: [...new Set(locations.map((l) => l.root).filter((r): r is string => r !== null))],
});

const project = (id: string, path: string, lastActiveAt: string, archived = false): Project => ({
  id,
  name: id,
  path,
  createdAt: '2026-01-01T00:00:00Z',
  lastActiveAt,
  pinned: false,
  archived,
});

describe('agentSkillOverview', () => {
  it('一处没装是 none；都是最新是 ok，并说出全局给了谁、几个目录', () => {
    expect(agentSkillOverview(status([loc(null, '.agents/skills'), loc(null, '.claude/skills')])).kind).toBe('none');
    const ov = agentSkillOverview(
      status([
        loc(null, '.agents/skills', { state: 'current', mode: 'link' }),
        loc(null, '.claude/skills'),
        loc('/w/a', '.claude/skills', { state: 'current', mode: 'copy' }),
        loc('/w/b', '.agents/skills', { state: 'current', mode: 'link' }),
      ]),
    );
    expect(ov).toMatchObject({ kind: 'ok', globalFolders: ['.agents/skills'], dirCount: 2, fixable: [] });
  });

  it('旧副本与失效的软链接都可以一键处理；最老的旧版本按数字比', () => {
    const ov = agentSkillOverview(
      status([
        loc(null, '.agents/skills', { state: 'stale', mode: 'copy', version: '1.10.0' }),
        loc(null, '.claude/skills', { state: 'stale', mode: 'copy', version: '1.9.0' }),
        loc('/w/a', '.agents/skills', { state: 'broken', mode: 'link' }),
      ]),
    );
    expect(ov.kind).toBe('update');
    expect(ov.fixable).toHaveLength(3);
    expect(ov.oldest).toBe('1.9.0');
    // 失效的不算「装着」：目录不计数。
    expect(ov.dirCount).toBe(0);
  });

  it('只剩别人的东西是 attention，不给一键处理', () => {
    const ov = agentSkillOverview(status([loc(null, '.agents/skills', { state: 'foreign' }), loc(null, '.claude/skills')]));
    expect(ov).toMatchObject({ kind: 'attention', fixable: [] });
    expect(ov.foreign).toHaveLength(1);
  });
});

describe('一处位置', () => {
  it('对症的按钮；移除只有副本会删真实文件', () => {
    expect(locationAction(loc(null, '.agents/skills'))).toBe('install');
    expect(locationAction(loc(null, '.agents/skills', { state: 'stale', mode: 'copy' }))).toBe('update');
    expect(locationAction(loc(null, '.agents/skills', { state: 'broken', mode: 'link' }))).toBe('repair');
    expect(locationAction(loc(null, '.agents/skills', { state: 'current', mode: 'link' }))).toBeNull();
    expect(locationAction(loc(null, '.agents/skills', { state: 'foreign' }))).toBeNull();
    expect(removalDeletesFiles(loc(null, '.agents/skills', { state: 'current', mode: 'copy' }))).toBe(true);
    expect(removalDeletesFiles(loc(null, '.agents/skills', { state: 'current', mode: 'link' }))).toBe(false);
    expect(isInstalled(loc(null, '.agents/skills', { state: 'broken', mode: 'link' }))).toBe(true);
    expect(isInstalled(loc(null, '.agents/skills', { state: 'foreign' }))).toBe(false);
  });
});

describe('安装到目录的候选', () => {
  it('没归档、目录还在的项目，最近在用的在前；已经装过的不再列', () => {
    const projects = [
      project('old', '/w/old', '2026-09-01T00:00:00Z'),
      project('new', '/w/new/', '2026-10-01T00:00:00Z'),
      project('gone', '/w/gone', '2026-10-10T00:00:00Z', true),
      project('done', '/w/done', '2026-10-12T00:00:00Z'),
      { ...project('moved', '/w/moved', '2026-10-20T00:00:00Z'), missing: true as const },
    ];
    expect(projectChoices(projects, ['/w/done']).map((p) => p.id)).toEqual(['new', 'old']);
    expect(projectAt(projects, '/w/new')?.id).toBe('new');
    expect(projectAt(projects, '/elsewhere')).toBeNull();
  });
});

describe('杂项', () => {
  it('版本按段比较', () => {
    expect(compareVersions('1.10.0', '1.9.3')).toBeGreaterThan(0);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
  });
  it('显示用的路径：主目录写成 ~，文件夹里的相对那个文件夹', () => {
    const st = status([loc(null, '.agents/skills'), loc('/w/a', '.claude/skills')]);
    const home = userHomeOf(st);
    expect(home).toBe('/Users/a');
    expect(tildePath('/Users/a/.agents/skills/baocut', home)).toBe('~/.agents/skills/baocut');
    expect(tildePath('/Users/ab/x', home)).toBe('/Users/ab/x');
    expect(tildePath('C:\\Users\\a\\x', 'C:\\Users\\a')).toBe('~\\x');
    expect(pathInDir(st.locations[1]!)).toBe('.claude/skills/baocut');
    expect(userHomeOf(status([]))).toBeNull();
  });
});

describe('命令行 baocut 那一行', () => {
  const app = '/Applications/BaoCut.app/Contents/MacOS/baocut-cli';
  const link = '/Users/a/.local/bin/baocut';
  const entry = (extra: Partial<CliEntryStatus> = {}): CliEntryStatus => ({
    entry: app,
    path: link,
    state: 'current',
    target: app,
    managed: true,
    shell: { found: link, dirOnPath: true },
    pathHint: null,
    ...extra,
  });
  const kind = (e: CliEntryStatus, onPath: AgentSkillStatus['cli']['onPath'] = null) => cliEntryRow(e, onPath);

  it('没装给「安装」；开发版没有入口不给按钮；终端已有指向本 App 的 baocut 时不催装', () => {
    expect(kind(entry({ state: 'none', target: null, managed: false }))).toEqual({ kind: 'none', action: 'install', removable: false, command: null });
    expect(kind(entry({ state: 'none', entry: null, target: null })).action).toBeNull();
    expect(kind(entry({ state: 'none', entry: null, target: null })).kind).toBe('unavailable');
    const cask = { path: '/opt/homebrew/bin/baocut', target: app, fromApp: true };
    expect(kind(entry({ state: 'none', target: null }), cask)).toMatchObject({ kind: 'elsewhere', action: null });
  });

  it('装好后：终端找得到、查不出、目录不在 PATH 上（给那一行）、先找到别的', () => {
    expect(kind(entry())).toMatchObject({ kind: 'ready', action: null, removable: true });
    expect(kind(entry({ shell: null })).kind).toBe('unchecked');
    const line = 'export PATH="$HOME/.local/bin:$PATH"';
    expect(kind(entry({ shell: { found: null, dirOnPath: false }, pathHint: { line, file: '~/.zshrc' } }))).toMatchObject({
      kind: 'not-on-path',
      command: line,
    });
    expect(kind(entry({ shell: { found: '/opt/homebrew/bin/baocut', dirOnPath: true } })).kind).toBe('shadowed');
  });

  it('指向别的 BaoCut 或失效给「修复」并能移除；不是 BaoCut 放的不给按钮、不能移除', () => {
    expect(kind(entry({ state: 'stale', target: '/Volumes/old/BaoCut.app/Contents/MacOS/baocut-cli' }))).toMatchObject({ action: 'repair', removable: true });
    expect(kind(entry({ state: 'broken' }))).toMatchObject({ kind: 'broken', action: 'repair', removable: true });
    expect(kind(entry({ state: 'foreign', target: null, managed: false }))).toEqual({ kind: 'foreign', action: null, removable: false, command: null });
    // 指向独立 CLI 包：由独立包管（baocut update），App 不修、不移除。
    const standalone = '/Users/a/.local/share/baocut/versions/3.17.0-build.93/BaoCut CLI.app/Contents/MacOS/baocut-cli';
    expect(kind(entry({ state: 'standalone', target: standalone, managed: false }))).toEqual({ kind: 'standalone', action: null, removable: false, command: null });
  });

  it('入口所在的目录', () => {
    expect(cliEntryDir(entry())).toBe('/Users/a/.local/bin');
    expect(cliEntryDir(entry({ path: 'C:\\Users\\a\\AppData\\Local\\BaoCut\\bin\\baocut.cmd' }))).toBe('C:\\Users\\a\\AppData\\Local\\BaoCut\\bin');
  });
});
