import readline from 'node:readline/promises';
import { applyConversationEvent } from '@baocut/client';
import { localizeText, newId, type ApprovalDecision, type ConversationSnapshot, type TimelineItem } from '@baocut/protocol';
import { CliError } from '../envelope.ts';
import { describeApprovalRequest, formatMode, parseModeOption } from './approvals-output.ts';
import { M } from './chat-copy.ts';
import { defineNoun } from './context.ts';
import { parseChatSkill } from './skills-output.ts';
import { parseChatTemplate } from './templates-output.ts';

/**
 * `baocut chat <消息>`：在会话里发一条消息，跟到这次任务结束。给人读时回复正文流到 stdout、工具调用与提示流到 stderr；
 * `--json` 时过程全部写 stderr，stdout 只有最后的信封（`{conversationId, taskId, status}`）。任务失败时退出码 1。
 * 审批：`--yes` 自动批准（仅当前会话）；终端里逐个问；不在终端里又没给 `--yes` 时拒绝并说明。
 */
export const chat = defineNoun({
  name: 'chat',
  get usage() {
    return M.help;
  },
  options: {
    project: { type: 'string' },
    conversation: { type: 'string' },
    template: { type: 'string' },
    skill: { type: 'string' },
    mode: { type: 'string' },
    yes: { type: 'boolean' },
  },
  async run(ctx) {
    const { client, values, output } = ctx;
    const text = ctx.args.join(' ').trim();
    if (!text) throw ctx.usageError(M.missingMessage);
    const mode = ctx.parse(() => parseModeOption(values.mode));
    const template = ctx.parse(() => parseChatTemplate(values.template));
    const skill = ctx.parse(() => parseChatSkill(values.skill));
    // 回复正文：给人读时写 stdout；`--json` 时 stdout 留给信封。
    const body = output.json ? output.stderr : output.stdout;

    // 先查模板，免得为一个挂不上的模板新建一个空会话（没有这个模板时 Runtime 报 TEMPLATE_NOT_FOUND）。
    if (template) {
      const { manifest } = (await client.request('templates.get', { id: template.id })).template;
      if (manifest.kind !== 'scene') {
        throw ctx.usageError(M.templateIsExample(manifest.title, manifest.id));
      }
    }
    let conversationId = values.conversation;
    if (!conversationId) {
      const projectId = values.project ? (await client.request('projects.open', { path: ctx.resolve(values.project) })).project.id : null;
      const { conversation } = await client.request('conversations.create', { projectId, commandId: newId('cmd') });
      conversationId = conversation.id;
      ctx.log(M.sessionCreated(conversation.id, conversation.cwd));
    }
    const id = conversationId;

    const rl = !values.yes && process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stderr }) : null;
    let mirror: ConversationSnapshot | null = null;
    let taskId: string | null = null;
    const printed = new Map<string, number>();
    const answered = new Set<string>();
    let done = false;

    const finished = new Promise<{ status: string; error: string | null }>((resolve, reject) => {
      client.onState((state) => {
        if (state.status === 'disconnected' || state.status === 'incompatible') {
          reject(new CliError('RUNTIME_UNAVAILABLE', M.disconnected(state.reason)));
        }
      });
      const render = () => {
        if (!mirror || !taskId || done) return;
        for (const item of mirror.items) {
          if (item.taskId !== taskId) continue;
          renderItem(item, printed, body, ctx.log.bind(ctx));
          if (item.kind === 'approval' && item.status === 'pending' && !answered.has(item.approvalId)) {
            answered.add(item.approvalId);
            void askApproval(item, rl, values.yes === true, ctx.log.bind(ctx)).then((decision) =>
              client.request('agents.respondToApproval', { conversationId: id, approvalId: item.approvalId, decision }),
            );
          }
          if (item.kind === 'task' && item.id === taskId && item.status !== 'running' && item.status !== 'stopping') {
            done = true;
            body.write('\n');
            resolve({ status: item.status, error: localizeText(item.error, item.errorRef) ?? null });
            return;
          }
        }
      };
      client.subscribeConversation(id, {
        snapshot: (snapshot) => {
          mirror = snapshot;
          render();
        },
        event: (event) => {
          if (!mirror) return;
          mirror = applyConversationEvent(mirror, event);
          if (!mirror) reject(new CliError('CONVERSATION_NOT_FOUND', M.sessionDeleted));
          else render();
        },
      });
    });

    process.once('SIGINT', () => {
      if (taskId) {
        ctx.log(`\n${M.stopping}`);
        void client.request('tasks.stop', { taskId });
      }
    });

    const sent = await client.request('conversations.send', {
      conversationId: id,
      text,
      commandId: newId('cmd'),
      ...(template ? { template } : {}),
      ...(skill ? { skill } : {}),
      ...(mode ? { accessMode: mode } : {}),
    });
    taskId = sent.taskId;
    if (template) ctx.log(M.chatTemplate(template.id));
    if (skill) ctx.log(M.chatSkill(skill.id));
    if (mode) ctx.log(M.chatMode(formatMode(mode)));
    try {
      const { status, error } = await finished;
      ctx.log(M.taskEnded(M.taskStatus[status] ?? status, error));
      if (status === 'failed') {
        return ctx.fail({ code: 'TASK_FAILED', message: error ?? M.taskFailed, conversationId: id, taskId });
      }
      return ctx.done({ conversationId: id, taskId, status }, []);
    } finally {
      rl?.close();
    }
  },
});

function renderItem(item: TimelineItem, printed: Map<string, number>, body: NodeJS.WritableStream, log: (line: string) => void): void {
  const seen = printed.get(item.id) ?? -1;
  switch (item.kind) {
    case 'agent-message': {
      if (seen < 0) body.write('\n');
      const from = Math.max(seen, 0);
      if (item.text.length > from) body.write(item.text.slice(from));
      printed.set(item.id, item.text.length);
      return;
    }
    case 'tool-call': {
      const key = item.status === 'running' ? 0 : 1;
      if (seen >= key) return;
      printed.set(item.id, key);
      if (key === 0) log(`\n▸ ${item.title}`);
      else log(`\n${M.toolCallFinished(item.title, item.status, item.exitCode)}`);
      return;
    }
    case 'notice':
      if (seen >= 0) return;
      printed.set(item.id, 0);
      log(`\n[${item.level}] ${localizeText(item.text, item.textRef)}`);
      return;
    default:
      return;
  }
}

async function askApproval(
  item: Extract<TimelineItem, { kind: 'approval' }>,
  rl: readline.Interface | null,
  yes: boolean,
  log: (line: string) => void,
): Promise<ApprovalDecision> {
  const what = describeApprovalRequest(item.request);
  const reason = item.request.reason ? `\n  ${M.approvalReason(item.request.kind === 'tool', item.request.reason)}` : '';
  const basis = item.mode ? `\n  ${M.approvalMode(formatMode(item.mode))}` : '';
  log(`\n${M.approvalNeeded(what)}${reason}${basis}`);
  if (yes) {
    log(`  ${M.autoApproved}`);
    return 'accept-for-session';
  }
  if (!rl) {
    log(`  ${M.declinedNotTty}`);
    return 'decline';
  }
  const answer = (await rl.question(`  ${M.approvalQuestion}`)).trim().toLowerCase();
  return answer === 'y' || answer === 'yes' ? 'accept' : answer === 's' ? 'accept-for-session' : 'decline';
}
