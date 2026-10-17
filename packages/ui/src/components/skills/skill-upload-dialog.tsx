import { useEffect, useState } from 'react';
import type { SkillInstallResult, SkillPackageCandidate, SkillPackageInspection, SkillPackagePick } from '@baocut/protocol';
import {
  Button,
  ButtonGroup,
  Checkbox,
  Content,
  Dialog,
  DialogContainer,
  Heading,
  ProgressCircle,
  Radio,
  RadioGroup,
  Text,
} from '@react-spectrum/s2';
import FolderOpen from '@react-spectrum/s2/icons/FolderOpen';
import Upload from '@react-spectrum/s2/icons/Upload';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { fileSizeLabel, skillDisplayName, skillErrorMessage } from '../../model/agent-skills.ts';
import { defaultPicks } from '../../model/skills-page.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { inspectSkillPackage, installSkillPackage } from '../../runtime/skill-commands.ts';
import { Note } from './skill-files.tsx';
import { UPLOAD_COPY } from './skills-copy.ts';

const body = style({ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 });
const intro = style({ margin: 0, font: 'body-sm', color: 'gray-800' });
const choose = style({ display: 'flex', flexWrap: 'wrap', gap: 8 });
const quiet = style({ margin: 0, font: 'ui-sm', color: 'gray-600', overflowWrap: 'anywhere' });
const error = style({ margin: 0, font: 'ui-sm', color: 'negative' });
const list = style({ display: 'flex', flexDirection: 'column', gap: 12, margin: 0, padding: 0, listStyleType: 'none' });
const item = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '[6px]',
  padding: 12,
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const desc = style({ margin: 0, paddingStart: 28, font: 'ui-sm', color: 'gray-700', overflowWrap: 'anywhere' });
const meta = style({ margin: 0, paddingStart: 28, font: 'ui-xs', color: 'gray-600' });
const sub = style({ paddingStart: 28 });
const heading = style({ margin: 0, font: 'ui-sm', fontWeight: 'bold', color: 'gray-700' });
const done = style({ display: 'flex', flexDirection: 'column', gap: 8, margin: 0, padding: 0, listStyleType: 'none' });
const doneLine = style({ font: 'ui-sm', color: 'gray-800', overflowWrap: 'anywhere', userSelect: 'text' });

type Step =
  | { kind: 'choose'; error?: string }
  | { kind: 'reading'; path: string }
  | { kind: 'picking'; path: string; inspection: SkillPackageInspection }
  | { kind: 'done'; result: SkillInstallResult };

/**
 * 上传 zip 或文件夹（产品设计 §6.9「上传」，原型 page-skills-upload.jsx）：先认包（`skills.inspectPackage`）、列出候选，
 * 勾选装哪几个、重名时选更新还是另存为副本，再装（`skills.installPackage`）；装完写明各自放在哪里。
 * 拖到页面上的 zip 或文件夹由 `path` 带进来，直接从认包开始。只在桌面端出现。
 */
