import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { VideoSnapshot, SequenceItem, Track, TransactionReceipt } from '@baocut/protocol';
import { editorWasmAvailable } from '@baocut/editor-wasm';
import { OperationShapeError, digestReceipt, digestVideo, normalizeOperations } from './video-digest.ts';

describe('digestVideo', () => {
  const track = (id: string, order: number, kind: Track['kind']): Track => ({
    id,
    order,
    kind,
    locked: false,
    visible: true,
    muted: false,
    solo: { enabled: false, group: kind === 'audio' ? 'audio' : 'visual' },
  });
  const base = { enabled: true, locked: false, paintOrder: 0, followPolicy: { kind: 'sequence-fixed' as const } };
  const visual = { place: {} };
  const timeMap = { kind: 'linear' as const, sourceIn: { ticks: '1', timescale: 2 }, rate: { num: 1, den: 1 } };
  const revision = { revision: '1', contentHash: 'h', byteLength: 10, provenance: { origin: 'import' } };

  function video(items: SequenceItem[]): VideoSnapshot {
    return {
      format: 'baocut.video',
      schemaVersion: 3,
      timeContractVersion: 1,
      id: 'video_1',
      name: '测试',
      revision: '7',
      rootSequenceId: 'seq_1',
      sequences: {
        seq_1: {
          id: 'seq_1',
          revision: '7',
          name: '主序列',
          fps: { num: 30, den: 1 },
          canvas: { width: 1920, height: 1080, workingSpace: 'srgb', background: '#000000' },
          durationPolicy: { kind: 'derived' },
          tracks: [track('trk_v1', 0, 'visual'), track('trk_a1', 1, 'audio'), track('trk_s1', 2, 'subtitle')],
          items,
          animationBindings: [],
          transitions: [],
          markers: [],
          ducking: [],
        },
      },
      assets: {
        asset_v: {
          id: 'asset_v',
          kind: 'video',
          name: 'talk.mp4',
          currentRevision: '1',
          revisions: {
            '1': {
              ...revision,
              mediaType: 'video/mp4',
              storage: { mode: 'linked', locator: { path: '/Volumes/素材/talk.mp4' }, frozen: false },
              duration: { ticks: '10', timescale: 1 },
            },
          },
        },
        asset_b: {
          id: 'asset_b',
          kind: 'bundle',
          name: '片头',
          currentRevision: '1',
          revisions: { '1': { ...revision, mediaType: 'inode/directory', storage: { mode: 'managed' }, tree: { fileCount: 4 } } },
        },
      },
      documents: {
        doc_speech: {
          id: 'doc_speech',
          kind: 'speech',
          name: '转写',
          language: 'zh',
          sourceAssetId: 'asset_v',
          currentRevision: '2',
          revisions: {
            '1': { revision: '1', contentHash: 'a', byteLength: 100, createdAt: '2026-01-01T00:00:00Z', createdBy: 'tx_1' },
            '2': {
              revision: '2',
              contentHash: 'b',
              byteLength: 120,
              createdAt: '2026-01-02T00:00:00Z',
              createdBy: 'tx_2',
              summary: { words: 42 },
            },
          },
        },
        doc_style: { id: 'doc_style', kind: 'caption-style', name: '样式', currentRevision: '1', revisions: {} },
      },
      fonts: {},
      localizationSets: {},
      canvasVariants: {},
      syncGroups: {},
      protections: {},
      checkpoints: {},
      links: [],
    };
  }

  it('图文、计时读数、合成与字幕实例进摘要：各带自己的内容，没有素材的不写 asset', () => {
    const digest = digestVideo(
      video([
        {
          ...base,
          ...visual,
          id: 'item_t',
          trackId: 'trk_v1',
          type: 'text',
          span: { fromFrame: 0, durationFrames: 30 },
          text: '字'.repeat(200),
          style: {},
          role: 'title',
        },
        {
          ...base,
          ...visual,
          id: 'item_s',
          trackId: 'trk_v1',
          type: 'shape',
          span: { fromFrame: 30, durationFrames: 30 },
          shape: { shape: 'rect' },
        },
        {
          ...base,
          ...visual,
          id: 'item_k',
          trackId: 'trk_v1',
          type: 'composition',
          span: { fromFrame: 60, durationFrames: 30 },
          source: { kind: 'bundle', assetRef: { id: 'asset_b', revision: '1' } },
          parameterValues: { title: '很长的参数' },
          timeMap,
          prerender: { id: 'asset_v', revision: '1' },
        },
        {
          ...base,
          ...visual,
          id: 'item_g',
          trackId: 'trk_v1',
          type: 'composition',
          span: { fromFrame: 90, durationFrames: 30 },
          source: { kind: 'bundle', assetRef: { id: 'asset_b', revision: '1' } },
          parameterValues: {},
          timeMap,
          place: { x: 80, y: 20, w: 30 },
        },
        {
          ...base,
          ...visual,
          id: 'item_n',
          trackId: 'trk_v1',
          type: 'text',
          span: { fromFrame: 120, durationFrames: 30 },
          counter: { mode: 'countdown', format: 'mm:ss' },
        },
        {
          ...base,
          id: 'item_c',
          trackId: 'trk_s1',
          type: 'caption',
          span: { fromFrame: 0, durationFrames: 120 },
          documentId: 'doc_speech',
          styleDocumentId: 'doc_style',
          scopeItemIds: ['item_k'],
        },
      ]),
      '片子',
      [],
    );
    const item = (id: string) => digest.items.find((i) => i.id === id);

    expect(item('item_t')).toMatchObject({ type: 'text', role: 'title', startFrame: 0, durationFrames: 30, text: `${'字'.repeat(120)}…` });
    expect(item('item_t')).not.toHaveProperty('asset');
    expect(item('item_t')).not.toHaveProperty('place');
    expect(item('item_n')).toMatchObject({ type: 'text', counter: { mode: 'countdown', format: 'mm:ss' } });
    expect(item('item_n')).not.toHaveProperty('text');
    expect(item('item_s')).toMatchObject({ type: 'shape', startSeconds: 1, endSeconds: 2 });
    expect(item('item_s')).not.toHaveProperty('shape');
    expect(item('item_k')).toMatchObject({
      type: 'composition',
      asset: { id: 'asset_b', name: '片头' },
      prerender: { id: 'asset_v', name: 'talk.mp4' },
      sourceInSeconds: 0.5,
      place: { mode: 'fullscreen' },
    });
    expect(item('item_k')).not.toHaveProperty('parameterValues');
    // 写了位置与宽的合成按画中画摆；没有替身的不写 prerender。
    expect(item('item_g')).toMatchObject({ asset: { id: 'asset_b' }, place: { mode: 'pip', x: 80, y: 20, w: 30 } });
    expect(item('item_g')).not.toHaveProperty('prerender');
    expect(item('item_c')).toMatchObject({
      type: 'caption',
      trackId: 'trk_s1',
      document: { id: 'doc_speech', name: '转写' },
      styleDocumentId: 'doc_style',
      scopeItemIds: ['item_k'],
      durationFrames: 120,
    });

    expect(digest.tracks.find((t) => t.id === 'trk_s1')).toMatchObject({ kind: 'subtitle', items: 1 });
    expect(digest.sequence.durationFrames).toBe(150);
    expect(digest.assets).toEqual([
      { id: 'asset_v', name: 'talk.mp4', kind: 'video', durationSeconds: 10, size: null, hasAudio: false, storage: 'linked', usedBy: 1 },
      {
        id: 'asset_b',
        name: '片头',
        kind: 'bundle',
        durationSeconds: null,
        size: null,
        hasAudio: false,
        storage: 'managed',
        files: 4,
        usedBy: 2,
      },
    ]);
  });

  it('转场、章节、闪避规则，以及片段的摆法、声音、效果与裁剪', () => {
    const clip = (id: string, fromFrame: number): SequenceItem => ({
      ...base,
      ...visual,
      id,
      trackId: 'trk_v1',
      type: 'video',
      span: { fromFrame, durationFrames: 60 },
      assetRef: { id: 'asset_v', revision: '1' },
      timeMap,
      mode: 'fullscreen',
      fit: 'contain',
      embeddedAudio: { enabled: true, volume: 1 },
    });
    const left = clip('item_a', 0);
    const right = {
      ...clip('item_b', 60),
      mode: 'pip',
      place: { x: 75, y: 25, w: 40, rot: 15, opacity: 0.8, flipX: true },
      embeddedAudio: { enabled: true, volume: 0.5, fadeIn: { ticks: '1', timescale: 4 } },
      crop: { left: 0.1, top: 0, right: 0.1, bottom: 0 },
      fx: { saturation: -0.5, blur: 4 },
    } as SequenceItem;
    const music: SequenceItem = {
      ...base,
      id: 'item_m',
      trackId: 'trk_a1',
      type: 'audio',
      assetRef: { id: 'asset_v', revision: '1' },
      fromFrame: 0,
      subframeOffset: { ticks: '0', timescale: 1 },
      playDuration: { ticks: '4', timescale: 1 },
      timeMap,
      mix: { volume: 0.25, muted: true },
    };
    const snapshot = video([left, right, music]);
    const seq = snapshot.sequences.seq_1!;
    seq.transitions = [
      {
        id: 'tr_1',
        leftItemId: 'item_a',
        rightItemId: 'item_b',
        kind: 'wipe',
        params: { direction: 'left' },
        durationFrames: 15,
        easing: 'ease-in-out',
        placement: 'center',
        audioCrossfade: true,
      },
    ];
    seq.markers = [
      { id: 'chap_1', frame: 0, label: '开场', kind: 'chapter' },
      { id: 'note_1', frame: 10, label: '备注', kind: 'note' },
      { id: 'chap_2', frame: 45, label: '正题', kind: 'chapter', summary: '讲重点', thumbnail: { id: 'asset_v', revision: '1' } },
    ];
    seq.ducking = [
      {
        id: 'duck_1',
        enabled: true,
        trigger: { kind: 'items', trackIds: ['trk_v1'] },
        target: { trackIds: [], itemIds: ['item_m'] },
        depth: 12,
        attack: { ticks: '1', timescale: 50 },
        release: { ticks: '7', timescale: 20 },
      },
      {
        id: 'duck_2',
        enabled: false,
        trigger: { kind: 'speech' },
        target: { trackIds: ['trk_a1'] },
        depth: 10,
        attack: { ticks: '1', timescale: 50 },
        release: { ticks: '7', timescale: 20 },
      },
    ];
    const digest = digestVideo(snapshot, '片子', []);
    expect(digest.transitions).toEqual([
      {
        id: 'tr_1',
        kind: 'wipe',
        params: { direction: 'left' },
        leftItemId: 'item_a',
        rightItemId: 'item_b',
        durationSeconds: 0.5,
        durationFrames: 15,
        easing: 'ease-in-out',
        placement: 'center',
        audioCrossfade: true,
      },
    ]);
    expect(digest.chapters).toEqual([
      { id: 'chap_1', title: '开场', atSeconds: 0, atFrame: 0 },
      { id: 'chap_2', title: '正题', atSeconds: 1.5, atFrame: 45, summary: '讲重点', thumbnailAssetId: 'asset_v' },
    ]);
    expect(digest.ducking).toEqual([
      {
        id: 'duck_1',
        enabled: true,
        trigger: { kind: 'items', trackIds: ['trk_v1'] },
        target: { itemIds: ['item_m'] },
        depth: 12,
        attackSeconds: 0.02,
        releaseSeconds: 0.35,
      },
      {
        id: 'duck_2',
        enabled: false,
        trigger: { kind: 'speech' },
        target: { trackIds: ['trk_a1'] },
        depth: 10,
        attackSeconds: 0.02,
        releaseSeconds: 0.35,
      },
    ]);
    const item = (id: string) => digest.items.find((i) => i.id === id);
    // 铺满画布：只写 mode，位置与宽不参与。
    expect(item('item_a')).toMatchObject({ place: { mode: 'fullscreen' }, embeddedAudio: { enabled: true, volume: 1 } });
    expect(item('item_a')).not.toHaveProperty('fx');
    expect(item('item_b')).toMatchObject({
      place: { mode: 'pip', x: 75, y: 25, w: 40, rot: 15, flipX: true, opacity: 0.8 },
      embeddedAudio: { enabled: true, volume: 0.5, fadeInSeconds: 0.25 },
      crop: { left: 0.1, top: 0, right: 0.1, bottom: 0 },
      fx: ['saturation', 'blur'],
    });
    expect(item('item_m')).toMatchObject({ type: 'audio', volume: 0.25, muted: true });
    expect(item('item_m')).not.toHaveProperty('place');
  });

  it('回执带上被引擎删掉的转场与变短的单侧转场', () => {
    const receipt = {
      transactionId: 'tx_1',
      commandId: 'cmd_1',
      status: 'committed',
      videoId: 'video_1',
      previousRevision: '1',
      videoRevision: '2',
      eventSeq: '2',
      label: '删除片段',
      actor: { kind: 'agent', id: 'a' },
      createdIds: [],
      updatedIds: [],
      deletedIds: ['item_a', 'tr_1'],
      lineage: {},
      impact: {
        oldDurationFrames: 60,
        newDurationFrames: 60,
        translationUnitsStale: [],
        dubbingUnitsStale: [],
        orphanedAnchors: [],
        removedTransitions: [{ id: 'tr_1', reason: 'item-deleted' }],
        shortenedTransitions: [{ id: 'tr_2', durationFrames: 15, effectiveFrames: 10 }],
      },
      timeResolution: [],
      preserved: [],
      undo: { available: true },
      committedAt: '2026-01-01T00:00:00Z',
    } satisfies TransactionReceipt;
    const digest = digestReceipt(receipt, { num: 30, den: 1 }, false);
    expect(digest.removedTransitions).toEqual([{ id: 'tr_1', reason: 'item-deleted' }]);
    expect(digest.shortenedTransitions).toEqual([{ id: 'tr_2', durationFrames: 15, effectiveFrames: 10 }]);
    const quiet = { ...receipt, impact: { ...receipt.impact, removedTransitions: undefined, shortenedTransitions: undefined } };
    expect(digestReceipt(quiet, { num: 30, den: 1 }, false)).not.toHaveProperty('removedTransitions');
    expect(digestReceipt(quiet, { num: 30, den: 1 }, false)).not.toHaveProperty('shortenedTransitions');
    expect(digestReceipt(quiet, { num: 30, den: 1 }, false)).not.toHaveProperty('orphanedAnchors');
    const followed = { ...receipt, impact: { ...receipt.impact, orphanedAnchors: ['item_t'], removedWithTarget: ['item_f'] } };
    expect(digestReceipt(followed, { num: 30, den: 1 }, false)).toMatchObject({
      orphanedAnchors: ['item_t'],
      removedWithTarget: ['item_f'],
    });
  });

  it('文档只列文档头：当前版本与概要，不含正文', () => {
    const digest = digestVideo(
      video([
        { ...base, id: 'item_c', trackId: 'trk_s1', type: 'caption', span: { fromFrame: 0, durationFrames: 30 }, documentId: 'doc_speech' },
      ]),
      '片子',
      [],
    );
    expect(digest.documents).toEqual([
      { id: 'doc_style', kind: 'caption-style', name: '样式', language: null, revision: '1', usedBy: 0 },
      {
        id: 'doc_speech',
        kind: 'speech',
        name: '转写',
        language: 'zh',
        revision: '2',
        sourceAssetId: 'asset_v',
        summary: { words: 42 },
        usedBy: 1,
      },
    ]);
  });

  it('从链接导入的素材带来源平台的元数据：简介截到 1200 个字符，作者章节结构化的优先，没有时从简介解析', () => {
    const snapshot = video([]);
    const talk = snapshot.assets.asset_v!;
    const linked = (source: Record<string, unknown>) => ({
      ...talk,
      revisions: { '1': { ...talk.revisions['1']!, provenance: { origin: 'link-import', source } } },
    });
    const long = `${'简'.repeat(1300)}`;
    snapshot.assets.asset_v = linked({
      url: 'https://video.example.com/watch?v=abc',
      webpageUrl: 'https://video.example.com/watch?v=abc',
      platform: 'Youtube',
      title: 'Talk',
      uploader: 'Someone',
      uploadDate: '20260102',
      description: long,
      chapters: [
        { start: 0, end: 4, title: 'Intro' },
        { start: 4, title: 'Body' },
      ],
    });
    const [first] = digestVideo(snapshot, '片子', []).assets;
    expect(first).toMatchObject({
      id: 'asset_v',
      source: {
        platform: 'Youtube',
        webpageUrl: 'https://video.example.com/watch?v=abc',
        uploader: 'Someone',
        uploadDate: '20260102',
        title: 'Talk',
        descriptionTruncated: true,
        chapters: [
          { at: 0, title: 'Intro' },
          { at: 4, title: 'Body' },
        ],
      },
    });
    expect([...(first as { source: { description: string } }).source.description]).toHaveLength(1200);

    snapshot.assets.asset_v = linked({ title: 'Talk', description: 'Outline:\n0:00 Opening\n0:05 Closing' });
    expect(digestVideo(snapshot, '片子', []).assets[0]).toMatchObject({
      source: {
        platform: null,
        description: 'Outline:\n0:00 Opening\n0:05 Closing',
        descriptionTruncated: false,
        chapters: editorWasmAvailable()
          ? [
              { at: 0, title: 'Opening' },
              { at: 5, title: 'Closing' },
            ]
          : [],
      },
    });

    snapshot.assets.asset_v = linked({ title: 'Talk' });
    expect(digestVideo(snapshot, '片子', []).assets[0]).toMatchObject({ source: { description: null, chapters: [] } });
    // 本机导入的素材没有这一块。
    snapshot.assets.asset_v = talk;
    expect(digestVideo(snapshot, '片子', []).assets[0]).not.toHaveProperty('source');
  });
});

