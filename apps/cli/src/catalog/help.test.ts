import { setLocale } from '@baocut/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CliError } from '../envelope.ts';
import { buildTree, commandOf, needsConfirmation, renderToolNames, summaryOf } from './command-tree.ts';
import { extractGlobals, parseToolArgs } from './flags.ts';
import { HELP_MAX_LINES, displayWidth, exampleCommand, renderCommandHelp, renderGroupHelp, renderMainHelp } from './help.ts';
import { loadSnapshot } from './snapshot.ts';
import { findTool, specOf } from './spec.ts';

const snapshot = loadSnapshot();
if (!snapshot) throw new Error('没有目录快照：先运行 npm run build:catalog');
const admin = [{ name: 'models', verbs: ['configure', 'accounts', 'usage', 'default', 'remove'] }, { name: 'settings' }, { name: 'web' }];

afterEach(() => {
  vi.unstubAllEnvs();
  setLocale('zh-Hans');
});

describe('帮助', () => {
  it.each(['zh-Hans', 'en'] as const)('一屏帮助不超过 40 行（%s）', (locale) => {
    vi.stubEnv('BAOCUT_LOCALE', locale);
    setLocale(locale);
    const text = renderMainHelp(snapshot.tools, admin);
    const lines = text.split('\n');
    expect(lines.length).toBeLessThanOrEqual(HELP_MAX_LINES);
    // 每个一级动词与名词组各占一行。
    const tree = buildTree(snapshot.tools);
    for (const verb of tree.verbs.keys()) expect(lines.some((line) => line.startsWith(`  ${verb} `))).toBe(true);
    for (const noun of tree.nouns.keys()) expect(lines.some((line) => line.startsWith(`  ${noun} `))).toBe(true);
    for (const line of lines.slice(2)) expect(displayWidth(line)).toBeLessThanOrEqual(120);
    expect(text).toContain('help <command>');
    expect(text).toContain('spec [<name>]');
  });

  it('每条命令的帮助都能派生，带参数、效果与示例', () => {
    const names = snapshot.tools.map((tool) => tool.name);
    for (const tool of snapshot.tools) {
      const command = commandOf(tool);
      const text = renderCommandHelp(command, names);
      expect(text.startsWith(`baocut ${command.display}`)).toBe(true);
      for (const field of Object.keys((tool.inputSchema.properties ?? {}) as object)) {
        expect(text).toContain(`--${field.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
      }
      if (tool.examples.length) expect(text).toContain(`baocut ${command.display}`);
    }
    const group = renderGroupHelp(snapshot.tools, 'models', admin[0]);
    expect(group).toContain('capabilities');
    expect(group).toContain('configure');
  });

  it('目录示例写成的命令行解析回同一组参数', async () => {
    for (const tool of snapshot.tools) {
      const command = commandOf(tool);
      for (const example of tool.examples) {
        const line = exampleCommand(command, example.args);
        // 要确认的命令的示例带 `--yes`：CLI 自己的旗标先取出来，与 `runCli` 一样。
        const { globals, rest: words } = extractGlobals(shellSplit(line).slice(1 + command.display.split(' ').length));
        expect(globals.yes, line).toBe(needsConfirmation(tool));
        const parsed = await parseToolArgs(command, words, globals, {
          cwd: '/',
          readFile: async () => {
            throw new Error('示例不读文件');
          },
          readStdin: async () => '',
        });
        expect(parsed, `${tool.name}: ${line}`).toEqual(example.args);
      }
    }
  });

  it('要确认的命令（videos delete、models install）：示例与通用旗标带 --yes', () => {
    const tree = buildTree(snapshot.tools);
    for (const display of [
      ['videos', 'delete'],
      ['models', 'install'],
    ]) {
      const command = tree.nouns.get(display[0]!)!.get(display[1]!)!;
      const text = renderCommandHelp(command);
      const examples = text.split('\n').filter((line) => line.startsWith(`  baocut ${command.display}`));
      expect(examples.length, command.display).toBeGreaterThan(0);
      for (const line of examples) expect(line).toMatch(/ --yes$/);
      expect(text).toMatch(/\n  --yes  /);
    }
    const wait = renderCommandHelp(tree.nouns.get('jobs')!.get('wait')!);
    expect(wait).toContain('--timeout <s>');
    expect(wait).not.toContain('--no-wait');
  });

  it('说明里的工具名写成命令；摘要取第一句', () => {
    const names = snapshot.tools.map((tool) => tool.name);
    expect(renderToolNames('先用 videos_inspect，再 edits_apply；transcribe 不动', names)).toBe(
      '先用 baocut videos inspect，再 baocut edits apply；transcribe 不动',
    );
    expect(renderToolNames('videos_import_package', names)).toBe('baocut videos import-package');
    expect(summaryOf('列出工作目录里的视频（含 video.db 的子目录）。第二句。')).toBe('列出工作目录里的视频（含 video.db 的子目录）。');
  });
});

describe('spec', () => {
  it('整个目录与一项都带接口版本，能当 JSON 解析', () => {
    const whole = JSON.parse(JSON.stringify(specOf(snapshot, snapshot.editOps, undefined))) as Record<string, unknown>;
    expect(whole.interfaceVersion).toBe(snapshot.interfaceVersion);
    expect(whole.tools).toHaveLength(snapshot.tools.length);
    for (const name of ['videos_inspect', 'videos.inspect', 'videos inspect']) {
      expect(specOf(snapshot, snapshot.editOps, name)).toMatchObject({
        interfaceVersion: snapshot.interfaceVersion,
        tool: { name: 'videos_inspect' },
      });
    }
    expect(findTool(snapshot.tools, 'videos.import-package')?.name).toBe('videos_import_package');
    expect(specOf(snapshot, snapshot.editOps, 'transcribe')).toMatchObject({ tool: { name: 'transcribe', effect: 'job' } });
  });

  it('edits.<操作> 给操作的 schema；不认识的名字是 INVALID_ARGUMENTS', () => {
    expect(specOf(snapshot, snapshot.editOps, 'edits.renameVideo')).toMatchObject({ operation: { type: 'renameVideo' } });
    expect(specOf(snapshot, snapshot.editOps, 'edits.apply')).toMatchObject({ tool: { name: 'edits_apply' } });
    expect(() => specOf(snapshot, snapshot.editOps, 'edits.nope')).toThrow(CliError);
    expect(() => specOf(snapshot, snapshot.editOps, 'nope')).toThrow(CliError);
  });
});

/** 按 POSIX shell 的单引号规则切词（`exampleCommand` 只用单引号）。 */
function shellSplit(line: string): string[] {
  const words: string[] = [];
  let word = '';
  let quoted = false;
  let started = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (quoted) {
      if (char === "'") quoted = false;
      else word += char;
    } else if (char === "'") {
      quoted = true;
      started = true;
    } else if (char === '\\' && line[i + 1] === "'") {
      word += "'";
      i++;
    } else if (char === ' ') {
      if (started) words.push(word);
      word = '';
      started = false;
    } else {
      word += char;
      started = true;
    }
  }
  if (started) words.push(word);
  return words;
}
