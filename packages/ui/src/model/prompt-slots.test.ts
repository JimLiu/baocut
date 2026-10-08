import { describe, expect, it } from 'vitest';
import { templateSlots, templateUnfilledText } from '@baocut/protocol';
import {
  fillSlot,
  filledSlot,
  fromPromptSegments,
  isSlotToken,
  nextSlotIndex,
  slotLabels,
  slotParts,
  slotsForAgent,
  toPromptSegments,
} from './prompt-slots.ts';

const serialize = (parts: ReturnType<typeof slotParts>) => parts.map((x) => (x.type === 'slot' ? `{{${x.label}}}` : x.text)).join('');

const CASES = [
  '',
  '没有占位符的一句话',
  '给{{产品或服务}}做一条推广，面向{{受众}}。',
  '{{a}}{{b}}',
  '开头{{a}}\n第二行{{b}}结尾',
  '没闭合的 {{受众 后面还有字',
  '空的 {{}} 不算',
  '{{目标 受众}} 带空格',
  '{{{a}}}',
  '{{跨\n行}}',
  '{{a}b}}',
  '看 https://example.com/a?b=1 和 {{受众}}',
];

const slot = (label: string) => ({
  type: 'token' as const,
  text: label,
  value: { type: 'placeholder' as const, placeholderType: 'text' as const },
});

describe('slotParts', () => {
  it('与片段严格往返（usePromptValue 靠它判断要不要重建）', () => {
    for (const s of CASES) expect(serialize(slotParts(s))).toBe(s);
  });

  it('认的占位符与 @baocut/protocol 的解析一致', () => {
    for (const s of CASES) {
      expect(slotParts(s).flatMap((x) => (x.type === 'slot' ? [x.label] : []))).toEqual(templateSlots(s));
      expect(
        slotParts(s)
          .map((x) => (x.type === 'slot' ? `[${x.label}]` : x.text))
          .join(''),
      ).toBe(templateUnfilledText(s));
    }
  });

  it('相邻占位符、换行、label 含空格；不产生空的文字片段', () => {
    expect(slotParts('')).toEqual([]);
    expect(slotParts('{{a}}{{b}}')).toEqual([
      { type: 'slot', label: 'a' },
      { type: 'slot', label: 'b' },
    ]);
    expect(slotParts('开头{{a}}\n第二行')).toEqual([
      { type: 'text', text: '开头' },
      { type: 'slot', label: 'a' },
      { type: 'text', text: '\n第二行' },
    ]);
    expect(slotParts('{{ 受众 }}')).toEqual([{ type: 'slot', label: ' 受众 ' }]);
    for (const x of slotParts('{{a}}x{{b}}')) expect(x.type === 'slot' || x.text.length > 0).toBe(true);
  });

  it('没闭合的 {{、空的 {{}}、跨行与带括号的都按文字留着', () => {
    expect(slotParts('没闭合的 {{受众')).toEqual([{ type: 'text', text: '没闭合的 {{受众' }]);
    expect(slotParts('空的 {{}}')).toEqual([{ type: 'text', text: '空的 {{}}' }]);
    expect(slotParts('{{跨\n行}}')).toEqual([{ type: 'text', text: '{{跨\n行}}' }]);
    expect(slotParts('{{{a}}}')).toEqual([
      { type: 'text', text: '{' },
      { type: 'slot', label: 'a' },
      { type: 'text', text: '}' },
    ]);
  });
});

describe('slotLabels / slotsForAgent', () => {
  it('label 去重、按出现顺序', () => {
    expect(slotLabels('给{{产品}}做，面向{{受众}}，再说一次{{产品}}')).toEqual(['产品', '受众']);
    expect(slotLabels('都填好了')).toEqual([]);
  });

  it('没填的写成 [label]，不保留 {{', () => {
    expect(slotsForAgent('给{{产品或服务}}做一条推广，面向{{受众}}。')).toBe('给[产品或服务]做一条推广，面向[受众]。');
    expect(slotsForAgent('{{a}}{{b}}\n{{c')).toBe('[a][b]\n{{c');
    expect(slotsForAgent('没有占位符')).toBe('没有占位符');
  });
});

