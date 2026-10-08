import type { ChatMessages } from './chat-copy.ts';

export const zhHant: ChatMessages = {
  help: `用法：
  baocut chat <message> [options]  傳送一則訊息並印出回覆
    --project <dir>                在這個專案資料夾中對話（以資料夾中的 .bcut/project.json 識別專案，
                                   沒有時會寫入）
    --conversation <id>            繼續一個現有的對話
    --template <id>                附加一個場景範本（baocut templates 中的場景）：Runtime 會在訊息後附上
                                   簡報指引與範本內文；範例無法附加，請改把範例的提示詞
                                   （baocut templates show <id>）當作訊息傳送
    --skill <id>                   選擇一個 Skill（baocut skills 中的，已停用的也可以）：
                                   Runtime 會在訊息後附上它的 SKILL.md 內文
    --mode <ask|auto-accept-edits|auto|full-access|plan>
                                   切換這個對話的存取模式（之後的動作都依此執行）；省略時沿用對話的模式，
                                   若從未切換過，則使用 agent.defaultAccessMode 設定（預設 auto）
    --yes                          自動核准所有核准請求（僅限這個對話）`,
  missingMessage: '缺少訊息內容',
  templateIsExample: (title, id) => `「${title}」是範例，無法附加：請用 baocut templates show ${id} 取得它的提示詞，再當作訊息傳送`,
  sessionCreated: (id, cwd) => `對話 ${id}  工作資料夾 ${cwd}`,
  disconnected: (reason) => `與 Runtime 的連線中斷：${reason}`,
  sessionDeleted: '對話已刪除',
  stopping: '正在停止…',
  chatTemplate: (id) => `範本：${id}`,
  chatSkill: (id) => `Skill：${id}`,
  chatMode: (mode) => `存取模式：${mode}`,
  taskEnded: (status, error) => `任務：${status}${error ? `——${error}` : ''}`,
  taskStatus: { completed: '已完成', stopped: '已停止', failed: '失敗' },
  taskFailed: '任務失敗',
  toolCallFinished: (title, status, exitCode) => `▸ ${title}——${status}${exitCode !== null ? `（結束代碼 ${exitCode}）` : ''}`,
  approvalNeeded: (what) => `需要核准：${what}`,
  approvalReason: (isTool, reason) => `${isTool ? '內容' : '原因'}：${reason}`,
  approvalMode: (mode) => `目前模式：${mode}`,
  autoApproved: '已自動核准（--yes）',
  declinedNotTty: '不是在終端機中執行：已拒絕（加上 --yes 可自動核准）',
  approvalQuestion: '要核准嗎？[y]es / [s]ession / [N]o ',
};
