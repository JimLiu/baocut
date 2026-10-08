import fs from 'node:fs';
import fsp from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { intlLocale } from '@baocut/protocol';
import { RcWeb } from '@baocut/protocol/messages/runtime-core';
import { mimeTypeOf, resolveInside } from '../media.ts';

/**
 * Web 服务的静态页面（架构设计 §4.8、§12.8）：Web 客户端的构建产物与未登录时的登录页，以及每个响应都带的安全头。
 */

/**
 * 找 Web 客户端的构建产物目录（里面有 `index.html`）：`BAOCUT_WEB_DIST` 环境变量；打包后的应用里是 `<resources>/web`；
 * 开发时从本模块往上找仓库里的 `apps/web/dist`。都没有时 null。
 */
export function resolveWebDist(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.BAOCUT_WEB_DIST) return env.BAOCUT_WEB_DIST;
  const resources = (process as { resourcesPath?: string }).resourcesPath;
  if (resources) {
    const bundled = path.join(resources, 'web');
    if (fs.existsSync(path.join(bundled, 'index.html'))) return bundled;
  }
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const built = path.join(dir, 'apps', 'web', 'dist');
    if (fs.existsSync(path.join(built, 'index.html'))) return built;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** 每个响应都带的头：不嗅探类型、不发 Referer、不能被嵌入、不与其他来源共享窗口与资源。 */
export function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
}

/**
 * Web 客户端页面的 CSP：只有自身来源。例外都是构建产物需要的，与桌面渲染进程一致：
 * `'wasm-unsafe-eval'` 编译预览的 WebAssembly（不放行 eval），`style-src 'unsafe-inline'` 给 React Spectrum 的内联样式，
 * 字体可以从 Typekit 取。连接只到这个服务自己的 WebSocket。
 */
export function appCsp(port: number): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "frame-src 'self' blob:",
    "font-src 'self' blob: data: https://use.typekit.net",
    `connect-src 'self' blob: ws://127.0.0.1:${port} ws://localhost:${port}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

const LOGIN_CSP =
  "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** 登录页（当前语言）。文案里的命令用 `<code>` 包起来，由这里拼好再作为参数交给文案。 */
function loginHtml(): string {
  const t = (message: { text: string }) => escapeHtml(message.text);
  const launch = '<code>baocut web open --launch</code>';
  const open = '<code>baocut web open</code>';
  return `<!doctype html>