describe('normalizeOperations', () => {
  const cwd = '/work/project';

  it('补根序列与对齐方式，时间换成秒', () => {
    const [add, move, moves] = normalizeOperations(
      [
        { type: 'addItem', asset: 'asset_1', at: 1.5 },
        { type: 'moveItem', itemId: 'item_1', offset: '-0.25s' },
        { type: 'moveItems', moves: [{ itemId: 'item_2', at: 2 }], alignment: 'floor-frame' },
      ],
      'seq_root',
      cwd,
    );
    expect(add).toEqual({
      type: 'addItem',
      sequenceId: 'seq_root',
      alignment: 'nearest-frame',
      asset: { assetId: 'asset_1' },
      at: { unit: 'seconds', value: '1.5' },
    });
    expect(move).toMatchObject({ offset: { unit: 'seconds', value: '-0.25' }, sequenceId: 'seq_root' });
    expect(moves).toMatchObject({ alignment: 'floor-frame', moves: [{ itemId: 'item_2', at: { unit: 'seconds', value: '2' } }] });
  });

  it('保留已经写好的字段；帧时间原样交给引擎', () => {
    const [op] = normalizeOperations(
      [{ type: 'splitItem', sequenceId: 'seq_2', itemId: 'i', at: { unit: 'frames', value: 12 }, alignment: 'exact-frame' }],
      'seq_root',
      cwd,
    );
    expect(op).toEqual({
      type: 'splitItem',
      sequenceId: 'seq_2',
      itemId: 'i',
      at: { unit: 'frames', value: 12 },
      alignment: 'exact-frame',
    });
  });

  it('剪口的起止是源素材时钟上的十进制秒，补上根序列', () => {
    const [cut, restore] = normalizeOperations(
      [
        {
          type: 'addCuts',
          assetId: 'a',
          cuts: [
            { from: 4, to: 6.25, ref: 'p1' },
            { from: '7', to: '8' },
          ],
        },
        { type: 'restoreCut', assetId: 'a', cutId: 'cut_1' },
      ],
      'seq_root',
      cwd,
    );
    expect(cut).toEqual({
      type: 'addCuts',
      assetId: 'a',
      sequenceId: 'seq_root',
      cuts: [
        { from: '4', to: '6.25', ref: 'p1' },
        { from: '7', to: '8' },
      ],
    });
    expect(restore).toEqual({ type: 'restoreCut', assetId: 'a', cutId: 'cut_1', sequenceId: 'seq_root' });
  });

  it('剪辑建议：检测参数的秒数换成十进制字符串，接受建议补上根序列', () => {
    const [propose, accept] = normalizeOperations(
      [
        { type: 'proposeCuts', assetId: 'a', detect: { minPause: 1, compressTo: 0.25, fillers: false } },
        { type: 'acceptCutSuggestions', proposalId: 'doc_p', suggestionIds: ['cut-fl-w2'] },
      ],
      'seq_root',
      cwd,
    );
    expect(propose).toEqual({ type: 'proposeCuts', assetId: 'a', detect: { minPause: '1', compressTo: '0.25', fillers: false } });
    expect(accept).toEqual({ type: 'acceptCutSuggestions', proposalId: 'doc_p', suggestionIds: ['cut-fl-w2'], sequenceId: 'seq_root' });
  });

  it('导入路径相对工作目录，~ 展开为主目录；不带时间的操作不加对齐', () => {
    const [a, b, c, d, e] = normalizeOperations(
      [
        { type: 'importAsset', path: 'media/a.mp4' },
        { type: 'importAsset', path: '~/Videos/b.mov' },
        { type: 'deleteItems', itemIds: ['x'] },
        { type: 'setAudioMix', itemId: 'x', fadeIn: 0.5, fadeOut: '1' },
        { type: 'updateSequence', canvas: { width: 1080, height: 1920 }, background: '#101010' },
      ],
      'seq_root',
      cwd,
    );
    expect(a).toMatchObject({ path: path.resolve(cwd, 'media/a.mp4') });
    expect(b).toMatchObject({ path: path.join(os.homedir(), 'Videos/b.mov') });
    expect(c).toEqual({ type: 'deleteItems', itemIds: ['x'], sequenceId: 'seq_root' });
    expect(d).toEqual({ type: 'setAudioMix', itemId: 'x', fadeIn: '0.5', fadeOut: '1' });
    expect(e).toMatchObject({ type: 'updateSequence', sequenceId: 'seq_root' });
  });

  it('转场时长、章节时间与闪避的起落换成引擎的写法', () => {
    const [transition, chapters, upsert, ducking, removal] = normalizeOperations(
      [
        { type: 'setTransition', leftItemId: 'a', rightItemId: 'b', kind: 'dissolve', duration: 0.5 },
        {
          type: 'setChapters',
          chapters: [
            { at: 0, title: '开场', thumbnail: 'asset_1' },
            { at: '12.5', title: '正题' },
          ],
        },
        { type: 'upsertChapter', chapterId: 'chap_1', at: 3, thumbnail: null },
        {
          type: 'setDucking',
          trigger: { kind: 'items', trackIds: ['trk_a1'] },
          target: { trackIds: ['trk_a2'] },
          attack: 0.05,
          release: '0.5',
        },
        { type: 'removeTransition', transitionId: 'tr_1' },
      ],
      'seq_root',
      cwd,
    );
    expect(transition).toMatchObject({
      sequenceId: 'seq_root',
      alignment: 'nearest-frame',
      duration: { unit: 'seconds', value: '0.5' },
    });
    expect(chapters).toEqual({
      type: 'setChapters',
      sequenceId: 'seq_root',
      alignment: 'nearest-frame',
      chapters: [
        { at: { unit: 'seconds', value: '0' }, title: '开场', thumbnail: { assetId: 'asset_1' } },
        { at: { unit: 'seconds', value: '12.5' }, title: '正题' },
      ],
    });
    expect(upsert).toEqual({
      type: 'upsertChapter',
      sequenceId: 'seq_root',
      alignment: 'nearest-frame',
      chapterId: 'chap_1',
      at: { unit: 'seconds', value: '3' },
      thumbnail: null,
    });
    expect(ducking).toMatchObject({ sequenceId: 'seq_root', attack: '0.05', release: '0.5' });
    expect(ducking).not.toHaveProperty('alignment');
    expect(removal).toEqual({ type: 'removeTransition', transitionId: 'tr_1' });
  });

  it('看不懂的时间与形态指出是第几个操作', () => {
    expect(() =>
      normalizeOperations(
        [
          { type: 'renameVideo', name: 'a' },
          { type: 'trimItem', at: '一秒' },
        ],
        's',
        cwd,
      ),
    ).toThrow(/第 2 个操作/);
    expect(() => normalizeOperations(['nope'], 's', cwd)).toThrow(OperationShapeError);
    expect(() => normalizeOperations([{ type: 'splitItem', at: Number.NaN }], 's', cwd)).toThrow(/有限/);
  });
});
