/**
 * 测试用的假凭据助手：与 `credential-helper` 同一个协议（stdin 一行请求、stdout 一行响应），密钥存在临时目录的
 * `items.json` 里，绝不访问系统的钥匙串。
 *
 * 用法：`node fake-credential-helper.ts <目录>`。目录里：
 * - `items.json`：`{ "<key>": "<密钥>" }`；
 * - `control.json`（可选）：`{ fail?: { "<op>": "<错误码>" }, failKeys?: { "<key>": "<错误码>" }, mode?: "hang" | "silent" | "garbage" }`；
 * - `calls.jsonl`：每次调用追加一行 `{ argv, op, key, secretInEnv }`，测试据此检查密钥没有进命令行参数或环境变量。
 */
import fs from 'node:fs';
import path from 'node:path';

interface Control {
  fail?: Record<string, string>;
  failKeys?: Record<string, string>;
  mode?: 'hang' | 'silent' | 'garbage';
}

const dir = process.argv[2]!;
const itemsFile = path.join(dir, 'items.json');

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function respond(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  input += chunk;
});
process.stdin.on('end', () => {
  const control = readJson<Control>(path.join(dir, 'control.json'), {});
  const request = JSON.parse(input.split('\n', 1)[0]!) as { op: string; key: string; secret?: string };
  const secretInEnv = request.secret !== undefined && JSON.stringify(process.env).includes(request.secret);
  fs.appendFileSync(
    path.join(dir, 'calls.jsonl'),
    `${JSON.stringify({ argv: process.argv, op: request.op, key: request.key, secretInEnv })}\n`,
  );

  if (control.mode === 'hang') {
    setInterval(() => {}, 1_000);
    return;
  }
  if (control.mode === 'silent') process.exit(0);
  if (control.mode === 'garbage') {
    process.stdout.write('this is not json\n');
    return;
  }
  const failure = control.failKeys?.[request.key] ?? control.fail?.[request.op];
  if (failure) {
    // 故意在信息里带上密钥：调用方要把它去掉。
    respond({ ok: false, error: failure, message: `模拟的失败 ${request.secret ?? ''}`.trim() });
    return;
  }
  const items = readJson<Record<string, string>>(itemsFile, {});
  switch (request.op) {
    case 'get':
      if (request.key in items) respond({ ok: true, secret: items[request.key] });
      else respond({ ok: false, error: 'not-found', message: '没有这个条目' });
      return;
    case 'has':
      respond({ ok: true, exists: request.key in items });
      return;
    case 'set':
      items[request.key] = request.secret!;
      fs.writeFileSync(itemsFile, JSON.stringify(items));
      respond({ ok: true });
      return;
    case 'delete':
      if (!(request.key in items)) {
        respond({ ok: false, error: 'not-found', message: '没有这个条目' });
        return;
      }
      delete items[request.key];
      fs.writeFileSync(itemsFile, JSON.stringify(items));
      respond({ ok: true });
      return;
    default:
      respond({ ok: false, error: 'internal', message: '不认识的操作' });
  }
});
