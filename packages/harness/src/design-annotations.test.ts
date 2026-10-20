import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId, type DesignAnnotation, type DesignSystemAnnotation, type DriverProbe, type Id, type VideoAnnotation } from '@baocut/protocol';
import { ConversationStore, ProjectStore, resolveRuntimeHome, type RuntimeHome } from '@baocut/runtime-storage';
import { DriverRegistry } from './agent-manager.ts';
import type { AgentDriver, AgentEvent, AgentSession } from './driver.ts';
import {
  Harness,
  withDesignAnnotations,
  withDesignSystemAnnotations,
  withVideoAnnotations,
  type ResolvedDesignAnnotation,
  type ResolvedDesignSystemAnnotation,
  type ResolvedSlideAnnotation,
  type ResolvedVideoAnnotation,
} from './harness.ts';
import { silentLogger } from './logger.ts';

/** 设计稿标注（docs/design/canvas §9）与设计系统标注（§10.6）随消息发出，与设计稿、设计系统卡片（§7.3、§10.5）。假 Driver，全部在临时目录里。 */

const note = (over: Partial<DesignAnnotation> = {}): DesignAnnotation => ({
  canvas: { conversationId: 'c', path: 'poster' },
  anchor: 'Main.dc.html#el-12',
  board: 'Main.dc.html',
  label: 'Main › Button "Book now"',
  detail: 'Main.dc.html › body > div > button "Book now"',
  text: '按钮再大一点',
  ...over,
});

describe('withDesignAnnotations', () => {
  it('没有标注时原样返回', () => {
    expect(withDesignAnnotations('改一下', [])).toBe('改一下');
  });

  it('每份设计稿一段，按第一次出现的顺序；编号是这条消息设计稿标注里的序号；多行批注缩进对齐', () => {
    const text = withDesignAnnotations('按标注改', [
      { annotation: note(), canvasPath: 'poster/' },
      { annotation: note({ label: 'Area over Main', detail: undefined, area: true, text: '留白太多\n往上挪' }), canvasPath: '/abs/other/' },
      { annotation: note({ label: 'Cart › Title', text: '加粗' }), canvasPath: 'poster/' },
    ]);
    expect(text).toBe(
      [
        '按标注改',
        '',
        '<baocut-design-annotations canvas="poster/">',
        '1. Main › Button "Book now"',
        '   定位：Main.dc.html › body > div > button "Book now"',
        '   批注：按钮再大一点',
        '3. Cart › Title',
        '   定位：Main.dc.html › body > div > button "Book now"',
        '   批注：加粗',
        '</baocut-design-annotations>',
        '<baocut-design-annotations canvas="/abs/other/">',
        '2. Area over Main',
        '   批注：留白太多',
        '        往上挪',
        '</baocut-design-annotations>',
      ].join('\n'),
    );
  });
});

const systemNote = (over: Partial<DesignSystemAnnotation> = {}): DesignSystemAnnotation => ({
  system: { conversationId: 'c', path: 'spectrum-2' },
  anchor: 'comp-Button',
  section: 'components',
  label: '设计系统「Spectrum 2」 › Components › 组件 “Button”',
  detail: 'Component "Button" in section components (components/Button/) · comp-Button',
  text: '圆角改小',
  ...over,
});

