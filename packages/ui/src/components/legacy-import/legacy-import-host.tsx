import { useEffect, useState } from 'react';
import type { LegacyImportPrompt } from '@baocut/protocol';
import { ActionButton, Button, ButtonGroup, Checkbox, Content, Dialog, DialogContainer, Footer, Heading, Text, ToastQueue } from '@react-spectrum/s2';
import Folder from '@react-spectrum/s2/icons/Folder';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { agoLabel } from '../../model/format.ts';
import { displayDirectory, legacyImportDecision, type LegacyImportChoice } from '../../model/legacy-import.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useConnection } from '../../state/connection-store.ts';
import { LI } from './legacy-import-copy.ts';

/*
 * 启动时的旧版项目导入询问（设计稿 legacy-import.jsx；架构设计 §2.7）：挂在外壳根上。Runtime 发现还没导入的旧版项目、
 * 又没有记下决定时在 `legacy-import` 主题上给出询问，这里问一次：
 * - 要不要导入：「导入」带焦点，Enter 直接导入；「跳过」与关掉对话框都是这次不导入——不发请求，这次启动不再弹，下次启动再问。
 * - 导入到哪：默认是 Runtime 给的系统文稿 / 文档文件夹下的 `BaoCut`，「更改…」交给系统的文件夹选择器。
 * - 不再提醒：Footer 里的勾选框；勾着跳过就回答 `never`，Runtime 记下，以后不再导入。
 * Web 没有这个询问：远端浏览器选不了本机目录，主题与方法也不在 Web 服务的白名单里。
 */

const TOAST_TIMEOUT = 5000;

/** 这次启动（这个界面进程）里点过「跳过」：Runtime 重启换了询问也不再弹，下次启动再问。 */
let skippedThisLaunch = false;

const lead = style({ margin: 0, font: 'body', color: 'gray-800' });
const list = style({
  listStyleType: 'none',
  marginTop: 12,
  marginBottom: 0,
  marginX: 0,
  paddingY: 4,
  paddingX: 0,
  maxHeight: 160,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  borderRadius: 'default',
  backgroundColor: 'gray-100',
});
const item = style({ display: 'flex', alignItems: 'baseline', gap: 12, paddingX: 12, paddingY: 4 });
const itemName = style({ flexGrow: 1, minWidth: 0, font: 'ui-sm', color: 'gray-900', truncate: true });
const itemWhen = style({ flexShrink: 0, font: 'ui-sm', color: 'gray-600' });
const dest = style({ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 4 });
const destLabel = style({ font: 'ui-sm', fontWeight: 'bold', color: 'gray-700' });
const pathRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 40,
  paddingStart: 12,
  paddingEnd: 4,
  borderWidth: 2,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: 'default',
  color: 'gray-700',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const pathText = style({ flexGrow: 1, minWidth: 0, font: 'code-xs', color: 'gray-900', truncate: true, userSelect: 'text' });
const note = style({ margin: 0, font: 'ui-sm', color: 'gray-600' });
const hint = style({ marginTop: 12, marginBottom: 0, font: 'ui-sm', color: 'gray-600' });

export function LegacyImportHost() {
  const runtime = useRuntime();
  const web = runtime.host.platform === 'web';
  const connected = useConnection((s) => s.state.status === 'connected');
  const [prompt, setPrompt] = useState<LegacyImportPrompt | null>(null);
  const [skipped, setSkipped] = useState(skippedThisLaunch);
  // 回答成功到 Runtime 推来「询问没了」之间，这一问不再显示，免得再点一次。
  const [answered, setAnswered] = useState<string | null>(null);

  useEffect(() => {
    if (web) return;
    return runtime.watchLegacyImport(setPrompt);
  }, [runtime, web]);

  if (web || !connected || !prompt || skipped || prompt.promptId === answered) return null;
  return (
    <LegacyImportDialog
      key={prompt.promptId}
      prompt={prompt}
      onSkip={() => {
        skippedThisLaunch = true;
        setSkipped(true);
      }}
      onAnswered={() => setAnswered(prompt.promptId)}
    />
  );
}

