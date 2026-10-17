// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageModel } from '../../model/models-test-fixtures.ts';
import { BLANK_IMAGE, type ImageDraft, type ImageOption } from '../../model/tools-image.ts';
import { ImageRefsZone, imagePromptPlaceholder } from './image-refs.tsx';

const { host, toast } = vi.hoisted(() => ({
  host: {} as { pathForFile: (file: File) => string; pickFiles?: () => void; writeImageRef?: (data: Uint8Array) => Promise<string> },
  toast: { neutral: vi.fn(), negative: vi.fn(), positive: vi.fn() },
}));
vi.mock('../../runtime/context.tsx', () => ({ useRuntime: () => ({ host }) }));
vi.mock('@react-spectrum/s2', async (original) => ({ ...await original<typeof import('@react-spectrum/s2')>(), ToastQueue: toast }));

const refs = { max: 2, edit: true, maxBytesEach: null, maxBytesTotal: null };
const option = (patch: Parameters<typeof imageModel>[1] = {}) => ({ info: imageModel('qwen-image-2.1', { referenceImages: refs, img2img: null, ...patch }) }) as ImageOption;
const png = (name = 'image.png') => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], name, { type: 'image/png' });

let container: HTMLDivElement;
let root: Root;
let patch: ReturnType<typeof vi.fn<(p: Partial<ImageDraft>) => void>>;

async function mount(draft: ImageDraft, opt: ImageOption | null = option()) {
  await act(() =>
    root.render(createElement(ImageRefsZone, { draft, option: opt, patch, children: createElement('textarea', { 'aria-label': 'prompt' }) })),
  );
  return container.querySelector('textarea')!;
}

function fire(target: Element, type: 'paste' | 'drop' | 'dragenter', files: File[], types = files.length ? ['Files'] : ['text/plain']) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const data = { files, types, dropEffect: 'none', getData: () => 'text' };
  Object.defineProperty(event, type === 'paste' ? 'clipboardData' : 'dataTransfer', { value: data });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  for (const key of Object.keys(host)) delete (host as Record<string, unknown>)[key];
  host.pathForFile = () => '';
  host.pickFiles = vi.fn();
  host.writeImageRef = vi.fn(async () => '/tmp/baocut-image-refs/1.png');
  Object.values(toast).forEach((fn) => fn.mockReset());
  patch = vi.fn();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('把图片粘贴或拖进提示词框收成参考图', () => {
  it('粘贴截图：没有本机路径就交宿主写成临时文件，加进参考图', async () => {
    const box = await mount({ ...BLANK_IMAGE });
    const event = fire(box, 'paste', [png()]);
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(patch).toHaveBeenCalledWith({ refs: [{ path: '/tmp/baocut-image-refs/1.png', name: 'image.png' }] }));
    expect(host.writeImageRef).toHaveBeenCalledWith(expect.any(Uint8Array));
  });

  it('粘贴文字照常进提示词框，不拦', async () => {
    const box = await mount({ ...BLANK_IMAGE });
    const event = fire(box, 'paste', []);
    expect(event.defaultPrevented).toBe(false);
    expect(patch).not.toHaveBeenCalled();
  });

  it('拖进本机文件：直接用它的路径，不另写临时文件；不是图片的跳过并提示', async () => {
    host.pathForFile = (file) => `/Users/me/${file.name}`;
    const box = await mount({ ...BLANK_IMAGE });
    const idle = container.firstElementChild!.className;
    await act(() => {
      fire(box, 'dragenter', [png('a.png')]);
    });
    expect(container.firstElementChild!.className).not.toBe(idle);
    let event!: Event;
    await act(() => {
      event = fire(box, 'drop', [png('a.png'), new File(['x'], 'notes.txt', { type: 'text/plain' })]);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(container.firstElementChild!.className).toBe(idle);
    await vi.waitFor(() => expect(patch).toHaveBeenCalledWith({ refs: [{ path: '/Users/me/a.png', name: 'a.png' }] }));
    expect(host.writeImageRef).not.toHaveBeenCalled();
    expect(toast.neutral).toHaveBeenCalledWith(expect.stringContaining('1'), expect.anything());
  });

  it('超出上限的不加并提示；满了就不接拖放', async () => {
    const one = { path: '/a.png', name: 'a.png' };
    const box = await mount({ ...BLANK_IMAGE, refs: [one] });
    fire(box, 'paste', [png('b.png'), png('c.png')]);
    await vi.waitFor(() => expect(patch).toHaveBeenCalledWith({ refs: [one, { path: '/tmp/baocut-image-refs/1.png', name: 'b.png' }] }));
    expect(host.writeImageRef).toHaveBeenCalledTimes(1);
    expect(toast.neutral).toHaveBeenCalledTimes(1);

    patch.mockReset();
    const full = await mount({ ...BLANK_IMAGE, refs: [one, { path: '/b.png', name: 'b.png' }] });
    expect(fire(full, 'drop', [png()]).defaultPrevented).toBe(false);
    expect(patch).not.toHaveBeenCalled();
  });

  it('写临时文件失败：提示原因，别的照加', async () => {
    host.writeImageRef = vi.fn(async () => {
      throw new Error('the image is too large');
    });
    const box = await mount({ ...BLANK_IMAGE });
    fire(box, 'paste', [png()]);
    await vi.waitFor(() => expect(toast.negative).toHaveBeenCalledWith(expect.stringContaining('the image is too large'), expect.anything()));
    expect(patch).not.toHaveBeenCalled();
  });

  it('浏览器里拿不到本机路径：带图的粘贴只提示一句，拖放不接', async () => {
    delete host.pickFiles;
    delete host.writeImageRef;
    const box = await mount({ ...BLANK_IMAGE });
    expect(fire(box, 'paste', [png()]).defaultPrevented).toBe(true);
    expect(toast.neutral).toHaveBeenCalledTimes(1);
    expect(fire(box, 'drop', [png()]).defaultPrevented).toBe(false);
    expect(patch).not.toHaveBeenCalled();
  });

  it('模型不认参考图或还没有模型：粘贴、拖放都不拦', async () => {
    const box = await mount({ ...BLANK_IMAGE }, option({ referenceImages: null }));
    expect(fire(box, 'paste', [png()]).defaultPrevented).toBe(false);
    const bare = await mount({ ...BLANK_IMAGE }, null);
    expect(fire(bare, 'paste', [png()]).defaultPrevented).toBe(false);
    expect(fire(bare, 'drop', [png()]).defaultPrevented).toBe(false);
    expect(patch).not.toHaveBeenCalled();
  });

  it('按提示词改图时占位文字提醒写清怎么改', () => {
    const editing = option();
    expect(imagePromptPlaceholder({ ...BLANK_IMAGE, refs: [{ path: '/a.png', name: 'a.png' }] }, editing)).toMatch(/画完整/);
    expect(imagePromptPlaceholder({ ...BLANK_IMAGE }, editing)).toMatch(/描述你要的画面/);
    expect(imagePromptPlaceholder({ ...BLANK_IMAGE }, null)).toMatch(/描述你要的画面/);
  });
});