describe('与 PromptFieldValue 片段的互换', () => {
  it('草稿 → 片段：占位符变占位 token', () => {
    expect(toPromptSegments('给{{产品}}做，面向{{受众}}。')).toEqual([
      { type: 'text', text: '给' },
      slot('产品'),
      { type: 'text', text: '做，面向' },
      slot('受众'),
      { type: 'text', text: '。' },
    ]);
    expect(toPromptSegments('')).toEqual([]);
  });

  it('片段 → 草稿：严格往返', () => {
    for (const s of CASES) expect(fromPromptSegments(toPromptSegments(s))).toBe(s);
  });

  it('占位 token 写回 {{label}}，链接 token 写完整地址，其余 token 取文字', () => {
    expect(
      fromPromptSegments([
        { type: 'text', text: '看 ' },
        { type: 'token', text: 'example.com', value: { type: 'url', url: 'https://example.com/a' } },
        { type: 'text', text: ' 给 ' },
        slot('受众'),
        { type: 'token', text: '@', value: { type: 'anchor', valueType: 'file' } },
      ]),
    ).toBe('看 https://example.com/a 给 {{受众}}@');
  });

  it('打字替换后的片段就是普通文字（用户打的 {{x}} 也不变 token）', () => {
    expect(fromPromptSegments([{ type: 'text', text: '给{{x}}' }])).toBe('给{{x}}');
  });

  it('isSlotToken 只认 text 型占位', () => {
    expect(isSlotToken(slot('a'))).toBe(true);
    expect(isSlotToken({ type: 'token', text: '@', value: { type: 'placeholder', placeholderType: 'token' } })).toBe(false);
    expect(isSlotToken({ type: 'text', text: 'a' })).toBe(false);
    expect(isSlotToken(null)).toBe(false);
  });
});

describe('nextSlotIndex', () => {
  const segs = toPromptSegments('给{{产品}}做，面向{{受众}}。');

  it('从光标所在片段往后找，到末尾从头再找', () => {
    expect(nextSlotIndex(segs, -1)).toBe(1);
    expect(nextSlotIndex(segs, 1)).toBe(3);
    expect(nextSlotIndex(segs, 3)).toBe(1);
    expect(nextSlotIndex(segs, 4)).toBe(1);
  });

  it('只剩一处时一直是它；没有占位 token 返回 -1', () => {
    expect(nextSlotIndex(toPromptSegments('{{a}}'), 0)).toBe(0);
    expect(nextSlotIndex(toPromptSegments('都填好了'), 0)).toBe(-1);
    expect(nextSlotIndex([], -1)).toBe(-1);
  });
});

describe('filledSlot / fillSlot', () => {
  const template = '转录这个视频，并翻译成{{目标语言}}，做成双语字幕。';

  it('认出用户把待填项填成了什么：按占位符前后的几个字找，前后可以多出别的话', () => {
    expect(filledSlot(template, '目标语言', '转录这个视频，并翻译成日文，做成双语字幕。')).toBe('日文');
    expect(filledSlot(template, '目标语言', 'https://youtu.be/x 转录这个视频，并翻译成 English ，做成双语字幕。另外加章节')).toBe('English');
    const en = 'Transcribe this video and translate it into {{target language}} as bilingual subtitles.';
    expect(filledSlot(en, 'target language', 'Transcribe this video and translate it into Spanish as bilingual subtitles.')).toBe('Spanish');
  });

  it('还是占位符、没填、改得认不出、跨行或太长时为 null；模板里没有这个待填项也是 null', () => {
    expect(filledSlot(template, '目标语言', template)).toBeNull();
    expect(filledSlot(template, '目标语言', '转录这个视频，并翻译成[目标语言]，做成双语字幕。')).toBeNull();
    expect(filledSlot(template, '目标语言', '转录这个视频，并翻译成 ，做成双语字幕。')).toBeNull();
    expect(filledSlot(template, '目标语言', '给这个视频加上字幕。')).toBeNull();
    expect(filledSlot(template, '目标语言', '转录这个视频，并翻译成日\n文，做成双语字幕。')).toBeNull();
    expect(filledSlot(template, '目标语言', `转录这个视频，并翻译成${'长'.repeat(40)}，做成双语字幕。`)).toBeNull();
    expect(filledSlot(template, '受众', '转录这个视频，并翻译成日文，做成双语字幕。')).toBeNull();
    expect(filledSlot('{{a}}', 'a', '随便')).toBeNull();
  });

  it('fillSlot 只换第一处同名占位符，值里的 $ 照原样', () => {
    expect(fillSlot(template, '目标语言', '日文')).toBe('转录这个视频，并翻译成日文，做成双语字幕。');
    expect(fillSlot('{{a}} 和 {{a}}', 'a', '$&')).toBe('$& 和 {{a}}');
  });
});
