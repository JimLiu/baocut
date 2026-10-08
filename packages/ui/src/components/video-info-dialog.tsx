import { useRef, useState } from 'react';
import { live, type SpaceEntry } from '@baocut/protocol';
import { Button, ButtonGroup, Content, Dialog, DialogContainer, Heading, TextArea, TextField, ToastQueue } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { S } from './shell-copy.ts';
import { entryPath } from '../model/space.ts';
import { copyText, elideMiddle, entryFacts, HERO_NAME_MAX, heroLine, sections, type InfoRow, type VideoInfoFacts } from '../model/video-info.ts';

/**
 * 视频详情框（设计稿 project-info.jsx）：hero、只读的分区行、可编辑项，页脚「复制全部」与「完成」。行的装配在
 * model/video-info.ts，这里只管画与名字的提交。编辑器顶栏的 ⓘ（editor/video-info.tsx）与 Space 的「视频详情…」共用。
 *
 * 只有名字能改（编辑器那条路，`renameVideo`）：失焦、回车或点「完成」时提交一次，不是每敲一个字一笔修改；空的或没改的
 * 还原。按 Esc 关掉时丢掉没提交的草稿。简介、备注没有地方存，置灰写明原因。
 * 不放「在文件夹中显示」「重新关联媒体」：前者在视频栏的菜单里，后者是缺媒体时的事。
 */
export const VIDEO_INFO_COPY = live(() => S.videoInfo);
const C = VIDEO_INFO_COPY;

const body = style({ display: 'flex', flexDirection: 'column', minWidth: 0 });
const hero = style({ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 });
const heroTitle = style({ font: 'title', color: 'gray-900', margin: 0, lineClamp: 2, overflowWrap: 'anywhere', userSelect: 'text' });
const heroSub = style({ font: 'ui-sm', color: 'gray-600', whiteSpace: 'nowrap', overflow: 'hidden', userSelect: 'text' });
const section = style({ marginTop: 16, display: 'flex', flexDirection: 'column', minWidth: 0 });
const sectionTitle = style({ font: 'detail', fontWeight: 'bold', color: 'gray-600', margin: 0, marginBottom: 4 });
const rows = style({ display: 'flex', flexDirection: 'column', margin: 0 });
const rowLine = style({ display: 'flex', alignItems: 'baseline', gap: 12, paddingY: 4, minWidth: 0 });
const label = style({ font: 'ui-sm', color: 'gray-600', width: 64, flexShrink: 0, margin: 0 });
const value = style({
  font: { default: 'ui-sm', isMono: 'code-xs' },
  color: 'gray-900',
  margin: 0,
  minWidth: 0,
  flexGrow: 1,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  userSelect: 'text',
});
const form = style({ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 });
const full = style({ width: 'full' });

export interface VideoInfoDialogProps {
  facts: VideoInfoFacts;
  /** 编辑器那条路多出来的行（内容、译文）。 */
  extras?: readonly InfoRow[];
  /** 改名；成功返回 true。不给时名称置灰。 */
  onRename?: (name: string) => Promise<boolean>;
  /** 名称不能改的原因（置灰时写在下面）。 */
  renameNote?: string | null;
  onClose(): void;
}

export function VideoInfoDialog({ facts, extras = [], onRename, renameNote = null, onClose }: VideoInfoDialogProps) {
  // 状态放在对话框外层：S2 的 Dialog 会把 children 在几个 slot 里各渲染一遍。
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<Promise<boolean> | null>(null);
  const list = sections(facts, extras);
  const heroText = heroLine(facts.source);

  /** 提交名字的草稿；没有草稿、空的或没改时还原并当作成功。失败时留着草稿，错误由改名的一方提示。 */
  const commit = (): Promise<boolean> => {
    if (pending.current) return pending.current;
    if (draft === null) return Promise.resolve(true);
    const next = draft.trim();
    if (!next || next === facts.title || !onRename) {
      setDraft(null);
      return Promise.resolve(true);
    }
    setBusy(true);
    const run = onRename(next)
      .then(
        (ok) => {
          if (ok) setDraft(null);
          return ok;
        },
        (error: Error) => {
          ToastQueue.negative(C.renameFailed(error.message), { timeout: 5000 });
          return false;
        },
      )
      .finally(() => {
        pending.current = null;
        setBusy(false);
      });
    pending.current = run;
    return run;
  };

  const copyAll = () => {
    navigator.clipboard.writeText(copyText(facts.title, heroText, list)).then(
      () => ToastQueue.positive(C.copied, { timeout: 3000 }),
      () => ToastQueue.negative(C.copyFailed, { timeout: 4000 }),
    );
  };

  return (
    <DialogContainer onDismiss={onClose}>
      <Dialog size="M">
        {({ close }) => (
          <>
            <Heading slot="title">{C.title}</Heading>
            <Content>
              <div className={body}>
                <div className={hero}>
                  <p className={heroTitle} title={facts.title}>
                    {facts.title}
                  </p>
                  {heroText ? (
                    <span className={heroSub} title={heroText}>
                      {[facts.source?.kind, facts.source?.fileName ? elideMiddle(facts.source.fileName.trim(), HERO_NAME_MAX) : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  ) : null}
                </div>
                {list.map((s) => (
                  <section key={s.title} className={section} aria-label={s.title}>
                    <h3 className={sectionTitle}>{s.title}</h3>
                    <dl className={rows}>
                      {s.rows.map((r) => (
                        <div key={r.label} className={rowLine}>
                          <dt className={label}>{r.label}</dt>
                          <dd className={value({ isMono: r.mono })}>{r.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))}
                <div className={form}>
                  <TextField
                    label={C.name}
                    styles={full}
                    value={draft ?? facts.title}
                    onChange={setDraft}
                    onBlur={() => void commit()}
                    onKeyDown={(event) => {
                      // 输入法选字时的回车不算提交。
                      if (event.key === 'Enter' && !event.nativeEvent.isComposing) void commit();
                      else event.continuePropagation();
                    }}
                    isDisabled={!onRename}
                    description={onRename ? undefined : (renameNote ?? undefined)}
                    maxLength={120}
                  />
                  <TextArea label={C.summary} styles={full} isDisabled description={C.notSaved} />
                  <TextArea label={C.notes} styles={full} isDisabled description={C.notSaved} />
                </div>
              </div>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={copyAll}>
                {C.copyAll}
              </Button>
              <Button
                variant="accent"
                isPending={busy}
                onPress={() => {
                  void commit().then((ok) => ok && close());
                }}>
                {C.done}
              </Button>
            </ButtonGroup>
          </>
        )}
      </Dialog>
    </DialogContainer>
  );
}

/** Space 那条路：只有条目记录，没有的行省略；名字不在这里改（Space 的「重命名」改的是显示名）。 */
export function SpaceVideoInfo({ entry, dirs, onClose }: { entry: SpaceEntry; dirs: Parameters<typeof entryPath>[1]; onClose(): void }) {
  return <VideoInfoDialog facts={entryFacts(entry, entry.name, entryPath(entry, dirs))} renameNote={C.renameInEditor} onClose={onClose} />;
}
