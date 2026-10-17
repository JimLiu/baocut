import { useEffect, useState } from 'react';
import { Button, ButtonGroup, Content, Dialog, DialogContainer, Form, Heading, TextArea, TextField } from '@react-spectrum/s2';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { skillErrorMessage } from '../../model/agent-skills.ts';
import { SKILL_GITHUB_COPY } from '../settings/agent-copy.ts';
import { BLANK_COPY } from './skills-copy.ts';

const note = style({
  display: 'flex',
  alignItems: 'start',
  gap: 8,
  margin: 0,
  paddingY: 8,
  paddingX: 12,
  borderRadius: 'default',
  backgroundColor: 'gray-100',
  font: 'ui-sm',
  color: 'gray-800',
});
const noteIcon = style({ display: 'flex', flexShrink: 0, color: 'gray-700' });
const formNote = style({ marginTop: 16 });
const full = style({ width: 'full' });

/** 从 GitHub 导入（原型 settings-skill-install.jsx）：只下载那个目录下的文件、不执行，归「第三方」，默认关。 */
export function GithubImportDialog({ open, onImport, onClose }: { open: boolean; onImport(url: string): Promise<void>; onClose(): void }) {
  const [url, setUrl] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setUrl('');
    setError(null);
  }, [open]);

  const submit = async () => {
    if (!url.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      await onImport(url.trim());
    } catch (e) {
      setError(skillErrorMessage(e, 'import'));
    } finally {
      setPending(false);
    }
  };

  return (
    <DialogContainer onDismiss={onClose}>
      {open ? (
        <Dialog size="M">
          {({ close }) => (
            <>
              <Heading slot="title">{SKILL_GITHUB_COPY.title}</Heading>
              <Content>
                <Form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submit();
                  }}>
                  <TextField
                    label={SKILL_GITHUB_COPY.label}
                    placeholder={SKILL_GITHUB_COPY.placeholder}
                    description={pending ? SKILL_GITHUB_COPY.pending : SKILL_GITHUB_COPY.description}
                    value={url}
                    onChange={(value) => {
                      setUrl(value);
                      setError(null);
                    }}
                    isReadOnly={pending}
                    isInvalid={!!error}
                    errorMessage={error ?? undefined}
                    styles={full}
                    autoFocus
                  />
                </Form>
                <div className={formNote}>
                  <p className={note} role="note">
                    <span className={noteIcon} aria-hidden>
                      <AlertTriangle />
                    </span>
                    <span>{SKILL_GITHUB_COPY.note}</span>
                  </p>
                </div>
              </Content>
              <ButtonGroup>
                <Button variant="secondary" onPress={close}>
                  {SKILL_GITHUB_COPY.cancel}
                </Button>
                <Button variant="accent" isDisabled={!url.trim()} isPending={pending} onPress={() => void submit()}>
                  {SKILL_GITHUB_COPY.submit}
                </Button>
              </ButtonGroup>
            </>
          )}
        </Dialog>
      ) : null}
    </DialogContainer>
  );
}

/**
 * 新建空白 skill（原型 page-skills-upload.jsx `SkillBlankDialog`）：名字与「什么时候用」，正文是按界面语言给的模板；
 * id 由 Runtime 按名字规范化（占用时加 `-2`…）。
 */
export function SkillBlankDialog({
  open,
  onCreate,
  onClose,
}: {
  open: boolean;
  onCreate(params: { name: string; description: string; body: string }): Promise<void>;
  onClose(): void;
}) {
  const [name, setName] = useState('');
  const [when, setWhen] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setName('');
    setWhen('');
    setError(null);
  }, [open]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(BLANK_COPY.nameRequired);
      return;
    }
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await onCreate({ name: trimmed, description: when.trim() || BLANK_COPY.whenDefault, body: BLANK_COPY.body(trimmed) });
    } catch (e) {
      setError(skillErrorMessage(e, 'create'));
    } finally {
      setPending(false);
    }
  };

  return (
    <DialogContainer onDismiss={onClose}>
      {open ? (
        <Dialog size="M">
          {({ close }) => (
            <>
              <Heading slot="title">{BLANK_COPY.title}</Heading>
              <Content>
                <Form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submit();
                  }}>
                  <TextField
                    label={BLANK_COPY.name}
                    placeholder={BLANK_COPY.namePlaceholder}
                    value={name}
                    onChange={(value) => {
                      setName(value);
                      setError(null);
                    }}
                    isInvalid={!!error}
                    errorMessage={error ?? undefined}
                    styles={full}
                    autoFocus
                  />
                  <TextArea label={BLANK_COPY.when} placeholder={BLANK_COPY.whenPlaceholder} value={when} onChange={setWhen} styles={full} />
                </Form>
              </Content>
              <ButtonGroup>
                <Button variant="secondary" onPress={close}>
                  {BLANK_COPY.cancel}
                </Button>
                <Button variant="accent" isPending={pending} onPress={() => void submit()}>
                  {BLANK_COPY.create}
                </Button>
              </ButtonGroup>
            </>
          )}
        </Dialog>
      ) : null}
    </DialogContainer>
  );
}
