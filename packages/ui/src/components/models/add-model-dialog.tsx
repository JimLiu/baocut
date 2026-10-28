import { useEffect, useMemo, useState } from 'react';
import type { AudioCppAddableFamily, ModelAddParams, ModelBundleStatus, RpcMethods } from '@baocut/protocol';
import {
  Badge,
  Button,
  ButtonGroup,
  Content,
  Dialog,
  DialogContainer,
  Heading,
  Picker,
  PickerItem,
  ProgressCircle,
  Radio,
  RadioGroup,
  SearchField,
  SegmentedControl,
  SegmentedControlItem,
  Text,
  TextField,
} from '@react-spectrum/s2';
import AddIcon from '@react-spectrum/s2/icons/Add';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  addressHint,
  baseName,
  customParams,
  familyState,
  firstPackage,
  groupCount,
  idleText,
  licenseFlag,
  licenseLine,
  packageName,
  packagesNamed,
  precisionLabel,
  searchFamilies,
  statusLabel,
  tasksLine,
  traitsLine,
  type AddGroup,
  type AddTab,
  type CustomForm,
  type CustomProblem,
} from '../../model/models-added.ts';
import { M } from '../../model/models-added-copy.ts';
import { problemText, rpcProblem } from '../../model/models-install.ts';
import { fmtSize } from '../../model/task-facts.ts';
import { useRuntime } from '../../runtime/context.tsx';

export type Addable = RpcMethods['models.addable']['result'];

const lede = style({ marginTop: 0, marginBottom: 16, font: 'ui-sm', color: 'gray-800' });
const searchRow = style({ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, marginBottom: 8 });
const searchField = style({ flexGrow: 1 });
const count = style({ flexShrink: 0, font: 'ui-xs', color: 'gray-600' });
const list = style({ listStyleType: 'none', margin: 0, padding: 0 });
const familyRow = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 12,
  paddingY: 12,
  borderTopWidth: 0,
  borderXWidth: 0,
  borderBottomWidth: { default: 1, ':last-child': 0 },
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
const familyText = style({ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, flexBasis: 0, minWidth: 240 });
const familyName = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, font: 'ui', fontWeight: 'medium', color: 'gray-900' });
const detail = style({ font: 'ui-sm', color: 'gray-700', overflowWrap: 'anywhere' });
const detailXs = style({ font: 'ui-xs', color: 'gray-600', overflowWrap: 'anywhere' });
const familyActions = style({ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 });
const empty = style({ display: 'flex', flexDirection: 'column', alignItems: 'start', gap: 8, paddingY: 16 });
const status = style({ display: 'flex', alignItems: 'center', gap: 8, paddingY: 24, font: 'ui-sm', color: 'gray-700' });
const failure = style({ marginTop: 8, marginBottom: 0, font: 'ui-sm', color: 'negative-900', overflowWrap: 'anywhere' });
const formStack = style({ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 });
const full = style({ width: 'full' });
const fileRow = style({ display: 'flex', alignItems: 'end', gap: 8 });
const fileField = style({ flexGrow: 1 });

/** 自己指定文件时先选好的族（设计稿 `CUSTOM_FAM`）；目录里没有时不预选。 */
const DEFAULT_CUSTOM_FAMILY = 'qwen3_tts';

/** 读 `models.addable`：打开对话框与能力页的入口一行都用；`enabled` 为 false（浏览器）时不读。 */
export function useAddable(enabled: boolean): { data: Addable | null; error: string | null; reload: () => void } {
  const runtime = useRuntime();
  const [data, setData] = useState<Addable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    runtime.listAddableModels().then(
      (result) => {
        if (!live) return;
        setData(result);
        setError(null);
      },
      (err) => {
        if (live) setError(problemText(rpcProblem(err)));
      },
    );
    return () => {
      live = false;
    };
  }, [runtime, enabled, tick]);
  return { data, error, reload: () => setTick((n) => n + 1) };
}

/**
 * 添加 audio.cpp 模型（设计稿 settings-add-model.jsx；架构设计 §6.3）。按组、可搜索的目录：每一族一行，选精度后「添加」；
 * 「暂时用不上」的写原因、不给按钮；「自己指定文件」加 Hugging Face 上或这台电脑上的一个 .gguf（本机文件原地引用、不复制）。
 * `group`：打开它的能力页（语音合成 / 音乐生成），决定先看哪一组。加好后 `onAdded` 交回新的模型包，由页面关掉对话框、接着下载。
 */
