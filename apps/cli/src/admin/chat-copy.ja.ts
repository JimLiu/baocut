import type { ChatMessages } from './chat-copy.ts';

export const ja: ChatMessages = {
  help: `使い方：
  baocut chat <message> [options]  メッセージを送信して返信を表示
    --project <dir>                このプロジェクトフォルダで会話（プロジェクトはフォルダ内の
                                   .bcut/project.json で識別。ない場合は書き込みます）
    --conversation <id>            既存のセッションを続ける
    --template <id>                シーンテンプレート（baocut templates の scene）を添付：Runtime がメッセージの後に
                                   ブリーフィングガイドとテンプレート本文を追加します。作例は添付できません。
                                   作例のプロンプト（baocut templates show <id>）をメッセージとして送ってください
    --skill <id>                   Skill を選択（baocut skills のもの。無効なものでも可）：
                                   Runtime がメッセージの後にその SKILL.md 本文を追加します
    --mode <ask|auto-accept-edits|auto|full-access|plan>
                                   このセッションのアクセスモードを切り替え（以後の操作はこれに従います）。省略すると
                                   セッションのモードを維持し、一度も切り替えていなければ設定 agent.defaultAccessMode
                                   （既定は auto）を使います
    --yes                          承認リクエストを自動で承認（このセッションのみ）`,
  missingMessage: 'メッセージの本文がありません',
  templateIsExample: (title, id) =>
    `「${title}」は作例なので添付できません：baocut templates show ${id} でプロンプトを取得し、メッセージとして送ってください`,
  sessionCreated: (id, cwd) => `セッション ${id}  作業フォルダ ${cwd}`,
  disconnected: (reason) => `Runtime との接続が切れました：${reason}`,
  sessionDeleted: 'セッションは削除されました',
  stopping: '停止中…',
  chatTemplate: (id) => `テンプレート：${id}`,
  chatSkill: (id) => `Skill：${id}`,
  chatMode: (mode) => `アクセスモード：${mode}`,
  taskEnded: (status, error) => `タスク：${status}${error ? `（${error}）` : ''}`,
  taskStatus: { completed: '完了', stopped: '停止済み', failed: '失敗' },
  taskFailed: 'タスクが失敗しました',
  toolCallFinished: (title, status, exitCode) => `▸ ${title}：${status}${exitCode !== null ? `（終了コード ${exitCode}）` : ''}`,
  approvalNeeded: (what) => `承認が必要です：${what}`,
  approvalReason: (isTool, reason) => `${isTool ? '内容' : '理由'}：${reason}`,
  approvalMode: (mode) => `現在のモード：${mode}`,
  autoApproved: '自動で承認しました（--yes）',
  declinedNotTty: 'ターミナルで実行されていないため拒否しました（自動で承認するには --yes を付けてください）',
  approvalQuestion: '承認しますか？[y]es / [s]ession / [N]o ',
};