describe('withDesignSystemAnnotations', () => {
  it('没有标注时原样返回', () => {
    expect(withDesignSystemAnnotations('改一下', [])).toBe('改一下');
  });

  it('每套设计系统一段，按第一次出现的顺序；编号是这条消息设计系统标注里的序号；多行批注缩进对齐', () => {
    const text = withDesignSystemAnnotations('按标注改', [
      { annotation: systemNote(), systemPath: 'spectrum-2/' },
      { annotation: systemNote({ label: 'Colors › token “x”', detail: undefined, text: '改深一点\n对比度不够' }), systemPath: '/abs/ember/' },
      { annotation: systemNote({ label: 'Overview › 封面', text: '换张图' }), systemPath: 'spectrum-2/' },
    ]);
    expect(text).toBe(
      [
        '按标注改',
        '',
        '<baocut-design-system-annotations system="spectrum-2/">',
        '1. 设计系统「Spectrum 2」 › Components › 组件 “Button”',
        '   定位：Component "Button" in section components (components/Button/) · comp-Button',
        '   批注：圆角改小',
        '3. Overview › 封面',
        '   定位：Component "Button" in section components (components/Button/) · comp-Button',
        '   批注：换张图',
        '</baocut-design-system-annotations>',
        '<baocut-design-system-annotations system="/abs/ember/">',
        '2. Colors › token “x”',
        '   批注：改深一点',
        '        对比度不够',
        '</baocut-design-system-annotations>',
      ].join('\n'),
    );
  });
});

const videoNote = (over: Partial<VideoAnnotation> = {}): VideoAnnotation => ({
  video: { conversationId: 'c', path: 'talk' },
  revision: '3',
  timeMs: 42300,
  kind: 'pin',
  region: { x: 0.8, y: 0.2, w: 0, h: 0 },
  label: '00:42.3 · 编号 · 画面右上',
  text: '这里的字太小',
  ...over,
});

