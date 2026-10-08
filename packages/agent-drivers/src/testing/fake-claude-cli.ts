import fs from 'node:fs';
import path from 'node:path';
import type { FakeClaudeCliScenario } from './fake-claude.ts';

/**
 * 假 claude 的进程入口（见 `fake-claude.ts` 的 `createFakeClaudeCli`）。由 node 直接运行，只用 Node 自带的模块。
 * 只回答探测用到的 `--version` 与 `auth status`；会话不经过它（会话用注入的假 Query）。
 * 行为来自 `$FAKE_CLAUDE_DIR/scenario.json`，每次调用的参数记进 `$FAKE_CLAUDE_DIR/log.jsonl`。
 */

const dir = process.env.FAKE_CLAUDE_DIR;
if (!dir) {
  process.stderr.write('FAKE_CLAUDE_DIR 没有设置\n');
  process.exit(2);
}
const scenario = JSON.parse(fs.readFileSync(path.join(dir, 'scenario.json'), 'utf8')) as FakeClaudeCliScenario;
const args = process.argv.slice(2);
fs.appendFileSync(path.join(dir, 'log.jsonl'), `${JSON.stringify({ t: Date.now(), args })}\n`);

if (args[0] === '--version') {
  if (scenario.version === null) {
    process.stderr.write('boom\n');
    process.exit(1);
  }
  process.stdout.write(`${scenario.version} (Claude Code)\n`);
  process.exit(0);
}
if (args[0] === 'auth' && args[1] === 'status') {
  if (scenario.auth === null) {
    // 旧版本：没有这个子命令。
    process.stderr.write(`error: unknown command 'auth'\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(scenario.auth, null, 2)}\n`);
  // 与 2.1.284 一致：没登录时退出码 1，stdout 照样是 JSON。
  process.exit(scenario.auth.loggedIn ? 0 : 1);
}
process.stderr.write(`假 claude 不支持：${args.join(' ')}\n`);
process.exit(2);
