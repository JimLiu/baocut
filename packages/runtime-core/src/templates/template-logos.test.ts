import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditOperation, VideoRef } from '@baocut/protocol';
import { sourceRoot, templateLogoPreparer, type TemplateLogoOptions } from './template-logos.ts';

const logo = (id: string, src: unknown) => ({ id, kind: 'logo', box: { x: 2, y: 4, w: 20, h: 12 }, src, color: '#FFFFFF' });
const setTemplate = (...layers: unknown[]): EditOperation =>
  ({ type: 'setTemplate', sequenceId: 's1', template: { id: 't', name: '台标', layers } }) as EditOperation;

describe('模板台标的素材登记', () => {
  let dir: string;
  let project: string;
  let assets: Record<string, unknown>;
  const release = vi.fn(async () => {});

  const options = (): TemplateLogoOptions => ({
    videos: {
      mirror: () => ({ video: { assets } }) as never,
      ref: () =>
        ({
          videoId: 'v1',
          name: 'v',
          path: path.join(project, 'videos', 'a.bcv'),
          relPath: 'videos/a.bcv',
          source: { projectId: 'p1', conversationId: null },
        }) as VideoRef,
    },
    brand: {
      pinBrandLogos: (ids) => ({
        logos: new Map(
          ids
            .filter((id) => id !== 'gone')
            .map((id) => [
              id,
              {
                path: `/library/${id}.png`,
                name: id,
                provenance: { origin: 'library', source: { library: { library: 'brand', entryId: id } } },
              },
            ]),
        ),
        release,
      }),
    },
  });

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-template-logos-')));
    project = path.join(dir, 'project');
    await fs.mkdir(path.join(project, 'brand'), { recursive: true });
    await fs.writeFile(path.join(project, 'brand', 'logo.png'), 'png');
    await fs.writeFile(path.join(dir, 'outside.png'), 'png');
    await fs.symlink(path.join(dir, 'outside.png'), path.join(project, 'brand', 'escape.png'));
    assets = {};
    release.mockClear();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('来源目录是视频目录去掉相对路径的那段', () => {
    expect(sourceRoot({ path: '/p/videos/a.bcv', relPath: 'videos/a.bcv' } as VideoRef)).toBe(path.resolve('/p'));
    expect(sourceRoot({ path: '/p', relPath: '' } as VideoRef)).toBe(path.resolve('/p'));
    expect(sourceRoot(null)).toBeNull();
  });

  it('写模板时补上缺的台标导入：品牌库的拷进来，项目里的按路径链接；ref 不撞调用方的', async () => {
    const own: EditOperation = { type: 'importAsset', path: '/x.png', ref: 'baocut-template-logo-0' };
    const operations = [own, setTemplate(logo('l1', { brandLogo: 'b1' }), logo('l2', { file: 'brand/logo.png' }), logo('l3', 'text'))];
    const prepared = await templateLogoPreparer(options())('v1', operations);
    expect(prepared!.operations).toEqual([
      {
        type: 'importAsset',
        path: '/library/b1.png',
        name: 'b1',
        ref: 'baocut-template-logo-1',
        storage: 'managed',
        provenance: { origin: 'library', source: { library: { library: 'brand', entryId: 'b1' } } },
      },
      {
        type: 'importAsset',
        path: path.join(project, 'brand', 'logo.png'),
        name: 'logo.png',
        ref: 'baocut-template-logo-2',
        storage: 'linked',
        provenance: { origin: 'template-logo', source: { templateLogo: { file: 'brand/logo.png' } } },
      },
      ...operations,
    ]);
    // 品牌库的条目固定到事务写完。
    expect(release).not.toHaveBeenCalled();
    await prepared!.release!();
    expect(release).toHaveBeenCalledOnce();
  });

  it('库里没有的、链接到项目外的、不在了的与不是图片的不导入；都不用补时什么也不做', async () => {
    const operations = [
      setTemplate(
        logo('l1', { brandLogo: 'gone' }),
        logo('l2', { file: 'brand/escape.png' }),
        logo('l3', { file: 'brand/missing.png' }),
        logo('l4', { file: 'brand/notes.txt' }),
      ),
    ];
    expect(await templateLogoPreparer(options())('v1', operations)).toBeNull();
    expect(release).toHaveBeenCalledOnce();
  });

  it('视频里已经有的不再导入；不写模板、移除模板的不管', async () => {
    assets = {
      a1: {
        id: 'a1',
        kind: 'image',
        currentRevision: 'r1',
        revisions: { r1: { provenance: { origin: 'template-logo', source: { templateLogo: { file: 'brand/logo.png' } } } } },
      },
    };
    const prepare = templateLogoPreparer(options());
    expect(await prepare('v1', [setTemplate(logo('l1', { file: 'brand/logo.png' }))])).toBeNull();
    expect(await prepare('v1', [{ type: 'setTemplate', sequenceId: 's1', template: null }])).toBeNull();
    expect(await prepare('v1', [{ type: 'deleteItems', sequenceId: 's1', itemIds: ['i1'] } as EditOperation])).toBeNull();
  });
});
