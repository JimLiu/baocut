import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LinkCookieBrowser } from '@baocut/protocol';
import { OpenMediaHttp } from '../open-media/open-media-http.ts';
import { OpenMediaTools } from './open-media-tools.ts';
import type { ToolPrincipal, ToolScope } from './tool-scope.ts';

/**
 * `assets_search` 的来源合并与 YouTube 的网站登录：媒体库用假的 fetch，YouTube 用一个假的 yt-dlp 脚本（按带不带
 * `--cookies-from-browser` 给结果或报要登录）。
 */

const agent = { kind: 'agent' } as unknown as ToolPrincipal;
const scope = {
  authorize: (principal: ToolPrincipal) => ({ principal }),
  saveRoot: () => os.tmpdir(),
} as unknown as ToolScope;

const COMMONS = {
  query: {
    pages: [
      {
        title: 'File:Rocket.webm',
        index: 1,
        imageinfo: [
          {
            url: 'https://upload.wikimedia.org/rocket.webm',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:Rocket.webm',
            mime: 'video/webm',
            mediatype: 'VIDEO',
            width: 1280,
            height: 720,
            extmetadata: { LicenseShortName: { value: 'CC0' } },
          },
        ],
      },
      {
        title: 'File:NoDerivs.webm',
        index: 2,
        imageinfo: [
          {
            url: 'https://upload.wikimedia.org/nd.webm',
            mime: 'video/webm',
            mediatype: 'VIDEO',
            width: 1,
            height: 1,
            extmetadata: { LicenseShortName: { value: 'CC BY-ND 4.0' } },
          },
        ],
      },
    ],
  },
};
const ARCHIVE = { response: { docs: [{ identifier: 'rocket_film', title: 'Rocket Film' }] } };
const YOUTUBE = { entries: [{ id: 'abcdefghijk', title: 'Rocket launch', channel: 'Space', duration: 30 }] };

const http = new OpenMediaHttp({
  fetch: (async (input: string | URL | Request) =>
    Response.json(String(input).startsWith('https://commons.wikimedia.org/') ? COMMONS : ARCHIVE)) as typeof fetch,
  backoffMs: () => 0,
});

let dir: string;
let ytDlp: string;
let argsLog: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-open-media-tools-'));
  ytDlp = path.join(dir, 'yt-dlp');
  argsLog = path.join(dir, 'args.log');
  // 带 firefox 的 Cookie 才给结果；其余（匿名、chrome）报 YouTube 的「确认不是机器人」。
  await fs.writeFile(
    ytDlp,
    `#!/bin/sh
echo "$@" >> "${argsLog}"
case "$*" in
  *"--cookies-from-browser firefox"*) cat <<'JSON'
${JSON.stringify(YOUTUBE)}
JSON
  exit 0 ;;
esac
echo "ERROR: [youtube:search_url] Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies for the authentication." >&2
exit 1
`,
    { mode: 0o755 },
  );
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function tools(browsers: LinkCookieBrowser[]) {
  return new OpenMediaTools({
    videos: {} as never,
    scope,
    offlineStrict: () => false,
    ffmpeg: () => 'ffmpeg',
    http,
    youtube: { tool: async () => ({ command: ytDlp }), cookieBrowsers: async () => browsers },
  });
}

type SearchResult = {
  candidates: Array<{ source: string; id: string; downloadWith: string; license: { class: string } }>;
  excluded: { noDerivativesOrUnknown: number };
  errors?: Array<{ source: string; code: string; settingsHref?: string }>;
  next: string;
};

describe('assets_search', () => {
  it('merges the three sources and drops no-derivatives library items', async () => {
    await fs.rm(argsLog, { force: true });
    const result = (await tools(['chrome', 'firefox']).dispatch('assets_search', { query: 'rocket launch' }, agent)) as SearchResult;
    expect(result.candidates.map((c) => [c.source, c.id, c.downloadWith])).toEqual([
      ['commons', 'File:Rocket.webm', 'assets_download'],
      ['archive', 'rocket_film', 'assets_download'],
      ['youtube', 'abcdefghijk', 'download'],
    ]);
    expect(result.candidates[2]!.license.class).toBe('unknown');
    expect(result.excluded.noDerivativesOrUnknown).toBe(1);
    expect(result.errors).toBeUndefined();
    // chrome 要登录，换 firefox 成功；用的是设置里的浏览器顺序。
    const runs = (await fs.readFile(argsLog, 'utf8')).trim().split('\n');
    expect(runs.map((line) => /--cookies-from-browser (\w+)/.exec(line)?.[1])).toEqual(['chrome', 'firefox']);
    expect(runs[0]).toContain('https://www.youtube.com/results?search_query=rocket+launch');
  });

  it('asks the agent to remind the user when YouTube needs cookies', async () => {
    const result = (await tools([]).dispatch('assets_search', { query: 'rocket launch' }, agent)) as SearchResult;
    expect(result.candidates.map((c) => c.source)).toEqual(['commons', 'archive']);
    expect(result.errors).toEqual([
      expect.objectContaining({ source: 'youtube', code: 'LINK_LOGIN_REQUIRED', settingsHref: expect.any(String) }),
    ]);
    expect(result.next).toContain('Tell the user: sign in to YouTube');
  });

  it('searches YouTube anonymously for outside services', async () => {
    await fs.rm(argsLog, { force: true });
    const service = { kind: 'service' } as unknown as ToolPrincipal;
    await expect(tools(['firefox']).dispatch('assets_search', { query: 'rocket', sources: ['youtube'] }, service)).rejects.toMatchObject({
      code: 'LINK_LOGIN_REQUIRED',
    });
    expect(await fs.readFile(argsLog, 'utf8')).not.toContain('--cookies-from-browser');
  });

  it('skips YouTube for images and filters Creative Commons on request', async () => {
    const images = (await tools(['firefox']).dispatch(
      'assets_search',
      { query: 'rocket', kind: 'image', sources: ['commons', 'youtube'] },
      agent,
    )) as SearchResult & {
      warnings?: string[];
    };
    expect(images.warnings).toEqual([expect.stringContaining('youtube only has videos')]);
    await fs.rm(argsLog, { force: true });
    const cc = (await tools(['firefox']).dispatch(
      'assets_search',
      { query: 'rocket', sources: ['youtube'], creativeCommons: true },
      agent,
    )) as SearchResult;
    expect(cc.candidates[0]!.license.class).toBe('cc-by');
    expect(await fs.readFile(argsLog, 'utf8')).toContain('sp=EgIwAQ%3D%3D');
  });
});

