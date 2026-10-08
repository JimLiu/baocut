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
  baocut skill install --agent <claude-code|codex|cursor|gemini> [--dir <folder>] [--link] [--yes]
                                   Install the BaoCut skill for external agents (how to use BaoCut) into baocut/
                                   in the host's skills folder: Claude Code ~/.claude/skills, Codex ~/.codex/skills,
                                   Cursor ~/.cursor/skills, Gemini CLI ~/.gemini/skills
    --dir <folder>                 Use another skills folder (installs into baocut/ under it); required without --agent
    --link                         Put the rendered skill in <BAOCUT_HOME>/agent-skills/baocut and a link to it in the
                                   host: installing again later (for any host) updates them all
    --yes                          Replace the target if it exists (for a link, only the link is replaced, not the
                                   folder it points to); without it nothing is overwritten
  baocut skill path                Where the BaoCut skill comes from, where each host installs it, and what's
                                   installed now (doesn't need the Runtime)`,
  targetExists: (target: string, linkTarget: string | null) =>
    `${target} already exists (${linkTarget !== null ? `a link to ${linkTarget}` : 'a folder or file'}); nothing changed. Add --yes to replace it`,
  installed: (target: string, files: number, linkTo: string | null) =>
    `Installed the BaoCut skill into ${target} (${files} ${files === 1 ? 'file' : 'files'}${linkTo ? `, linked to ${linkTo}` : ''})`,
  takesEffect: (host: string | null) => (host ? `Takes effect in a new ${host} session` : 'Takes effect in a new session'),
  pathEscapes: (path: string) => `A path in the BaoCut skill points outside its folder: ${path}`,
  sourceLine: (dir: string | null) =>
    `Source    ${dir ?? "not found (BaoCut isn't installed and this isn't the repository; you can set BAOCUT_AGENT_SKILLS_DIR)"}`,
  notInstalled: 'Not installed',
  linkState: (target: string) => `Link → ${target}`,
  installedFolder: 'Installed (folder)',
  isFile: 'A file (not a skill folder)',
};

export type SkillsMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