describe('withVideoAnnotations（产品设计 §3.2.3「视频标注」）', () => {
  it('没有标注时原样返回', () => {
    expect(withVideoAnnotations('改一下', [])).toBe('改一下');
  });

  // 与原型 designs/baocut/app/model-stage-notes.test.js 的 promptText 用例逐字一致。
  it('一部视频一段，带 revision；一帧一条，编号每部视频各自从 1 起，逐处列 kind 与区域；标了两帧以上附 candidateBoundsMs', () => {
    const text = withVideoAnnotations('请按这些视频标注修改。', [
      { annotation: videoNote({ timeMs: 10000, kind: 'box', region: { x: 0.25, y: 0.2, w: 0.5, h: 0.4 }, text: '这块字幕挡住了脸' }), videoPath: 'talk/' },
      { annotation: videoNote({ video: { conversationId: 'c', path: 'intro' }, timeMs: 5000, text: '这里加个标题' }), videoPath: 'intro/' },
      {
        annotation: videoNote({ timeMs: 42300, kind: 'arrow', region: { x: 0.1, y: 0.1, w: 0, h: 0 }, to: { x: 0.6, y: 0.5 }, text: '把 logo 挪到这里' }),
        videoPath: 'talk/',
      },
    ]);
    expect(text).toBe(
      [
        '请按这些视频标注修改。',
        '',
        '<baocut-video-annotations video="talk/" revision="3">',
        '1. 00:10.0 (10000 ms) · 1 mark',
        '   a. box · x=0.25 y=0.2 w=0.5 h=0.4 (25%, 20%, 50% × 40%)',
        '      批注：这块字幕挡住了脸',
        '2. 00:42.3 (42300 ms) · 1 mark',
        '   a. arrow · from (0.1, 0.1) to (0.6, 0.5)',
        '      批注：把 logo 挪到这里',
        'candidateBoundsMs: 10000–42300（候选范围，不是要改的区间）',
        '</baocut-video-annotations>',
        '<baocut-video-annotations video="intro/" revision="3">',
        '1. 00:05.0 (5000 ms) · 1 mark',
        '   a. pin · at (0.8, 0.2)',
        '      批注：这里加个标题',
        '</baocut-video-annotations>',
      ].join('\n'),
    );
  });

  it('revision 取这组里最大的（按数值）；时码先取整再进位，满一小时带小时；文字标注与多行批注', () => {
    const text = withVideoAnnotations('x', [
      { annotation: videoNote({ revision: '9', timeMs: 59_960, kind: 'text', text: '第一行\n第二行' }), videoPath: './' },
      { annotation: videoNote({ revision: '12', timeMs: 3_723_450 }), videoPath: './' },
    ]);
    expect(text).toContain('<baocut-video-annotations video="./" revision="12">');
    expect(text).toContain('1. 01:00.0 (59960 ms) · 1 mark\n   a. text · at (0.8, 0.2)\n      批注：第一行\n           第二行');
    expect(text).toContain('2. 1:02:03.5 (3723450 ms) · 1 mark\n   a. pin · at (0.8, 0.2)');
    expect(text).toContain('candidateBoundsMs: 59960–3723450（候选范围，不是要改的区间）');
  });

  // docs/design/lite-editor §4.3 的示例块；行序与原型 model-stage-notes.js 的 promptText 一致。
  it('标记工具送来的：同一帧的几处是一条，落点与截图跟着那一条，逐处的样式、元素、印章各占一行，没有的省略；画的标记不写空批注', () => {
    const style = { color: 'red', width: 4 } as const;
    const blue = { color: 'blue', width: 4 } as const;
    const s03 = { id: 's03', kind: 'scene', index: 2, title: '倒着为什么不掉' };
    const s01 = { id: 's01', kind: 'scene', index: 0, title: '钩子' };
    const l3 = { id: 's01:l3', index: 3, text: '它没有掉下来也没有慢下来' };
    const at = (timeMs: number) => ({ revision: '12', timeMs });
    const text = withVideoAnnotations('请按这些视频标注修改。', [
      {
        annotation: videoNote({
          ...at(70000),
          kind: 'box',
          region: { x: 0.42, y: 0.36, w: 0.18, h: 0.22 },
          style,
          segment: s03,
          line: { id: 's03:l2', index: 2, text: '那一个有点危险的做法……' },
          shot: { timeMs: 70000, attachment: 'att_frame' },
          text: '',
        }),
        videoPath: '倒着开的跑车.baocut/',
      },
      {
        annotation: videoNote({ ...at(70000), kind: 'text', region: { x: 0.6, y: 0.3, w: 0, h: 0 }, style, segment: s03, text: '字太小' }),
        videoPath: '倒着开的跑车.baocut/',
      },
      {
        annotation: videoNote({
          ...at(12400),
          kind: 'element',
          region: { x: 0.16, y: 0.84, w: 0.68, h: 0.05 },
          style: blue,
          element: { kind: 'caption', id: 's01:l3', text: '它没有掉下来也没有慢下来' },
          segment: s01,
          line: l3,
          text: '',
        }),
        videoPath: '倒着开的跑车.baocut/',
      },
      {
        annotation: videoNote({
          ...at(12400),
          kind: 'comment',
          region: { x: 0.4, y: 0.3, w: 0, h: 0 },
          style: blue,
          element: { kind: 'html', selector: 'button#play.bc-icon-button', w: 32, h: 32, name: '播放', role: 'button', focusable: true },
          segment: s01,
          shot: { timeMs: 12400, stamp: { x: 0.4, y: 0.3 } },
          text: '这里慢一点',
        }),
        videoPath: '倒着开的跑车.baocut/',
      },
    ], [{ id: 'att_frame', kind: 'image', fileName: 'frame-70000.png', mimeType: 'image/png', size: 1234 }]);
    expect(text).toBe(
      [
        '请按这些视频标注修改。',
        '',
        '<baocut-video-annotations video="倒着开的跑车.baocut/" revision="12">',
        '1. 01:10.0 (70000 ms) · 2 marks',
        '   segment: s03 (scene #3 倒着为什么不掉) · line 2: 那一个有点危险的做法……',
        "   screenshot: attached (frame-70000.png), frame at 70000 ms with this frame's marks drawn on it",
        '   a. box · x=0.42 y=0.36 w=0.18 h=0.22 (42%, 36%, 18% × 22%)',
        '      style: red 4px',
        '   b. text · at (0.6, 0.3)',
        '      style: red 4px',
        '      批注：字太小',
        '2. 00:12.4 (12400 ms) · 2 marks',
        '   segment: s01 (scene #1 钩子) · line 3: 它没有掉下来也没有慢下来',
        "   screenshot: not attached, frame at 12400 ms with this frame's marks drawn on it",
        '   a. element · x=0.16 y=0.84 w=0.68 h=0.05 (16%, 84%, 68% × 5%)',
        '      style: blue 4px',
        '      element: caption s01:l3 "它没有掉下来也没有慢下来"',
        '   b. comment · at (0.4, 0.3)',
        '      style: blue 4px',
        '      element: html button#play.bc-icon-button 32×32 name="播放" role=button',
        '      stamp: (0.4, 0.3) on the screenshot',
        '      批注：这里慢一点',
        'candidateBoundsMs: 12400–70000（候选范围，不是要改的区间）',
        '</baocut-video-annotations>',
      ].join('\n'),
    );
  });

  it('直线给两端，画笔给点列与外接框；带了 detail 的元素原样用它', () => {
    const text = withVideoAnnotations('x', [
      {
        annotation: videoNote({ kind: 'line', region: { x: 0.1, y: 0.1, w: 0, h: 0 }, to: { x: 0.6, y: 0.5 }, text: '' }),
        videoPath: './',
      },
      {
        annotation: videoNote({
          kind: 'pen',
          region: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
          points: [
            { x: 0.1, y: 0.2 },
            { x: 0.25, y: 0.3 },
            { x: 0.4, y: 0.2 },
          ],
          text: '',
        }),
        videoPath: './',
      },
      { annotation: videoNote({ kind: 'ellipse', region: { x: 0.25, y: 0.2, w: 0.5, h: 0.4 }, text: '' }), videoPath: './' },
      {
        annotation: videoNote({
          kind: 'element',
          region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
          element: { kind: 'element', id: 'logo', detail: 'element logo (image)' },
        }),
        videoPath: './',
      },
    ]);
    expect(text).toContain('1. 00:42.3 (42300 ms) · 4 marks\n   a. line · from (0.1, 0.1) to (0.6, 0.5)\n   b.');
    expect(text).toContain('   b. pen · path (0.1, 0.2) → (0.25, 0.3) → (0.4, 0.2) within x=0.1 y=0.2 w=0.3 h=0.1\n   c.');
    expect(text).toContain('   c. ellipse · x=0.25 y=0.2 w=0.5 h=0.4 (25%, 20%, 50% × 40%)\n   d.');
    expect(text).toContain('   d. element · x=0.1 y=0.1 w=0.2 h=0.2 (10%, 10%, 20% × 20%)\n      element: element logo (image)\n      批注：这里的字太小');
    expect(text).not.toContain('candidateBoundsMs');
  });
});

