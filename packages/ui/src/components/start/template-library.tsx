import { useEffect, useRef, useState } from 'react';
import {
  ActionButton,
  Button,
  Content,
  Dialog,
  DialogContainer,
  Disclosure,
  DisclosurePanel,
  DisclosureTitle,
  Heading,
  Picker,
  PickerItem,
  SearchField,
  SegmentedControl,
  SegmentedControlItem,
  Text,
  ToggleButton,
} from '@react-spectrum/s2';
import Checkmark from '@react-spectrum/s2/icons/Checkmark';
import Pause from '@react-spectrum/s2/icons/Pause';
import Play from '@react-spectrum/s2/icons/Play';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import type { TemplateDiagnostic, TemplateKind } from '@baocut/protocol';
import { HOME_COPY } from '../../copy.ts';
import {
  TEMPLATE_KINDS_FILTER,
  findTemplates,
  isExample,
  pageOf,
  templateAssets,
  templateByline,
  templateCategories,
  templateMeta,
  templateOf,
  templateSources,
  templateSlotFields,
  templateSpecLine,
  type HomeTemplate,
  type TemplateSourceKey,
} from '../../model/home-templates.ts';
import { slotParts } from '../../model/prompt-slots.ts';
import { useSkills } from '../../state/skills-store.ts';
import { S } from '../shell-copy.ts';
import { TemplateCover, TemplateKindBadge } from './template-cover.tsx';
import { useTemplateCatalogLoader, useTemplateFileUrl, useTemplatePrompt } from './use-templates.ts';
import { ST } from './start-copy.ts';

