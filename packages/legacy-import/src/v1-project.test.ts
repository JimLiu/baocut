import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planV1Project } from './v1-project.ts';
import { dryAssets, planContent, writeVideo } from './video-writer.ts';
import { EngineHost } from './engine-host.ts';

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'baocut-v1-import-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const fixture = () => {
  const source = path.join(root, 'source');
  mkdirSync(source);
  const pcm = Buffer.alloc(4 * 16000 * 4);
  writeFileSync(path.join(source, 'audio16k.pcm'), pcm);
  const doc = {
    clips: [
      { id: 'c1', src: 0, start: 0, end: 1 },
      { id: 'cut', src: 1, start: 1, end: 2, cut: true },
      { id: 'c2', src: 2, start: 2, end: 4 },
    ],
    words: [
      { id: 'w1', text: 'One.', t0: 0, t1: 0.7 },
      { id: 'w2', text: 'Two.', t0: 2, t1: 3 },
    ],
    trans: { zh: { w1: '一。', w2: '二。' } },
    paraBreaks: ['w1'],
    speakers: { s1: { name: 'A' } },
    subStyleMono: { fontSize: 35 },
    tracks: [
      { id: 'titles', kind: 'overlay', elements: [{ id: 'title', kind: 'text', text: 'Title', start: 2, end: 4, x: 50, y: 20, w: 80 }] },
    ],
  };
  writeFileSync(path.join(source, 'doc.json'), JSON.stringify(doc));
  return { source, doc };
};
const mediaAvailable = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const engine = process.env.BAOCUT_ENGINE_HOST ?? path.resolve(`target/debug/engine-host${process.platform === 'win32' ? '.exe' : ''}`);

describe.skipIf(!mediaAvailable)('v1 project conversion', () => {
  it('preserves words, cuts, translation, paragraph anchors and element geometry without changing source', () => {
    const { source, doc } = fixture();
    const plan = planV1Project(source, { title: 'Old project', lang: 'English' }, path.join(root, 'derived'));
    const content = planContent(plan, dryAssets(plan));
    const speech = content.documents.find((d) => d.kind === 'speech')!.body as any;
    expect(speech.words.map((w: any) => w.text)).toEqual(['One.', 'Two.']);
    expect(speech.paragraphBreaks).toEqual(['w2']);
    expect(content.documents.some((d) => d.kind === 'translation')).toBe(true);
    expect(content.items.find((i) => (i.item as any).text === 'Title')?.item).toMatchObject({ place: { x: 50, y: 20, w: 80 } });
    expect(content.cutSets).toHaveLength(1);
    expect(readFileSync(path.join(source, 'doc.json'), 'utf8')).toBe(JSON.stringify(doc));
    expect(existsSync(path.join(source, 'project.json'))).toBe(false);
    expect(plan.assets[0]?.path).toBe(path.join(root, 'derived', 'source.wav'));
  });
  it.skipIf(!existsSync(engine))(
    'writes v1 through the real engine twice and retains linked media and readable documents',
    async () => {
      const { source } = fixture();
      const output = path.join(root, 'output');
      mkdirSync(output);
      const host = new EngineHost(engine, 'ffprobe');
      try {
        await host.request('host.hello', {});
        for (let i = 0; i < 2; i++) {
          const plan = planV1Project(source, { title: 'Old project', lang: 'English' }, path.join(root, 'derived'));
          await writeVideo(host, plan, output, false);
          expect(plan.report.failed).toEqual([]);
          expect(plan.report.assets.missing).toEqual([]);
        }
        const { videoId, snapshot } = await host.request<any>('videos.open', { path: path.join(output, 'source') });
        const docs = Object.values(snapshot.documents) as any[];
        for (const doc of docs) {
          const { body } = await host.request<any>('documents.read', { videoId, documentId: doc.id });
          expect(body.schema).toMatch(/^baocut\./);
        }
        expect(docs.filter((d) => d.kind === 'translation')).toHaveLength(1);
        await host.request('videos.close', { videoId });
      } finally {
        host.close();
      }
    },
    30_000,
  );
});