export function AddModelDialog({
  group: initial,
  addable,
  loadError,
  onClose,
  onAdded,
}: {
  group: AddGroup;
  addable: Addable | null;
  loadError: string | null;
  onClose: () => void;
  onAdded: (bundle: ModelBundleStatus, params: ModelAddParams) => void;
}) {
  const runtime = useRuntime();
  const [tab, setTab] = useState<AddTab>(initial);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const families = addable?.families ?? [];
  const custom = tab === 'custom';
  const rows = useMemo(() => (custom ? [] : searchFamilies(families, query, tab as AddGroup)), [families, query, tab, custom]);
  const customFamilies = useMemo(() => {
    const ids = new Set(addable?.custom ?? []);
    return families.filter((f) => ids.has(f.family)).sort((a, b) => a.name.localeCompare(b.name));
  }, [addable, families]);
  const [form, setForm] = useState<CustomForm>({ source: 'repo-file', address: '', path: '', family: null, label: '' });
  const [tried, setTried] = useState(false);
  const family = form.family ?? (customFamilies.some((f) => f.family === DEFAULT_CUSTOM_FAMILY) ? DEFAULT_CUSTOM_FAMILY : null);
  const filled = { ...form, family };
  const problems: CustomProblem[] = tried ? (customParams(filled).ok ? [] : (customParams(filled) as { problems: CustomProblem[] }).problems) : [];

  const add = async (key: string, params: ModelAddParams) => {
    if (pending) return;
    setPending(key);
    setFailed(null);
    try {
      const bundle = await runtime.addModel(params);
      onAdded(bundle, params);
    } catch (err) {
      setFailed(M.addFailed(problemText(rpcProblem(err))));
    } finally {
      setPending(null);
    }
  };

  const submitCustom = () => {
    setTried(true);
    const result = customParams(filled);
    if (result.ok) void add('custom', result.params);
  };

  const pickFile = async () => {
    const [path] = (await runtime.host.pickFiles?.({ title: M.pickTitle, filters: [{ name: M.pickFilter, extensions: ['gguf'] }] })) ?? [];
    if (path) setForm((f) => ({ ...f, path }));
  };

  const hint = addressHint(form.address, problems.includes('address'));
  const chosen = customFamilies.find((f) => f.family === family) ?? null;
  const placeholderName = baseName(form.source === 'local-file' ? form.path : (form.address.split(/[?#]/)[0] ?? '')) || M.namePlaceholder;

  return (
    <DialogContainer onDismiss={onClose}>
      <Dialog size="L">
        {({ close }) => (
          <>
            <Heading slot="title">{M.title}</Heading>
            <Content>
              <p className={lede}>{M.lede(addable?.engine ?? 'audio.cpp')}</p>
              <SegmentedControl aria-label={M.groupsLabel} selectedKey={tab} onSelectionChange={(key) => setTab(key as AddTab)}>
                {(['tts', 'music', 'idle'] as const).map((g) => (
                  <SegmentedControlItem key={g} id={g}>
                    {addable ? `${M.groups[g]} ${groupCount(families, g)}` : M.groups[g]}
                  </SegmentedControlItem>
                ))}
                <SegmentedControlItem id="custom">{M.groups.custom}</SegmentedControlItem>
              </SegmentedControl>
              {!addable ? (
                loadError ? (
                  <p className={failure}>{M.loadFailed(loadError)}</p>
                ) : (
                  <div className={status}>
                    <ProgressCircle size="S" isIndeterminate aria-label={M.loading} />
                    {M.loading}
                  </div>
                )
              ) : custom ? (
                <div className={formStack}>
                  <RadioGroup
                    label={M.sourceLabel}
                    orientation="horizontal"
                    value={form.source}
                    onChange={(v) => setForm((f) => ({ ...f, source: v as CustomForm['source'] }))}>
                    <Radio value="repo-file">{M.sourceRepo}</Radio>
                    {runtime.host.pickFiles ? <Radio value="local-file">{M.sourceLocal}</Radio> : null}
                  </RadioGroup>
                  {form.source === 'repo-file' ? (
                    <TextField
                      label={M.urlLabel}
                      placeholder={M.urlPlaceholder}
                      value={form.address}
                      onChange={(address) => setForm((f) => ({ ...f, address }))}
                      description={hint.help}
                      isInvalid={!!hint.error}
                      errorMessage={hint.error ?? undefined}
                      styles={full}
                      autoFocus
                    />
                  ) : (
                    <div className={fileRow}>
                      <TextField
                        label={M.fileLabel}
                        isReadOnly
                        value={form.path}
                        placeholder={M.filePlaceholder}
                        description={M.fileHelp}
                        isInvalid={problems.includes('file')}
                        errorMessage={M.fileRequired}
                        styles={fileField}
                      />
                      <Button variant="secondary" size="M" onPress={() => void pickFile()}>
                        {M.chooseFile}
                      </Button>
                    </div>
                  )}
                  <Picker
                    label={M.familyLabel}
                    selectedKey={family}
                    onSelectionChange={(key) => setForm((f) => ({ ...f, family: key === null ? null : String(key) }))}
                    description={chosen ? M.familyHelp([tasksLine(['tts']), traitsLine(chosen) || chosen.name].join(' · ')) : M.familyHelpNone}
                    isInvalid={problems.includes('family')}
                    errorMessage={M.familyRequired}
                    styles={full}>
                    {customFamilies.map((f) => (
                      <PickerItem key={f.family} id={f.family} textValue={f.name}>
                        <Text slot="label">{f.name}</Text>
                      </PickerItem>
                    ))}
                  </Picker>
                  <TextField
                    label={M.nameLabel}
                    placeholder={placeholderName}
                    value={form.label}
                    onChange={(label) => setForm((f) => ({ ...f, label }))}
                    styles={full}
                  />
                  {failed ? <p className={failure}>{failed}</p> : null}
                </div>
              ) : (
                <>
                  <div className={searchRow}>
                    <SearchField
                      aria-label={M.searchLabel}
                      placeholder={M.searchPlaceholder}
                      value={query}
                      onChange={setQuery}
                      styles={searchField}
                    />
                    <span className={count}>
                      {query.trim() ? M.countFound(rows.length) : tab === 'idle' ? M.countIdle(rows.length) : M.countFamilies(rows.length)}
                    </span>
                  </div>
                  {failed ? <p className={failure}>{failed}</p> : null}
                  {rows.length ? (
                    <ul className={list} aria-label={M.listLabel}>
                      {rows.map((f) => (
                        <FamilyRow key={f.family} family={f} pending={pending} onAdd={(id) => void add(id, { source: 'catalog', packageId: id })} />
                      ))}
                    </ul>
                  ) : (
                    <div className={empty}>
                      <p className={detail}>{M.empty(query.trim())}</p>
                      <Button variant="secondary" size="S" onPress={() => setTab('custom')}>
                        {M.emptyAction}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </Content>
            <ButtonGroup>
              {custom ? (
                <>
                  <Button variant="secondary" onPress={close}>
                    {M.cancel}
                  </Button>
                  <Button variant="accent" isDisabled={!addable} isPending={pending === 'custom'} onPress={submitCustom}>
                    {form.source === 'local-file' ? M.addLocal : M.addRepo}
                  </Button>
                </>
              ) : (
                <Button variant="secondary" onPress={close}>
                  {M.done}
                </Button>
              )}
            </ButtonGroup>
          </>
        )}
      </Dialog>
    </DialogContainer>
  );
}

/** 目录的一行：一族（设计稿 `FamilyRow`）。能添加的组给精度选择与「添加」；内置或加过的写状态。 */
function FamilyRow({ family: f, pending, onAdd }: { family: AudioCppAddableFamily; pending: string | null; onAdd: (packageId: string) => void }) {
  const first = firstPackage(f);
  const [pick, setPick] = useState<string | null>(first?.id ?? null);
  const pkg = f.packages.find((p) => p.id === pick) ?? first;
  const idle = familyState(f) === 'idle';
  const flag = idle ? null : licenseFlag(f.license);
  const st = statusLabel(f.status);
  const named = packagesNamed(f);
  const option = (p: AudioCppAddableFamily['packages'][number]) =>
    [precisionLabel(p) ?? packageName(p), fmtSize(p.bytes), p.state === 'builtin' ? M.builtin : p.state === 'added' ? M.added : null]
      .filter(Boolean)
      .join(' · ');
  const xs = idle
    ? null
    : [
        licenseLine(f.license),
        f.packages.length > 1 ? M.options(f.packages.length) : null,
        pkg?.parts.length ? M.withParts(pkg.parts) : null,
      ]
        .filter(Boolean)
        .join(' · ');
  return (
    <li className={familyRow}>
      <div className={familyText}>
        <span className={familyName}>
          {f.name}
          {st ? (
            <Badge variant="neutral" size="S" fillStyle="subtle">
              {st}
            </Badge>
          ) : null}
          {flag ? (
            <Badge variant="notice" size="S" fillStyle="subtle">
              {flag === 'nc' ? M.chipNonCommercial : M.chipCheckLicense}
            </Badge>
          ) : null}
        </span>
        <span className={detail}>{idle ? idleText(f) : traitsLine(f) || tasksLine(f.tasks)}</span>
        {xs ? <span className={detailXs}>{xs}</span> : null}
      </div>
      {idle ? null : !pkg ? (
        <span className={detailXs}>{M.noPackages}</span>
      ) : (
        <div className={familyActions}>
          {f.packages.length > 1 ? (
            <Picker
              aria-label={M.versionLabel(f.name)}
              size="S"
              align="end"
              menuWidth={named ? 360 : 240}
              selectedKey={pkg.id}
              onSelectionChange={(key) => key !== null && setPick(String(key))}>
              {f.packages.map((p) => (
                <PickerItem key={p.id} id={p.id} textValue={named ? packageName(p) : option(p)}>
                  <Text slot="label">{named ? packageName(p) : option(p)}</Text>
                  {named ? <Text slot="description">{option(p)}</Text> : null}
                </PickerItem>
              ))}
            </Picker>
          ) : (
            <span className={detailXs}>{option(pkg)}</span>
          )}
          {pkg.state ? (
            <span className={detailXs}>{pkg.state === 'builtin' ? M.builtin : M.added}</span>
          ) : (
            <Button variant="secondary" size="S" isPending={pending === pkg.id} isDisabled={!!pending && pending !== pkg.id} onPress={() => onAdd(pkg.id)}>
              <AddIcon />
              <Text>{M.add}</Text>
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