// 两栏的几何（含窄窗口叠成上下）在 app.css 的 .bc-tpl-library；这里只有各块自己的样子与分隔线的颜色。
const libraryVars = style({ '--bc-tpl-divider': { type: 'backgroundColor', value: 'gray-100' } });
const bar = style({ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' });
const search = style({ flexGrow: 1, flexBasis: 160, minWidth: 0 });
// 类型与来源是一组：放不下时整组换到搜索框下面一行，不把来源单独挤下去。
const filters = style({ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 });
const sourcePicker = style({ width: 112 });
const cats = style({ display: 'flex', flexWrap: 'wrap', gap: 4 });
const card = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  width: 'full',
  padding: '[6px]',
  boxSizing: 'border-box',
  textAlign: 'start',
  borderStyle: 'none',
  borderRadius: 'lg',
  cursor: 'pointer',
  backgroundColor: { default: 'transparent', ':hover': 'gray-75', isCurrent: 'gray-100' },
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineWidth: 2,
  outlineOffset: -2,
  outlineColor: 'focus-ring',
});
const badge = style({
  position: 'absolute',
  insetEnd: '[6px]',
  bottom: '[6px]',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  height: 20,
  paddingX: '[6px]',
  borderRadius: 'default',
  backgroundColor: 'gray-25',
  font: 'ui-xs',
  color: 'gray-800',
});
const cardTitle = style({
  display: 'flex',
  alignItems: 'center',
  gap: '[6px]',
  minWidth: 0,
  paddingTop: '[6px]',
  paddingX: 2,
  font: 'ui',
  fontWeight: 'bold',
  color: 'gray-900',
});
const cardName = style({ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const cardMeta = style({
  paddingX: 2,
  font: 'ui-sm',
  color: 'gray-600',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
const quiet = style({ font: 'ui-sm', color: 'gray-600', margin: 0 });
const empty = style({ font: 'ui-sm', color: 'gray-600', margin: 0, paddingY: 48, textAlign: 'center' });
const status = style({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, paddingY: 48 });
const pager = style({ display: 'flex', alignItems: 'center', gap: 8 });
const spacer = style({ flexGrow: 1 });
const skippedList = style({ margin: 0, paddingStart: 16, maxHeight: 96, overflowY: 'auto', font: 'ui-sm', color: 'gray-700' });
const skippedPath = style({ color: 'gray-600', overflowWrap: 'anywhere' });

// 右栏：内容自己滚，「使用」固定在栏底。
const fixed = style({ flexShrink: 0 });
const controls = style({ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 });
const track = style({ flexGrow: 1, height: 4, borderRadius: 'full', backgroundColor: 'gray-200', overflow: 'hidden' });
const trackFill = style({ height: 'full', backgroundColor: 'gray-800' });
const paneTitle = style({ font: 'title', color: 'gray-900', margin: 0, flexShrink: 0 });
const byline = style({ font: 'ui-sm', color: 'gray-600', margin: 0, marginTop: -8, flexShrink: 0 });
const description = style({ font: 'body', color: 'gray-800', margin: 0, flexShrink: 0 });
const spec = style({ font: 'ui-sm', color: 'gray-700', margin: 0, flexShrink: 0 });
const briefNote = style({
  margin: 0,
  flexShrink: 0,
  paddingX: 12,
  paddingY: 8,
  borderRadius: 'default',
  backgroundColor: 'blue-100',
  font: 'ui-sm',
  color: 'blue-1000',
  lineHeight: '[1.5]',
});
const say = style({ font: 'body', color: 'gray-800', margin: 0 });
const label = style({ font: 'ui-sm', fontWeight: 'bold', color: 'gray-700', margin: 0, marginBottom: '[6px]' });
const prompt = style({
  margin: 0,
  padding: 12,
  borderRadius: 'default',
  backgroundColor: 'gray-75',
  font: 'ui-sm',
  color: 'gray-800',
  lineHeight: '[1.6]',
  whiteSpace: 'pre-wrap',
});
// 「需要你补充」：占位标记 + 一句说明（规范 §5.5）。
const fieldList = style({ display: 'flex', flexDirection: 'column', gap: '[6px]', margin: 0, padding: 0, listStyleType: 'none' });
const fieldItem = style({ display: 'flex', alignItems: 'baseline', gap: 8, font: 'ui-sm', lineHeight: '[1.5]' });
const fieldHint = style({ minWidth: 0, color: 'gray-700' });
// 占位标记：与输入框里 S2 占位 token 同一外观（虚线描边），提示词预览与「需要你补充」共用（原型 `.pslot-mark`）。
// 用 outline 画虚线：S2 宏会丢掉逐边的 border 样式，outline 是整圈的，不受影响。
const slotMark = style({
  display: 'inline',
  paddingX: 4,
  borderRadius: 'sm',
  outlineStyle: 'dashed',
  outlineWidth: 1,
  outlineColor: 'gray-500',
  outlineOffset: '[-1px]',
  backgroundColor: 'gray-100',
  color: 'gray-800',
  fontWeight: 'bold',
  boxDecorationBreak: 'clone',
});
const promptStatus = style({ display: 'flex', alignItems: 'center', gap: 8 });
const assetRow = style({ display: 'flex', flexWrap: 'wrap', gap: '[6px]' });
const asset = style({
  display: 'flex',
  alignItems: 'center',
  height: 24,
  paddingX: 8,
  borderRadius: 'default',
  backgroundColor: 'gray-100',
  font: 'ui-sm',
  color: 'gray-800',
});
const actions = style({ display: 'flex', justifyContent: 'end', flexShrink: 0 });

/** 预览「播放」：每隔一会儿换一幕；关掉就停在当前这一幕。 */
function useSlides(on: boolean): number {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!on) return undefined;
    const id = setInterval(() => setIndex((v) => v + 1), 1400);
    return () => clearInterval(id);
  }, [on]);
  return index;
}

/** 左栏的一张卡：点一下，右栏换成它的预览与提示词。作品示例在标题旁带「示例」。 */
function Card({ template, current, picked, onOpen }: { template: HomeTemplate; current: boolean; picked: boolean; onOpen(): void }) {
  return (
    <button
      type="button"
      className={card({ isCurrent: current })}
      aria-label={HOME_COPY.viewTemplate(template.title)}
      aria-pressed={current}
      onClick={onOpen}>
      <TemplateCover template={template}>
        {picked ? (
          <span className={badge}>
            <Checkmark />
            {HOME_COPY.templatePicked}
          </span>
        ) : null}
      </TemplateCover>
      <span className={cardTitle}>
        <span className={cardName}>{template.title}</span>
        <TemplateKindBadge template={template} />
      </span>
      <span className={cardMeta}>{templateMeta(template)}</span>
    </button>
  );
}

/**
 * 详情顶上的预览：有预览视频（`preview.file`）时放视频，取不到或没有时按分幕轮播占位画面（规范 §3.3）。
 * 播放 / 暂停与进度条对两种都管用。
 */
function Preview({ template }: { template: HomeTemplate }) {
  const [playing, setPlaying] = useState(true);
  const slide = useSlides(playing && !template.preview);
  const video = useTemplateFileUrl(template.id, template.preview);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [progress, setProgress] = useState(0);
  const showVideo = !!video.url && !video.failed;
  const count = template.beats.length;
  const fill = showVideo ? progress : ((slide % count) + 1) / count;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (playing) void el.play().catch(() => {});
    else el.pause();
  }, [playing, showVideo]);

  return (
    <div className={fixed}>
      {showVideo ? (
        <span className="bc-tpl-cover" data-size="lg">
          <video
            ref={videoRef}
            className="bc-tpl-cover__video"
            src={video.url!}
            muted
            loop
            playsInline
            autoPlay
            aria-hidden
            onError={video.fail}
            onTimeUpdate={(event) => {
              const { currentTime, duration } = event.currentTarget;
              setProgress(duration > 0 ? currentTime / duration : 0);
            }}
          />
        </span>
      ) : (
        <TemplateCover template={template} size="lg" slide={slide} />
      )}
      <div className={controls}>
        <ActionButton
          isQuiet
          size="S"
          aria-label={playing ? HOME_COPY.pausePreview : HOME_COPY.playPreview}
          onPress={() => setPlaying((v) => !v)}>
          {playing ? <Pause /> : <Play />}
        </ActionButton>
        <span className={track} aria-hidden>
          <span className={trackFill} style={{ display: 'block', width: `${fill * 100}%` }} />
        </span>
        <span className={quiet}>{templateMeta(template)}</span>
      </div>
    </div>
  );
}