describe('assets_download to a folder (outDir)', () => {
  const PALACE = {
    query: {
      pages: [
        {
          title: 'File:Gyeongbokgung.jpg',
          imageinfo: [
            {
              url: 'https://upload.wikimedia.org/gyeongbokgung.jpg',
              descriptionurl: 'https://commons.wikimedia.org/wiki/File:Gyeongbokgung.jpg',
              mime: 'image/jpeg',
              mediatype: 'BITMAP',
              width: 800,
              height: 600,
              size: 4,
              extmetadata: { LicenseShortName: { value: 'CC0' }, Artist: { value: 'Jane Doe' } },
            },
          ],
        },
      ],
    },
  };
  const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const fileHttp = new OpenMediaHttp({
    fetch: (async (input: string | URL | Request) =>
      String(input).startsWith('https://upload.wikimedia.org/')
        ? new Response(BYTES, { headers: { 'content-length': String(BYTES.byteLength) } })
        : Response.json(PALACE)) as typeof fetch,
    backoffMs: () => 0,
  });
  const confirmed: Array<{ targets?: string[]; summary: string }> = [];
  const folderScope = {
    authorize: (principal: ToolPrincipal) => ({ principal }),
    // 与真实的范围相同：对外服务没有本机路径的基准。
    fileBase: (access: { principal: ToolPrincipal }) => {
      if (access.principal.kind === 'service') throw Object.assign(new Error('no local paths'), { code: 'INVALID_ARGUMENTS' });
      return dir;
    },
    confirm: async (_access: unknown, request: { targets?: string[]; summary: string }) => {
      confirmed.push(request);
      return { mode: 'auto', risk: 'command', decidedBy: 'auto' };
    },
  } as unknown as ToolScope;
  const folderTools = () =>
    new OpenMediaTools({ videos: {} as never, scope: folderScope, offlineStrict: () => false, ffmpeg: () => 'ffmpeg', http: fileHttp });
  const id = { source: 'commons', id: 'File:Gyeongbokgung.jpg', kind: 'image' };

  it('saves the file into the folder without importing; a second copy is numbered, never overwritten', async () => {
    type Saved = { path: string; license: { name: string }; attribution: string; file: { byteLength: number }; assetId?: unknown };
    const first = (await folderTools().dispatch('assets_download', { ...id, outDir: 'refs' }, agent)) as Saved;
    const second = (await folderTools().dispatch('assets_download', { ...id, outDir: path.join(dir, 'refs') }, agent)) as Saved;
    const real = await fs.realpath(path.join(dir, 'refs'));
    expect(first.path).toBe(path.join(real, 'Gyeongbokgung.jpg'));
    expect(second.path).toBe(path.join(real, 'Gyeongbokgung-2.jpg'));
    expect(new Uint8Array(await fs.readFile(first.path))).toEqual(BYTES);
    expect(first).toMatchObject({ license: { name: 'CC0' }, file: { byteLength: 4 } });
    expect(first.attribution).toContain('Jane Doe');
    expect(first).not.toHaveProperty('assetId');
    expect(confirmed[0]!.targets).toEqual([path.join(dir, 'refs', 'Gyeongbokgung.jpg')]);
    expect(confirmed[0]!.summary).toContain(path.join(dir, 'refs', 'Gyeongbokgung.jpg'));
  });

  it('needs exactly one of video and outDir; place goes with video only; outside services cannot pass outDir', async () => {
    const service = { kind: 'service' } as unknown as ToolPrincipal;
    const before = confirmed.length;
    for (const [args, principal] of [
      [id, agent],
      [{ ...id, video: 'demo', outDir: 'refs' }, agent],
      [{ ...id, outDir: 'refs', place: {} }, agent],
      [{ ...id, outDir: 'refs' }, service],
    ] as const) {
      await expect(folderTools().dispatch('assets_download', args, principal), JSON.stringify(args)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    }
    expect(confirmed.length).toBe(before);
  });
});