<html lang="${escapeHtml(intlLocale())}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="referrer" content="no-referrer" />
    <title>BaoCut</title>
    <style>
      body { margin: 0; font: 15px/1.6 -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', sans-serif; background: #f5f5f4; color: #1c1917; }
      main { max-width: 520px; margin: 18vh auto 0; padding: 0 24px; }
      h1 { font-size: 22px; margin: 0 0 12px; }
      code { background: #e7e5e4; padding: 2px 6px; border-radius: 4px; }
      form { display: flex; gap: 8px; margin-top: 20px; }
      input { flex: 1; min-width: 0; font: inherit; font-family: ui-monospace, Menlo, monospace; padding: 6px 10px; border: 1px solid #a8a29e; border-radius: 6px; background: #fff; color: inherit; }
      button { font: inherit; padding: 6px 16px; border: 0; border-radius: 6px; background: #1c1917; color: #f5f5f4; cursor: pointer; }
      button:disabled { opacity: 0.5; cursor: default; }
      #status { margin-top: 16px; color: #57534e; min-height: 1.6em; }
      @media (prefers-color-scheme: dark) {
        body { background: #1c1917; color: #f5f5f4; } code { background: #292524; } #status { color: #a8a29e; }
        input { background: #292524; border-color: #57534e; } button { background: #f5f5f4; color: #1c1917; }
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${t(RcWeb.loginTitle())}</h1>
      <p>${loginInstructions(launch, open)}</p>
      <p>${t(RcWeb.loginCodeOnce())}</p>
      <form id="login" autocomplete="off">
        <input id="code" name="code" type="text" autocomplete="one-time-code" aria-label="${t(RcWeb.accessCode())}" placeholder="${t(RcWeb.accessCode())}" spellcheck="false" autocapitalize="off" required />
        <button id="submit" type="submit">${t(RcWeb.signIn())}</button>
      </form>
      <p id="status" role="status"></p>
    </main>
    <script src="/_auth/login.js"></script>
  </body>
</html>
`;
}

/** 说明里嵌着两段 HTML（`<code>…</code>`）：先用占位符取文字、转义，再换回 HTML。 */
function loginInstructions(launch: string, open: string): string {
  const text = escapeHtml(RcWeb.loginInstructions({ launch: '\u0000launch\u0000', open: '\u0000open\u0000' }).text);
  return text.replace('\u0000launch\u0000', launch).replace('\u0000open\u0000', open);
}

/**
 * 登录页的脚本：访问代码来自链接的 fragment（随即从地址栏去掉），或由用户粘进输入框（`baocut web open --launch`
 * 打开的是不带代码的地址，代码只打在终端里）；用它换会话 cookie，然后载入客户端。表单不提交（CSP 是 `form-action 'none'`），
 * 由脚本发请求。
 */
function loginJs(): string {
  const text = {
    signingIn: RcWeb.signingIn().text,
    rejected: RcWeb.codeRejected().text,
    unreachable: RcWeb.cannotReach().text,
    malformed: RcWeb.codeMalformed().text,
  };
  return `(() => {
  const TEXT = ${JSON.stringify(text)};
  const status = document.getElementById('status');
  const form = document.getElementById('login');
  const input = document.getElementById('code');
  const submit = document.getElementById('submit');
  const CODE = /^[A-Za-z0-9_-]{16,128}$/;
  const fromHash = /(?:^|&)code=([A-Za-z0-9_-]{16,128})(?:&|$)/.exec(location.hash.slice(1));
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);

  let busy = false;
  const exchange = (code) => {
    if (busy) return;
    busy = true;
    submit.disabled = true;
    status.textContent = TEXT.signingIn;
    fetch('/_auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then(
        (response) => {
          // Return to the access link path and query so the client opens the requested video.
          if (response.ok) return location.replace(location.pathname + location.search);
          status.textContent = TEXT.rejected;
        },
        () => {
          status.textContent = TEXT.unreachable;
        },
      )
      .finally(() => {
        busy = false;
        submit.disabled = false;
        input.value = '';
      });
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    // Also accept a whole access link: take the code out of it.
    const text = input.value.trim();
    const code = (/(?:#|&)code=([A-Za-z0-9_-]+)/.exec(text) || [null, text])[1];
    if (!CODE.test(code)) {
      status.textContent = TEXT.malformed;
      return;
    }
    exchange(code);
  });

  if (fromHash) exchange(fromHash[1]);
  else input.focus();
})();
`;
}

export function sendLoginPage(request: IncomingMessage, response: ServerResponse): void {
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': LOGIN_CSP,
    'Cache-Control': 'no-store',
  });
  response.end(request.method === 'HEAD' ? undefined : loginHtml());
}

export function sendLoginScript(request: IncomingMessage, response: ServerResponse): void {
  response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(request.method === 'HEAD' ? undefined : loginJs());
}

const STATIC_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  wasm: 'application/wasm',
  map: 'application/json; charset=utf-8',
  ico: 'image/x-icon',
  woff: 'font/woff',
};

function staticType(file: string): string {
  return STATIC_TYPES[path.extname(file).slice(1).toLowerCase()] ?? mimeTypeOf(file);
}

/** 构建产物里的一个文件。只能是目录里的普通文件（按真实路径）；没有时 404。HTML 带客户端的 CSP。 */
export async function sendStatic(
  dist: string,
  pathname: string,
  port: number,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  let relative: string;
  try {
    relative = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    response.writeHead(400).end();
    return;
  }
  if (relative === '') relative = 'index.html';
  // 不给隐藏文件与 `..`；其余由 resolveInside 按真实路径确认在目录之内。
  const hidden = relative.split(/[/\\]/).some((part) => part.startsWith('.'));
  const found = hidden ? null : await resolveInside(dist, relative).catch(() => null);
  if (!found) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end(RcWeb.fileNotFound().text);
    return;
  }
  const type = staticType(found.realPath);
  const html = type.startsWith('text/html');
  const body = request.method === 'HEAD' ? null : await fsp.readFile(found.realPath);
  response.writeHead(200, {
    'Content-Type': type,
    'Content-Length': found.size,
    'Cache-Control': html ? 'no-store' : 'private, no-cache',
    ...(html ? { 'Content-Security-Policy': appCsp(port) } : {}),
  });
  response.end(body ?? undefined);
}