/** 提示词里的 `{{label}}` 画成与输入框里占位 token 同一外观的标记（规范 §5.5）。 */
function SlotText({ text }: { text: string }) {
  return slotParts(text).map((x, i) =>
    x.type === 'slot' ? (
      <span key={i} className={slotMark}>
        {x.label}
      </span>
    ) : (
      x.text
    ),
  );
}

/** 提示词（`templates.get` 取回来的 `prompt.md` 全文）：加载中、失败可重试。 */
function PromptBody({ template }: { template: HomeTemplate }) {
  const body = useTemplatePrompt(template);
  if (body.state === 'ready')
    return (
      <pre className={prompt}>
        <SlotText text={body.text} />
      </pre>
    );
  if (body.state === 'loading') return <p className={quiet}>{HOME_COPY.templatePromptLoading}</p>;
  return (
    <div className={promptStatus}>
      <p className={quiet}>{HOME_COPY.templatePromptFailed(body.message)}</p>
      <ActionButton isQuiet size="S" onPress={body.retry}>
        {HOME_COPY.retryTemplates}
      </ActionButton>
    </div>
  );
}

/**
 * 右栏：正在看的那个模板。预览自动播，下面是介绍、画幅时长、提示词、素材与使用。
 * 场景模板多一句「先确认简报」的说明、「需要你补充」与「可以这样说」；作品示例的按钮是把提示词放进输入框。
 * 清单写了 `skills` 时多一行「做法：…」（技能已经取到时显示名称，否则显示标识）。
 */
