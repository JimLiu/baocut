import { defineMessages } from '@baocut/protocol';
import { zhHans } from './import-copy.zh-Hans.ts';
import { zhHant } from './import-copy.zh-Hant.ts';
import { ja } from './import-copy.ja.ts';
import { ko } from './import-copy.ko.ts';
import { es } from './import-copy.es.ts';
import { fr } from './import-copy.fr.ts';
import { de } from './import-copy.de.ts';
import { nl } from './import-copy.nl.ts';
import { ptBR } from './import-copy.pt-BR.ts';
import { it } from './import-copy.it.ts';
import { ru } from './import-copy.ru.ts';
import { pl } from './import-copy.pl.ts';
import { tr } from './import-copy.tr.ts';
import { vi } from './import-copy.vi.ts';

/**
 * 导入 Claude Code / Codex 的本机会话（产品设计 §3.1「导入外部会话」，原型 agent-import.jsx）的文案：侧栏的两个入口、导入对话框，
 * 以及线程里「以上导入自 …」那一条。英文是键与类型的来源，译文在 `import-copy.<语言>.ts`。
 */
const en = {
  /** 侧栏项目段头「⋯」与项目行菜单里的入口。 */
  menuAll: 'Import Claude Code / Codex sessions…',
  menuProject: 'Import sessions from this folder…',
  menuProjectHint: 'Claude Code / Codex sessions in this folder',
  titleAll: 'Import Claude Code / Codex sessions',
  titleProject: (name: string) => `Import sessions from “${name}”`,
  sourceLabel: 'Import from',
  search: 'Search sessions',
  searchPlaceholder: 'Search first message or folder',
  /** 列表上面的一行：从哪读的；项目入口时只列那个目录的。 */
  whereClaude: '~/.claude/projects',
  whereCodex: 'Codex’s session list',
  readFrom: (where: string, folder: string | null) => `Read from ${where}${folder ? ` · only sessions in ${folder}` : ''}`,
  listLabel: 'Sessions on this computer',
  loading: 'Looking for sessions…',
  loadFailed: (error: string) => `Couldn’t list sessions: ${error}`,
  noSources: 'Claude Code or Codex wasn’t found on this computer. Once installed, their terminal sessions show up here.',
  noMatch: 'No sessions match',
  noneInFolder: 'No sessions found in this folder',
  none: 'No sessions found',
  /** 每行下面：目录 · 多久前 · 几轮；没有目录的；导入过的。 */
  turns: (n: number) => `${n} ${n === 1 ? 'turn' : 'turns'}`,
  noFolder: 'No folder',
  imported: 'Imported',
  /** 选中一条后写明落在哪。 */
  alreadyImported: (title: string) => `Already imported. Continue in “${title}”.`,
  intoProject: (name: string) => `Imports into project “${name}”.`,
  missing: 'This folder is gone, so the session can’t be imported: it has to continue in its original folder.',
  adopt: (folder: string, name: string) => `Add ${folder} as project “${name}”`,
  noAdopt: 'Otherwise it’s imported as a session without a project, still working in this folder.',
  /** 对话框底下的两行说明。 */
  noteDiverge:
    'The imported session continues the original one. If you keep using it in the terminal too, each side keeps its own history.',
  noteSettings:
    'BaoCut’s instructions and skills apply from the first turn after importing. Project-level settings the original session loaded (such as .claude/ in the project) aren’t loaded by BaoCut.',
  cancel: 'Cancel',
  import: 'Import',
  open: 'Open',
  doneProject: (name: string) => `Imported into project “${name}”`,
  doneLoose: 'Imported as a session without a project',
  failed: (error: string) => `Couldn’t import: ${error}`,
  /** 线程里导入的记录下面那一条：从哪家导入、什么时候；略去了更早的几轮时写明。 */
  importedFrom: (name: string, when: string) => `Imported from ${name} above · ${when}`,
  omitted: (n: number) => `${n} earlier ${n === 1 ? 'turn' : 'turns'} not copied`,
  /** 输入区 Agent 菜单里别的 Agent 不能选的原因（导入的会话固定是来源那一家）。 */
  locked: (agent: string) => `Imported sessions stay with ${agent}`,
};

export type ImportMessages = typeof en;

export const IMPORT_COPY = defineMessages(en, {
  'zh-Hans': zhHans,
  'zh-Hant': zhHant,
  ja,
  ko,
  es,
  fr,
  de,
  nl,
  'pt-BR': ptBR,
  it,
  ru,
  pl,
  tr,
  vi,
});
