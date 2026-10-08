import type { ChatMessages } from './chat-copy.ts';

export const zhHans: ChatMessages = {
  help: `用法：
  baocut chat <消息> [选项]        发送一条消息并打印回复
    --project <目录>               在这个项目目录里对话（按目录里的 .bcut/project.json 认项目，没有时写入）
    --conversation <id>            继续一个已有会话
    --template <id>                挂上一个场景模板（baocut templates 里的 scene）：Runtime 在消息后附上简报引导与模板正文；
                                   作品示例（example）不能挂，把它的提示词（baocut templates show <id>）当消息直接发
    --skill <id>                   点选一个 skill（baocut skills 里的，关着的也行）：Runtime 在消息后附上它的 SKILL.md 正文
    --mode <ask|auto-accept-edits|auto|full-access|plan>
                                   切换这个会话的访问模式（之后的动作都按它）；不给时沿用会话的模式，
                                   会话没有切换过时用设置 agent.defaultAccessMode（默认 auto）
    --yes                          自动批准审批请求（仅当前会话）`,
  missingMessage: '缺少消息内容',
  templateIsExample: (title, id) => `「${title}」是作品示例，不能挂：用 baocut templates show ${id} 取出提示词，当消息直接发`,
  sessionCreated: (id, cwd) => `会话 ${id}  工作目录 ${cwd}`,
  disconnected: (reason) => `与 Runtime 的连接断开：${reason}`,
  sessionDeleted: '会话已被删除',
  stopping: '正在停止…',
  chatTemplate: (id) => `模板：${id}`,
  chatSkill: (id) => `skill：${id}`,
  chatMode: (mode) => `访问模式：${mode}`,
  taskEnded: (status, error) => `任务${status}${error ? `：${error}` : ''}`,
  taskStatus: { completed: '已完成', stopped: '已停止', failed: '失败' },
  taskFailed: '任务失败',
  toolCallFinished: (title, status, exitCode) => `▸ ${title} — ${status}${exitCode !== null ? `（退出码 ${exitCode}）` : ''}`,
  approvalNeeded: (what) => `需要批准 — ${what}`,
  approvalReason: (isTool, reason) => `${isTool ? '内容' : '原因'}：${reason}`,
  approvalMode: (mode) => `当前模式：${mode}`,
  autoApproved: '已自动批准（--yes）',
  declinedNotTty: '不在终端里运行：已拒绝（要自动批准加 --yes）',
  approvalQuestion: '批准？[y]es / [s]ession / [N]o ',
};