const capabilities: DriverProbe['capabilities'] = { steer: true, approvals: true, resume: false, images: false };

/** 回合开始后一直开着；收下插话。 */
class Session implements AgentSession {
  readonly id = newId('fake');
  readonly capabilities = capabilities;
  readonly inputs: string[] = [];
  readonly #listeners = new Set<(event: AgentEvent) => void>();
  #turn = 0;
  turnId: string | null = null;

  startTurn(input: { text: string }): Promise<{ turnId: string }> {
    const turnId = `turn-${++this.#turn}`;
    this.turnId = turnId;
    this.inputs.push(input.text);
    setTimeout(() => this.#emit({ type: 'turn.started', turnId }), 1);
    return Promise.resolve({ turnId });
  }

  async steer(_turnId: string, input: { text: string }) {
    this.inputs.push(input.text);
    return 'accepted' as const;
  }

  async interrupt() {
    return { status: 'requested' as const };
  }

  async respondToApproval() {}

  subscribe(listener: (event: AgentEvent) => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  describePersistence() {
    return null;
  }

  async close() {}

  #emit(event: AgentEvent) {
    for (const listener of this.#listeners) listener(event);
  }
}

class Driver implements AgentDriver {
  readonly id = 'codex' as const;
  readonly sessions: Session[] = [];

  async probe(): Promise<DriverProbe> {
    return {
      id: 'codex',
      name: 'Fake',
      command: 'fake',
      state: 'ready',
      status: 'available',
      version: '0',
      minVersion: '0',
      latestVersion: null,
      unavailableReason: null,
      detail: null,
      executable: null,
      realExecutable: null,
      account: null,
      plan: '',
      loginCommand: null,
      install: [],
      models: [],
      configModel: null,
      configModelKnown: null,
      checkedAt: new Date().toISOString(),
      verified: true,
      tested: true,
      capabilities,
    };
  }

  async createSession(): Promise<AgentSession> {
    const session = new Session();
    this.sessions.push(session);
    return session;
  }
}

let dir: string;
let home: RuntimeHome;
let driver: Driver;
let harness: Harness;

async function until<T>(read: () => T | undefined | null | false, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const userMessages = (conversationId: Id) => harness.getConversation(conversationId).items.filter((item) => item.kind === 'user-message');

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-design-notes-')));
  home = resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'home') });
  driver = new Driver();
  const drivers = new DriverRegistry();
  drivers.register(driver);
  harness = await Harness.open({
    home,
    conversations: new ConversationStore(home.conversationsDir),
    projects: new ProjectStore(home.projectsFile),
    drivers,
    log: silentLogger,
  });
});