function Detail({ template, picked, onUse }: { template: HomeTemplate; picked: boolean; onUse(template: HomeTemplate): void }) {
  const example = isExample(template);
  const assets = templateAssets(template);
  const fields = templateSlotFields(template);
  const skills = useSkills((s) => s.skills);
  const skillNames = template.skills.map((id) => skills.find((k) => k.id === id)?.name ?? id);
  return (
    <aside className="bc-tpl-library__pane" aria-label={HOME_COPY.templateToken(template.title)}>
      <div className="bc-tpl-library__pane-scroll bc-scroll">
        <Preview template={template} />
        <h3 className={paneTitle}>{template.title}</h3>
        <p className={byline}>{templateByline(template)}</p>
        <p className={description}>{template.description}</p>
        <p className={spec}>{templateSpecLine(template)}</p>
        {!example ? <p className={briefNote}>{HOME_COPY.templateBriefNote}</p> : null}
        {skillNames.length ? <p className={spec}>{HOME_COPY.templateSkills(S.list(skillNames))}</p> : null}
        {fields.length ? (
          <section className={fixed} aria-label={HOME_COPY.templateFields}>
            <h4 className={label}>{HOME_COPY.templateFields}</h4>
            <ul className={fieldList}>
              {fields.map((f) => (
                <li key={f.label} className={fieldItem}>
                  <span className={slotMark}>{f.label}</span>
                  {f.hint ? <span className={fieldHint}>{f.hint}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {!example && template.sample ? (
          <section className={fixed} aria-label={HOME_COPY.templateSay}>
            <h4 className={label}>{HOME_COPY.templateSay}</h4>
            <p className={say}>{template.sample}</p>
          </section>
        ) : null}
        <section className={fixed} aria-label={HOME_COPY.templatePrompt}>
          <h4 className={label}>{HOME_COPY.templatePrompt}</h4>
          <PromptBody template={template} />
        </section>
        <section className={fixed} aria-label={HOME_COPY.templateAssets}>
          <h4 className={label}>{HOME_COPY.templateAssets}</h4>
          {assets.length ? (
            <div className={assetRow}>
              {assets.map((a) => (
                <span key={a.kind} className={asset}>{`${a.label} ${a.count}`}</span>
              ))}
            </div>
          ) : (
            <p className={quiet}>{HOME_COPY.templatePromptOnly}</p>
          )}
        </section>
      </div>
      <div className={actions}>
        <Button variant="accent" onPress={() => onUse(template)}>
          {example ? HOME_COPY.useExample : picked ? HOME_COPY.keepTemplate : HOME_COPY.useTemplate}
        </Button>
      </div>
    </aside>
  );
}

/** 弹窗底部：有模板没能加载时一行克制的说明，展开看是哪个目录、为什么。 */
function Skipped({ diagnostics }: { diagnostics: readonly TemplateDiagnostic[] }) {
  if (!diagnostics.length) return null;
  return (
    <Disclosure isQuiet size="S">
      <DisclosureTitle>{HOME_COPY.templatesSkipped(diagnostics.length)}</DisclosureTitle>
      <DisclosurePanel>
        <ul className={skippedList}>
          {diagnostics.map((d) => (
            <li key={`${d.origin}:${d.dir}:${d.code}`}>
              {ST.templates.skipped(d.dir, d.message)}
              {d.issues.length ? ST.templates.issues(d.issues) : ''}
              <br />
              <span className={skippedPath}>{d.path}</span>
            </li>
          ))}
        </ul>
      </DisclosurePanel>
    </Disclosure>
  );
}

/**
 * 左右两栏：左边找（搜索、类型、来源、分类、分页的封面格子），右边看（当前这个的预览与提示词）。
 * 右栏不空着：没点过就看已选的那个；它不在的话看这一页的第一个。
 * 挂上时取一次目录（弹窗每次打开都重新挂上）；没取到过时显示加载中或失败（可重试），目录为空时如实说。
 */
function Library({ picked, onUse }: { picked: string | null; onUse(template: HomeTemplate): void }) {
  const catalog = useTemplateCatalogLoader();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<TemplateKind | 'all'>('all');
  const [source, setSource] = useState<TemplateSourceKey | 'all'>('all');
  const [category, setCategory] = useState('all');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(picked);
  const templates = catalog.templates;
  const sources = templateSources(templates);
  // 来源控件不在了（目录里只剩一种来源）时，之前选的来源不再生效。
  const sourceFilter = sources.some((s) => s.key === source) ? source : 'all';
  const view = pageOf(findTemplates(templates, query, { kind, source: sourceFilter, category }), page);
  const detail = templateOf(templates, open) ?? view.items[0] ?? null;
  const filter = (apply: () => void) => {
    apply();
    setPage(1);
  };

  let body;
  if (!catalog.loaded) {
    body =
      catalog.status === 'failed' ? (
        <div className={status} role="alert">
          <p className={quiet}>{HOME_COPY.templatesFailed(catalog.error ?? '')}</p>
          <Button variant="secondary" size="S" onPress={catalog.retry}>
            {HOME_COPY.retryTemplates}
          </Button>
        </div>
      ) : (
        <p className={empty} aria-live="polite">
          {HOME_COPY.templatesLoading}
        </p>
      );
  } else if (!templates.length) {
    body = <p className={empty}>{HOME_COPY.templatesEmpty}</p>;
  } else if (!view.total) {
    body = <p className={empty}>{HOME_COPY.noTemplates}</p>;
  } else {
    body = (
      <div className="bc-tpl-library__grid" role="list">
        {view.items.map((t) => (
          <div key={t.id} role="listitem">
            <Card template={t} current={detail?.id === t.id} picked={picked === t.id} onOpen={() => setOpen(t.id)} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={`bc-tpl-library ${libraryVars}`}>
      <div className="bc-tpl-library__browse">
        <div className={bar}>
          <SearchField
            aria-label={HOME_COPY.searchTemplates}
            placeholder={HOME_COPY.searchTemplates}
            styles={search}
            value={query}
            onChange={(value) => filter(() => setQuery(value))}
          />
          <span className={filters}>
            <SegmentedControl
              aria-label={HOME_COPY.templateKind}
              selectedKey={kind}
              onSelectionChange={(key) => filter(() => setKind(key as TemplateKind | 'all'))}>
              {TEMPLATE_KINDS_FILTER.map((k) => (
                <SegmentedControlItem key={k.key} id={k.key}>
                  {k.label}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
            {sources.length ? (
              <Picker
                aria-label={HOME_COPY.templateSource}
                size="M"
                styles={sourcePicker}
                selectedKey={sourceFilter}
                onSelectionChange={(key) => filter(() => setSource(String(key) as TemplateSourceKey | 'all'))}>
                {sources.map((s) => (
                  <PickerItem key={s.key} id={s.key}>
                    {s.label}
                  </PickerItem>
                ))}
              </Picker>
            ) : null}
          </span>
        </div>
        <div className={cats} role="group" aria-label={HOME_COPY.templateCategories}>
          {templateCategories(templates).map((c) => (
            <ToggleButton key={c.key} isQuiet size="S" isSelected={category === c.key} onChange={() => filter(() => setCategory(c.key))}>
              <Text>{`${c.label} ${findTemplates(templates, query, { kind, source: sourceFilter, category: c.key }).length}`}</Text>
            </ToggleButton>
          ))}
        </div>
        <div className="bc-tpl-library__list bc-scroll">{body}</div>
        <div className={pager}>
          <span className={quiet} aria-live="polite">
            {HOME_COPY.templatePage(view.page, view.pages, view.total)}
          </span>
          <span className={spacer} />
          <ActionButton isQuiet size="S" isDisabled={view.page <= 1} onPress={() => setPage(view.page - 1)}>
            {HOME_COPY.prevPage}
          </ActionButton>
          <ActionButton isQuiet size="S" isDisabled={view.page >= view.pages} onPress={() => setPage(view.page + 1)}>
            {HOME_COPY.nextPage}
          </ActionButton>
        </div>
        <p className={quiet}>{HOME_COPY.templatesNote}</p>
        <Skipped diagnostics={catalog.diagnostics} />
      </div>
      {detail ? (
        <Detail key={detail.id} template={detail} picked={picked === detail.id} onUse={onUse} />
      ) : (
        <aside className="bc-tpl-library__pane" data-empty>
          <p className={empty}>{HOME_COPY.pickTemplateHint}</p>
        </aside>
      )}
    </div>
  );
}

/**
 * 「全部模板」弹窗（产品设计 §3.2.1；原型 home-templates.jsx `HomeTemplateLibrary`）。
 * 关掉再打开，从第一页重新开始（Library 的状态跟着内容一起卸载）。
 */
export function TemplateLibrary({
  open,
  picked,
  onUse,
  onClose,
}: {
  open: boolean;
  picked: string | null;
  onUse(template: HomeTemplate): void;
  onClose(): void;
}) {
  return (
    <DialogContainer onDismiss={onClose}>
      {open ? (
        <Dialog size="XL">
          <Heading slot="title">{HOME_COPY.allTemplates}</Heading>
          <Content>
            <Library picked={picked} onUse={onUse} />
          </Content>
        </Dialog>
      ) : null}
    </DialogContainer>
  );
}