export function SkillUploadDialog({ open, path, onClose }: { open: boolean; path: string | null; onClose(): void }) {
  const runtime = useRuntime();
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const [picks, setPicks] = useState<SkillPackagePick[]>([]);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  const read = async (target: string) => {
    setStep({ kind: 'reading', path: target });
    setInstallError(null);
    try {
      const inspection = await inspectSkillPackage(runtime, target);
      setPicks(defaultPicks(inspection));
      setStep({ kind: 'picking', path: target, inspection });
    } catch (e) {
      setStep({ kind: 'choose', error: skillErrorMessage(e, 'upload') });
    }
  };

  useEffect(() => {
    if (!open) return;
    setPicks([]);
    setInstalling(false);
    setInstallError(null);
    if (path) void read(path);
    else setStep({ kind: 'choose' });
    // 打开时按带进来的路径开始；read 每次渲染都是新的。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, path]);

  const pickZip = async () => {
    const [file] = (await runtime.host.pickFiles?.({ filters: [{ name: UPLOAD_COPY.zipFilter, extensions: ['zip'] }] })) ?? [];
    if (file) void read(file);
  };
  const pickFolder = async () => {
    const dir = await runtime.host.pickDirectory({ title: UPLOAD_COPY.pickFolder });
    if (dir) void read(dir);
  };

  const install = async () => {
    if (step.kind !== 'picking' || !picks.length) return;
    setInstalling(true);
    setInstallError(null);
    try {
      const result = await installSkillPackage(runtime, step.path, picks);
      setStep({ kind: 'done', result });
    } catch (e) {
      setInstallError(skillErrorMessage(e, 'upload'));
    } finally {
      setInstalling(false);
    }
  };

  const toggle = (c: SkillPackageCandidate, on: boolean) =>
    setPicks((list) =>
      on
        ? [...list.filter((p) => p.prefix !== c.prefix), { prefix: c.prefix, mode: c.conflict ? (c.conflict.canUpdate ? 'update' : 'copy') : 'new' }]
        : list.filter((p) => p.prefix !== c.prefix),
    );
  const setMode = (c: SkillPackageCandidate, mode: 'update' | 'copy') =>
    setPicks((list) => list.map((p) => (p.prefix === c.prefix ? { ...p, mode } : p)));

  const chooser = (
    <div className={choose}>
      <Button variant="secondary" onPress={() => void pickZip()} isDisabled={!runtime.host.pickFiles}>
        <Upload />
        <Text>{UPLOAD_COPY.pickZip}</Text>
      </Button>
      <Button variant="secondary" onPress={() => void pickFolder()}>
        <FolderOpen />
        <Text>{UPLOAD_COPY.pickFolder}</Text>
      </Button>
    </div>
  );

  let content;
  if (step.kind === 'choose') {
    content = (
      <div className={body}>
        <p className={intro}>{UPLOAD_COPY.intro}</p>
        {chooser}
        {step.error ? <p className={error}>{step.error}</p> : null}
      </div>
    );
  } else if (step.kind === 'reading') {
    content = (
      <div className={body} role="status">
        <ProgressCircle isIndeterminate size="S" aria-label={UPLOAD_COPY.reading} />
        <p className={quiet}>{step.path}</p>
      </div>
    );
  } else if (step.kind === 'picking') {
    const { inspection } = step;
    const picked = (c: SkillPackageCandidate) => picks.find((p) => p.prefix === c.prefix);
    const withScripts = inspection.candidates.some((c) => picked(c) && c.scripts > 0);
    content = (
      <div className={body}>
        <p className={quiet}>{inspection.name}</p>
        {inspection.ignored.length ? <p className={quiet}>{UPLOAD_COPY.ignored(inspection.ignored.join(', '))}</p> : null}
        <h3 className={heading}>{UPLOAD_COPY.candidates}</h3>
        <ul className={list}>
          {inspection.candidates.map((c) => {
            const pick = picked(c);
            return (
              <li key={c.prefix || '.'} className={item}>
                <Checkbox isSelected={!!pick} isDisabled={!!c.issue} onChange={(on) => toggle(c, on)}>
                  {c.name}
                </Checkbox>
                {c.description ? <p className={desc}>{c.description}</p> : null}
                <p className={meta}>
                  {[
                    UPLOAD_COPY.meta(c.fileCount, fileSizeLabel(c.bytes)),
                    c.assets ? UPLOAD_COPY.assets(c.assets) : null,
                    c.scripts ? UPLOAD_COPY.scripts(c.scripts) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {c.issue ? <p className={`${desc} ${error}`}>{UPLOAD_COPY.issue[c.issue.code] ?? c.issue.message}</p> : null}
                {!c.issue && c.conflict ? (
                  c.conflict.canUpdate ? (
                    <div className={sub}>
                      <p className={quiet}>{UPLOAD_COPY.conflictPersonal(c.conflict.id, c.conflict.nextRevision)}</p>
                      <RadioGroup
                        aria-label={UPLOAD_COPY.modeLabel}
                        isDisabled={!pick}
                        value={pick?.mode === 'copy' ? 'copy' : 'update'}
                        onChange={(value) => setMode(c, value as 'update' | 'copy')}>
                        <Radio value="update">{UPLOAD_COPY.update(c.conflict.nextRevision)}</Radio>
                        <Radio value="copy">{UPLOAD_COPY.copy(c.conflict.copyId)}</Radio>
                      </RadioGroup>
                    </div>
                  ) : (
                    <p className={desc}>{UPLOAD_COPY.conflictOther(c.conflict.id, c.conflict.copyId)}</p>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
        {withScripts ? <Note>{UPLOAD_COPY.scriptsNote}</Note> : null}
        {installError ? <p className={error}>{installError}</p> : null}
      </div>
    );
  } else {
    content = (
      <div className={body}>
        <ul className={done}>
          {step.result.installed.map((s) => (
            <li key={s.id} className={doneLine}>
              {UPLOAD_COPY.doneLine(skillDisplayName(s), s.path)}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <DialogContainer onDismiss={onClose}>
      {open ? (
        <Dialog size="L">
          {({ close }) => (
            <>
              <Heading slot="title">{step.kind === 'done' ? UPLOAD_COPY.doneTitle : UPLOAD_COPY.title}</Heading>
              <Content>{content}</Content>
              <ButtonGroup>
                {step.kind === 'done' ? (
                  <Button variant="accent" onPress={close}>
                    {UPLOAD_COPY.close}
                  </Button>
                ) : (
                  <>
                    <Button variant="secondary" onPress={close}>
                      {UPLOAD_COPY.cancel}
                    </Button>
                    {step.kind === 'picking' ? (
                      <Button variant="accent" isDisabled={!picks.length} isPending={installing} onPress={() => void install()}>
                        {UPLOAD_COPY.install(picks.length)}
                      </Button>
                    ) : null}
                  </>
                )}
              </ButtonGroup>
            </>
          )}
        </Dialog>
      ) : null}
    </DialogContainer>
  );
}