afterEach(async () => {
  await harness.shutdown();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('send 与 steer 带设计稿标注', () => {
  it('设计稿标注段排在幻灯片标注段之后，用户消息上原样记一份（不带解析出的路径）', async () => {
    const conversation = await harness.createConversation({ title: '改设计稿' });
    const designAnnotations: ResolvedDesignAnnotation[] = [{ annotation: note({ canvas: { conversationId: conversation.id, path: 'poster' } }), canvasPath: 'poster/' }];
    const slideAnnotations: ResolvedSlideAnnotation[] = [
      {
        annotation: { deck: { conversationId: conversation.id, path: 'talk' }, anchor: 'a', label: '第 1 页', text: '换图' },
        deckPath: 'talk/',
      },
    ];
    await harness.send({ conversationId: conversation.id, text: '按标注改', commandId: newId('cmd'), slideAnnotations, designAnnotations });
    const session = await until(() => driver.sessions.at(-1));
    const input = await until(() => session.inputs[0]);
    const slideAt = input.indexOf('<baocut-slide-annotations deck="talk/">');
    const designAt = input.indexOf('<baocut-design-annotations canvas="poster/">\n1. Main › Button');
    expect(slideAt).toBeGreaterThan(0);
    expect(designAt).toBeGreaterThan(slideAt);
    expect(input.trimEnd().endsWith('</baocut-design-annotations>')).toBe(true);
    const [message] = userMessages(conversation.id);
    expect(message).toMatchObject({ text: '按标注改', designAnnotations: [designAnnotations[0]!.annotation] });
  });

  it('没带标注的消息不写这个字段；插话带的标注同样附上、记下', async () => {
    const conversation = await harness.createConversation({ title: '插话' });
    await harness.send({ conversationId: conversation.id, text: '做一份设计稿', commandId: newId('cmd') });
    const session = await until(() => driver.sessions.at(-1));
    await until(() => harness.agentRun(conversation.id).taskId && session.turnId);
    expect(userMessages(conversation.id)[0]).not.toHaveProperty('designAnnotations');

    const annotation = note({ canvas: { conversationId: conversation.id, path: 'poster' }, text: '换个颜色' });
    const result = await harness.steer({
      conversationId: conversation.id,
      text: '顺便改这里',
      commandId: newId('cmd'),
      designAnnotations: [{ annotation, canvasPath: 'poster/' }],
    });
    expect(result).toEqual({ status: 'steered' });
    expect(session.inputs[1]).toContain('<baocut-design-annotations canvas="poster/">');
    expect(session.inputs[1]).toContain('   批注：换个颜色');
    expect(userMessages(conversation.id)[1]).toMatchObject({ text: '顺便改这里', designAnnotations: [annotation] });
  });
});

describe('send 与 steer 带设计系统标注', () => {
  it('设计系统标注段排在设计稿标注段之后，用户消息上原样记一份（不带解析出的路径）', async () => {
    const conversation = await harness.createConversation({ title: '改设计系统' });
    const designAnnotations: ResolvedDesignAnnotation[] = [{ annotation: note({ canvas: { conversationId: conversation.id, path: 'poster' } }), canvasPath: 'poster/' }];
    const designSystemAnnotations: ResolvedDesignSystemAnnotation[] = [
      { annotation: systemNote({ system: { conversationId: conversation.id, path: 'spectrum-2' } }), systemPath: 'spectrum-2/' },
    ];
    await harness.send({ conversationId: conversation.id, text: '按标注改', commandId: newId('cmd'), designAnnotations, designSystemAnnotations });
    const session = await until(() => driver.sessions.at(-1));
    const input = await until(() => session.inputs[0]);
    const designAt = input.indexOf('<baocut-design-annotations canvas="poster/">');
    const systemAt = input.indexOf('<baocut-design-system-annotations system="spectrum-2/">\n1. 设计系统「Spectrum 2」');
    expect(designAt).toBeGreaterThan(0);
    expect(systemAt).toBeGreaterThan(designAt);
    expect(input.trimEnd().endsWith('</baocut-design-system-annotations>')).toBe(true);
    const [message] = userMessages(conversation.id);
    expect(message).toMatchObject({ text: '按标注改', designSystemAnnotations: [designSystemAnnotations[0]!.annotation] });
  });

  it('没带标注的消息不写这个字段；插话带的标注同样附上、记下', async () => {
    const conversation = await harness.createConversation({ title: '插话' });
    await harness.send({ conversationId: conversation.id, text: '做一套设计系统', commandId: newId('cmd') });
    const session = await until(() => driver.sessions.at(-1));
    await until(() => harness.agentRun(conversation.id).taskId && session.turnId);
    expect(userMessages(conversation.id)[0]).not.toHaveProperty('designSystemAnnotations');

    const annotation = systemNote({ system: { conversationId: conversation.id, path: 'spectrum-2' }, text: '主色再亮一点' });
    const result = await harness.steer({
      conversationId: conversation.id,
      text: '顺便改这里',
      commandId: newId('cmd'),
      designSystemAnnotations: [{ annotation, systemPath: 'spectrum-2/' }],
    });
    expect(result).toEqual({ status: 'steered' });
    expect(session.inputs[1]).toContain('<baocut-design-system-annotations system="spectrum-2/">');
    expect(session.inputs[1]).toContain('   批注：主色再亮一点');
    expect(userMessages(conversation.id)[1]).toMatchObject({ text: '顺便改这里', designSystemAnnotations: [annotation] });
  });
});

describe('send 与 steer 带视频标注', () => {
  it('视频标注段排在设计系统标注段之后，用户消息上原样记一份（不带解析出的路径）', async () => {
    const conversation = await harness.createConversation({ title: '改视频' });
    const designSystemAnnotations: ResolvedDesignSystemAnnotation[] = [
      { annotation: systemNote({ system: { conversationId: conversation.id, path: 'spectrum-2' } }), systemPath: 'spectrum-2/' },
    ];
    const videoAnnotations: ResolvedVideoAnnotation[] = [{ annotation: videoNote({ video: { conversationId: conversation.id, path: 'talk' } }), videoPath: 'talk/' }];
    await harness.send({ conversationId: conversation.id, text: '按标注改', commandId: newId('cmd'), designSystemAnnotations, videoAnnotations });
    const session = await until(() => driver.sessions.at(-1));
    const input = await until(() => session.inputs[0]);
    const systemAt = input.indexOf('<baocut-design-system-annotations system="spectrum-2/">');
    const videoAt = input.indexOf('<baocut-video-annotations video="talk/" revision="3">\n1. 00:42.3 (42300 ms) · 1 mark\n   a. pin');
    expect(systemAt).toBeGreaterThan(0);
    expect(videoAt).toBeGreaterThan(systemAt);
    expect(input.trimEnd().endsWith('</baocut-video-annotations>')).toBe(true);
    const [message] = userMessages(conversation.id);
    expect(message).toMatchObject({ text: '按标注改', videoAnnotations: [videoAnnotations[0]!.annotation] });
  });

  it('没带标注的消息不写这个字段；插话带的标注同样附上、记下', async () => {
    const conversation = await harness.createConversation({ title: '插话' });
    await harness.send({ conversationId: conversation.id, text: '剪一下', commandId: newId('cmd') });
    const session = await until(() => driver.sessions.at(-1));
    await until(() => harness.agentRun(conversation.id).taskId && session.turnId);
    expect(userMessages(conversation.id)[0]).not.toHaveProperty('videoAnnotations');

    const annotation = videoNote({ video: { conversationId: conversation.id, path: 'talk' }, text: '这里删掉' });
    const result = await harness.steer({
      conversationId: conversation.id,
      text: '顺便改这里',
      commandId: newId('cmd'),
      videoAnnotations: [{ annotation, videoPath: 'talk/' }],
    });
    expect(result).toEqual({ status: 'steered' });
    expect(session.inputs[1]).toContain('<baocut-video-annotations video="talk/" revision="3">');
    expect(session.inputs[1]).toContain('   批注：这里删掉');
    expect(userMessages(conversation.id)[1]).toMatchObject({ text: '顺便改这里', videoAnnotations: [annotation] });
  });
});

describe('recordDesignCreated（docs/design/canvas §7.3）', () => {
  it('同一份设计稿只有一条：再次通过时更新标题、画板数与任务，id 不变；别的设计稿另起一条', async () => {
    const conversation = await harness.createConversation({ title: '设计稿卡片' });
    const target = { conversationId: conversation.id, path: 'poster' };
    const cards = () => harness.getConversation(conversation.id).items.filter((item) => item.kind === 'design-created');
    harness.recordDesignCreated(conversation.id, 'task-1', { target, title: 'Poster', boardCount: 1 });
    const [first] = cards();
    expect(first).toMatchObject({ kind: 'design-created', taskId: 'task-1', target, title: 'Poster', boardCount: 1 });
    expect(first!.id.startsWith('design')).toBe(true);
    harness.recordDesignCreated(conversation.id, 'task-2', { target: { ...target }, title: 'Spring Poster', boardCount: 3 });
    expect(cards()).toEqual([{ ...first, taskId: 'task-2', title: 'Spring Poster', boardCount: 3 }]);
    harness.recordDesignCreated(conversation.id, null, { target: { conversationId: conversation.id, path: 'menu' }, title: 'Menu', boardCount: 2 });
    expect(cards()).toHaveLength(2);
    harness.recordDesignCreated('missing', null, { target, title: 'x', boardCount: 1 });
  });
});

describe('recordDesignSystemCreated（docs/design/canvas §10.5）', () => {
  it('同一个设计系统只有一条：再次通过时更新标题与任务，id 不变；别的设计系统另起一条', async () => {
    const conversation = await harness.createConversation({ title: '设计系统卡片' });
    const target = { conversationId: conversation.id, path: 'acme' };
    const cards = () => harness.getConversation(conversation.id).items.filter((item) => item.kind === 'design-system-created');
    harness.recordDesignSystemCreated(conversation.id, 'task-1', { target, title: 'Acme' });
    const [first] = cards();
    expect(first).toMatchObject({ kind: 'design-system-created', taskId: 'task-1', target, title: 'Acme' });
    expect(first!.id.startsWith('dsys')).toBe(true);
    harness.recordDesignSystemCreated(conversation.id, 'task-2', { target: { ...target }, title: 'Acme 2' });
    expect(cards()).toEqual([{ ...first, taskId: 'task-2', title: 'Acme 2' }]);
    harness.recordDesignSystemCreated(conversation.id, null, { target: { conversationId: conversation.id, path: 'ember' }, title: 'Ember' });
    expect(cards()).toHaveLength(2);
    harness.recordDesignSystemCreated('missing', null, { target, title: 'x' });
  });
});