function LegacyImportDialog({ prompt, onSkip, onAnswered }: { prompt: LegacyImportPrompt; onSkip(): void; onAnswered(): void }) {
  const runtime = useRuntime();
  const platform = runtime.host.platform;
  // 状态放在对话框外层：S2 的 Dialog 会把 children 在几个 slot 里各渲染一遍。每次弹出都从默认值开始。
  const [directory, setDirectory] = useState(prompt.defaultDirectory);
  const [never, setNever] = useState(false);
  const [busy, setBusy] = useState(false);
  const count = prompt.projects.length;
  const shown = displayDirectory(directory, platform);

  const answer = async (choice: LegacyImportChoice) => {
    if (busy) return;
    const decision = legacyImportDecision(choice, never);
    if (decision === null) {
      onSkip();
      ToastQueue.neutral(LI.skipped, { timeout: TOAST_TIMEOUT });
      return;
    }
    setBusy(true);
    try {
      await runtime.answerLegacyImport(
        decision === 'import' ? { promptId: prompt.promptId, decision, directory } : { promptId: prompt.promptId, decision },
      );
      onAnswered();
      if (decision === 'import') ToastQueue.info(LI.importing(count), { timeout: TOAST_TIMEOUT });
      else ToastQueue.neutral(LI.neverDone, { timeout: TOAST_TIMEOUT });
    } catch (error) {
      // 目录建不了、写不了，或询问已经不在：留在对话框里，换个目录再试。
      ToastQueue.negative(LI.failed(error instanceof Error ? error.message : String(error)), { timeout: TOAST_TIMEOUT });
      setBusy(false);
    }
  };

  const pick = async () => {
    const picked = await runtime.host.pickDirectory({ title: LI.pickTitle });
    if (picked) setDirectory(picked);
  };

  return (
    <DialogContainer onDismiss={() => void answer('skip')}>
      <Dialog size="M">
        <Heading slot="title">{LI.title}</Heading>
        <Content>
          <p className={lead}>{LI.lead(count)}</p>
          <ul className={list} aria-label={LI.found}>
            {prompt.projects.map((p) => (
              <li key={p.path} className={item} title={p.path}>
                <span className={itemName}>{p.title}</span>
                {p.editedAt ? <span className={itemWhen}>{agoLabel(p.editedAt)}</span> : null}
              </li>
            ))}
          </ul>
          <div className={dest}>
            <span className={destLabel}>{LI.destination}</span>
            <div className={pathRow}>
              <Folder aria-hidden />
              <span className={pathText} title={directory}>
                {shown}
              </span>
              {directory !== prompt.defaultDirectory ? (
                <ActionButton isQuiet size="S" isDisabled={busy} onPress={() => setDirectory(prompt.defaultDirectory)}>
                  <Text>{LI.resetDefault}</Text>
                </ActionButton>
              ) : null}
              <ActionButton isQuiet size="S" isDisabled={busy} onPress={() => void pick()}>
                <Text>{LI.change}</Text>
              </ActionButton>
            </div>
            <p className={note}>{LI.destinationNote}</p>
          </div>
          <p className={hint}>{LI.hint}</p>
        </Content>
        <Footer>
          <Checkbox isSelected={never} onChange={setNever} isDisabled={busy}>
            {LI.never}
          </Checkbox>
        </Footer>
        <ButtonGroup>
          <Button variant="secondary" isDisabled={busy} onPress={() => void answer('skip')}>
            {LI.skip}
          </Button>
          <Button variant="accent" autoFocus isPending={busy} onPress={() => void answer('import')}>
            {LI.import}
          </Button>
        </ButtonGroup>
      </Dialog>
    </DialogContainer>
  );
}
