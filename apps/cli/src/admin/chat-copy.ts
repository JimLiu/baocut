import { defineMessages } from '@baocut/protocol';
import { zhHans } from './chat-copy.zh-Hans.ts';
import { zhHant } from './chat-copy.zh-Hant.ts';
import { ja } from './chat-copy.ja.ts';
import { ko } from './chat-copy.ko.ts';
import { es } from './chat-copy.es.ts';
import { fr } from './chat-copy.fr.ts';
import { de } from './chat-copy.de.ts';
import { nl } from './chat-copy.nl.ts';
import { ptBR } from './chat-copy.pt-BR.ts';
import { it } from './chat-copy.it.ts';
import { ru } from './chat-copy.ru.ts';
import { pl } from './chat-copy.pl.ts';
import { tr } from './chat-copy.tr.ts';
import { vi } from './chat-copy.vi.ts';

/** `baocut chat` 的文案（英文是键与类型的来源，译文在 `chat-copy.<语言>.ts`）。 */
const en = {
  /** `baocut chat --help` 与 `baocut help chat` 的正文。 */
  help: `Usage:
  baocut chat <message> [options]  Send a message and print the reply
    --project <dir>                Chat in this project directory (the project is identified
                                   by .bcut/project.json in the directory, written if missing)
    --conversation <id>            Continue an existing session
    --template <id>                Attach a scene template (a scene from baocut templates): the Runtime appends the
                                   briefing guide and the template body to the message; examples can't be attached;
                                   send an example's prompt (baocut templates show <id>) as the message instead
    --skill <id>                   Pick a skill (from baocut skills, even a disabled one):
                                   the Runtime appends its SKILL.md body to the message
    --mode <ask|auto-accept-edits|auto|full-access|plan>
                                   Switch this session's access mode (later actions follow it); if omitted, the session keeps its
                                   mode, or uses the agent.defaultAccessMode setting (default auto) if the mode was never switched
    --yes                          Approve approval requests automatically (this session only)`,
  missingMessage: 'Missing message text',
  templateIsExample: (title: string, id: string) =>
    `"${title}" is an example and can't be attached: get its prompt with baocut templates show ${id} and send it as the message`,
  sessionCreated: (id: string, cwd: string) => `Session ${id}  working folder ${cwd}`,
  disconnected: (reason: string) => `Lost the connection to the Runtime: ${reason}`,
  sessionDeleted: 'The session was deleted',
  stopping: 'Stopping…',
  chatTemplate: (id: string) => `Template: ${id}`,
  chatSkill: (id: string) => `Skill: ${id}`,
  chatMode: (mode: string) => `Access mode: ${mode}`,
  /** 会话任务结束：状态（`taskStatus` 或原样的状态值）与错误。 */
  taskEnded: (status: string, error: string | null) => `Task: ${status}${error ? ` — ${error}` : ''}`,
  taskStatus: { completed: 'Done', stopped: 'Stopped', failed: 'Failed' } as Readonly<Record<string, string>>,
  taskFailed: 'Task failed',
  toolCallFinished: (title: string, status: string, exitCode: number | null) =>
    `▸ ${title} — ${status}${exitCode !== null ? ` (exit code ${exitCode})` : ''}`,
  approvalNeeded: (what: string) => `Approval needed — ${what}`,
  approvalReason: (isTool: boolean, reason: string) => `${isTool ? 'Content' : 'Reason'}: ${reason}`,
  approvalMode: (mode: string) => `Current mode: ${mode}`,
  autoApproved: 'Approved automatically (--yes)',
  declinedNotTty: 'Not running in a terminal: declined (add --yes to approve automatically)',
  approvalQuestion: 'Approve? [y]es / [s]ession / [N]o ',
};

export type ChatMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
