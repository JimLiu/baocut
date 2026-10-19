import { defineMessages, type ProjectGitState } from '@baocut/protocol';
import { zhHans } from './projects-copy.zh-Hans.ts';
import { zhHant } from './projects-copy.zh-Hant.ts';
import { ja } from './projects-copy.ja.ts';
import { ko } from './projects-copy.ko.ts';
import { es } from './projects-copy.es.ts';
import { fr } from './projects-copy.fr.ts';
import { de } from './projects-copy.de.ts';
import { nl } from './projects-copy.nl.ts';
import { ptBR } from './projects-copy.pt-BR.ts';
import { it } from './projects-copy.it.ts';
import { ru } from './projects-copy.ru.ts';
import { pl } from './projects-copy.pl.ts';
import { tr } from './projects-copy.tr.ts';
import { vi } from './projects-copy.vi.ts';

/** 管理桶 `baocut projects git-status|git-init|git-allow` 的文案（英文是键与类型的来源，译文在 `projects-copy.<语言>.ts`）。 */
const en = {
  help: `Usage:
  baocut projects git-status [<project>]
                                   The project's git status: repository, branch, whether BaoCut can commit
                                   and why it's paused (commit with baocut projects git-commit)
  baocut projects git-init [<project>]
                                   Initialize git in the project folder (not in your home folder, a standard
                                   user folder or the root of a volume, and not inside another repository)
  baocut projects git-allow [<project>] [--yes]
                                   Show the local filters and includes in the repository's config, then allow
                                   them: BaoCut runs git commands that execute them only after that
  <project> is a project ID, name or folder; without it, the project that contains the current folder`,
  noProject: (cwd: string) => `No project contains ${cwd}. Pass a project ID, name or folder (baocut projects list)`,
  unknownProject: (text: string) => `No such project: ${text} (baocut projects list)`,
  ambiguousProject: (text: string) => `More than one project is named ${text}; pass its ID instead`,
  states: {
    ready: 'ready',
    paused: 'paused',
    'not-repo': 'not in a git repository',
    unavailable: 'git unavailable',
    error: 'error',
  } satisfies Record<ProjectGitState, string>,
  head: (name: string, id: string) => `Project ${name} (${id})`,
  state: (state: string) => `Git: ${state}`,
  branch: (branch: string) => `Branch: ${branch}`,
  detached: 'Branch: (detached HEAD)',
  version: (version: string) => `git version: ${version}`,
  repo: (root: string) => `Repository: ${root}`,
  autoCommit: (on: boolean) => `Auto-commit: ${on ? 'on' : 'off'}`,
  lastCommit: (commit: string, auto: boolean, at: string) => `Last commit: ${commit.slice(0, 12)} (${auto ? 'auto' : 'manual'}, ${at})`,
  lastError: (message: string) => `Last error: ${message}`,
  entriesHead: 'Local filters and includes:',
  entry: (key: string, value: string, file: string | null) => `  ${key} = ${value}${file ? `  (${file})` : ''}`,
  allowHint: 'Review them, then run baocut projects git-allow to allow them',
  initDone: (root: string) => `Initialized git in ${root}`,
  nothingToAllow: 'This repository has no local filters or includes waiting to be allowed',
  allowPrompt: 'Allow these entries? BaoCut will run git commands that execute them [y/N] ',
  notTtyAllow: 'Not in a terminal: review the entries with baocut projects git-status, then rerun with --yes',
  notAllowed: "Not allowed: BaoCut's git commits stay paused for this repository",
  allowed: 'Allowed: BaoCut commits to this repository again',
};

export type ProjectsMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
