import { defineMessages } from '@baocut/protocol';
import { zhHans } from './skills-copy.zh-Hans.ts';
import { zhHant } from './skills-copy.zh-Hant.ts';
import { ja } from './skills-copy.ja.ts';
import { ko } from './skills-copy.ko.ts';
import { es } from './skills-copy.es.ts';
import { fr } from './skills-copy.fr.ts';
import { de } from './skills-copy.de.ts';
import { nl } from './skills-copy.nl.ts';
import { ptBR } from './skills-copy.pt-BR.ts';
import { it } from './skills-copy.it.ts';
import { ru } from './skills-copy.ru.ts';
import { pl } from './skills-copy.pl.ts';
import { tr } from './skills-copy.tr.ts';
import { vi } from './skills-copy.vi.ts';

/**
 * 管理桶 `baocut skills …`（BaoCut 自己的 skill）与 `baocut skill …`（给外部 Agent 的说明书）的文案（英文是键与类型的来源，
 * 译文在 `skills-copy.<语言>.ts`）。
 */
const en = {
  skillsHelp: `Usage:
  baocut skills add <folder>       Copy a local skill folder (with SKILL.md at its root)
                                   into <BAOCUT_HOME>/skills, turned on by default
  baocut skills import <source>    Import a skill from GitHub: owner/repo, a repository URL, or
                                   …/tree/<branch>/<folder>; turned off by default, review it before turning it on
    --id <id>                      For add and import: use a different id (derived from the folder
                                   name by default; refused if the id exists, never overwritten)
  baocut skills enable|disable <id>
                                   Turn a skill on / off: takes effect from the next new agent session
  baocut skills remove <id>        Delete an added or imported skill (built-in ones can't be deleted, only turned off)`,
  added: 'Added',
  imported: 'Imported',
  turnedOn: 'Turned on',
  turnedOff: 'Turned off',
  reviewFirst: (id: string) => `Review it first (baocut skills read ${id}), then turn it on with baocut skills enable ${id}`,
  takesEffectNextSession: "Takes effect from the next new agent session; sessions already in progress aren't affected",
  removed: (id: string, path: string) => `Deleted ${id} (${path})`,
  localSource: (path: string, addedAt: string) => `local folder ${path} (${addedAt})`,
  remoteSource: (url: string, ref: string, commit: string, importedAt: string) => `${url} (${ref}@${commit}, ${importedAt})`,
  changed: (verb: string, id: string, name: string, enabled: boolean, path: string, source: string | null) =>
    `${verb} ${id} (${name}, ${enabled ? 'on' : 'off'}) → ${path}${source ? `\nSource: ${source}` : ''}`,
  idFormat: (flag: string, value: string) => `${flag} takes a skill id (lowercase, hyphen-separated, see baocut skills): ${value}`,

  skillHelp: `Usage:
  baocut skill install [--dir <folder>]… [--agent agents|claude] [--copy]
                                   Install the BaoCut skill for external agents (how to use BaoCut). By default into
                                   ~/.agents/skills/baocut (Codex and other agents) and ~/.claude/skills/baocut (Claude Code),
                                   as links to the skill inside the BaoCut app, so it updates with the app
    --dir <folder>                 Install into <folder>/.agents/skills and <folder>/.claude/skills instead: any folder,
                                   not only a BaoCut project; repeat it for several folders
    --agent agents|claude          Only one of the two: .agents/skills or .claude/skills
    --copy                         Copy it instead of linking (a copy doesn't follow app updates: install again to update)
  baocut skill status              The app's version of the skill, where it's installed and whether each is up to date,
                                   and the baocut command in your terminal
  baocut skill remove [--dir <folder>]… [--agent agents|claude] [--yes]
                                   Remove it: for a link only the link goes; deleting a copy needs --yes.
                                   Something at baocut/ that isn't the BaoCut skill is never replaced or deleted`,
  installedAt: (path: string, linkTarget: string | null) => `Installed ${path}${linkTarget ? ` → ${linkTarget}` : ' (copy)'}`,
  takesEffect: 'Takes effect in a new agent session',
  removedAt: (path: string) => `Removed ${path}`,
  removeCopies: (paths: readonly string[]) =>
    `${paths.join(', ')} ${paths.length === 1 ? 'is a copy' : 'are copies'}: removing deletes the files, including any edits made there. Add --yes to delete`,
  unknownAgent: (value: string) => `--agent takes agents (.agents/skills) or claude (.claude/skills): ${value}`,
  fixHint: 'Some installs are out of date or broken: baocut skill install (with the same --dir) fixes them',
  statusSkill: (version: string | null, source: string, bundled: boolean) =>
    `Skill     ${version ?? '?'}  ${source}${bundled ? '' : ' (development build: rendered by the Runtime)'}`,
  statusCli: (entry: string | null) => `CLI       ${entry ?? 'not bundled (development build)'}`,
  statusOnPath: (path: string, target: string | null, fromApp: boolean) =>
    `Terminal  ${path}${target ? ` → ${target}` : ''}${fromApp ? ' (this app)' : ' (not this app)'}`,
  statusNotOnPath: (command: string | null) =>
    `Terminal  baocut isn't on PATH${command ? `; to use it in any terminal: ${command}` : ''}`,
  statusAddToPath: (dir: string) => `Terminal  baocut isn't on PATH; to use it in any terminal, add ${dir} to your user PATH`,
  appOutsideApplications: "BaoCut isn't running from the Applications folder: links break if you move or delete the app",
  globalHeading: 'Global',
  state: {
    none: 'Not installed',
    current: 'Up to date',
    stale: 'Out of date',
    broken: 'Broken link',
    foreign: "Something else is there (left alone)",
  },
  mode: { link: 'Link', copy: 'Copy' },
};

export type SkillsMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
