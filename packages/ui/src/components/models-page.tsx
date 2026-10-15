import { useEffect, type ComponentType, type ReactNode } from 'react';
import { Tab, TabList, TabPanel, Tabs, Text } from '@react-spectrum/s2';
import AudioWave from '@react-spectrum/s2/icons/AudioWave';
import ImageIcon from '@react-spectrum/s2/icons/Image';
import Microphone from '@react-spectrum/s2/icons/Microphone';
import MusicNote from '@react-spectrum/s2/icons/MusicNote';
import TextIcon from '@react-spectrum/s2/icons/Text';
import Transcript from '@react-spectrum/s2/icons/Transcript';
import UnlinkHoriz from '@react-spectrum/s2/icons/UnlinkHoriz';
import Visibility from '@react-spectrum/s2/icons/Visibility';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { categoryCapability } from '../model/models-cloud.ts';
import { resolveModelsRoute } from '../model/models-route.ts';
import { MODEL_PAGE_LABEL, modelCategory, ONLY_SOURCE_NOTE, type ModelCategory, type ModelPage } from '../model/settings-nav.ts';
import { useConnection } from '../state/connection-store.ts';
import { useModels } from '../state/models-store.ts';
import { useShell } from '../state/shell-store.ts';
import { CapabilityDefault } from './models/capability-default.tsx';
import { CapabilityProviders } from './models/capability-providers.tsx';
import { LocalModels } from './models/local-models.tsx';
import { Lede, PageStatus } from './models/model-parts.tsx';
import { ModelsDirCard } from './models/models-dir-card.tsx';
import { MODELS_PAGE_COPY } from './models/models-copy.ts';
import { MyVoices } from './models/my-voices.tsx';
import { CAP_PROVIDERS_COPY } from './models/providers-copy.ts';
import { TextDefault } from './models/text-default.tsx';
import { LegacySettingsNotice } from './legacy-import/legacy-settings-report.tsx';

/** 页头（.setpage__intro）：分类名 22/700，下面一句说明。 */
const intro = style({ marginBottom: 24 });
const title = style({ margin: 0, fontSize: '[22px]', fontWeight: 'bold', lineHeight: '[28px]', color: 'gray-900' });
const lede = style({ marginTop: 4, marginBottom: 0, font: 'ui', color: 'gray-600' });
const only = style({ marginTop: 0, marginBottom: 12, font: 'ui-sm', color: 'gray-600' });
const tabList = style({ marginBottom: 16 });

/** 左栏各类的图标（page-settings.jsx:213 的 `icons`）。 */
export const CATEGORY_ICON: Record<ModelCategory, ComponentType> = {
  asr: Transcript,
  tts: AudioWave,
  llm: TextIcon,
  image: ImageIcon,
  music: MusicNote,
  sep: UnlinkHoriz,
  vision: Visibility,
};
/** 页签的图标（page-settings.jsx 的 Tab 图标）。 */
const PAGE_ICON: Record<ModelPage, ComponentType> = { models: AudioWave, voices: Microphone };

/** 只有一种来源的类：文本生成只有 API 提供方的模型，音乐、人声分离、画面理解只有本机模型。 */
function onlySource(category: ModelCategory): 'local' | 'cloud' | null {
  if (category === 'llm') return 'cloud';
  return categoryCapability(category) ? null : 'local';
}

/**
 * 能力页（产品设计 §2.1、§7.6；设计稿 settings-capability.jsx），共用设置导航与滚动容器。本机模型与 API 提供方的模型在同一页，
 * 不分本地 / 云端：① 默认模型（文本生成另带推理强度与并发）② 本机模型 ③ API 提供方。语音合成多一个「我的声音」页签，
 * 记住最后停的页；切换页签不增加历史记录。
 */
export function ModelSettings({ category, page: requested }: { category: ModelCategory; page?: ModelPage }) {
  const replace = useShell((s) => s.replace);
  const last = useShell((s) => s.modelPages);
  const setModelPage = useShell((s) => s.setModelPage);
  const location = resolveModelsRoute(category, requested, last);
  const info = modelCategory(category);

  useEffect(() => {
    setModelPage(location.category, location.page);
  }, [setModelPage, location.category, location.page]);

  const capability = categoryCapability(category);
  const source = onlySource(category);
  const models: ReactNode = (
    <>
      {source ? <p className={only}>{ONLY_SOURCE_NOTE[source]}</p> : null}
      {category !== 'llm' ? (
        <>
          {capability ? <Lede title={CAP_PROVIDERS_COPY.local} /> : null}
          <ModelsDirCard />
          <LocalModels category={category} />
        </>
      ) : null}
      {capability ? <ProvidersSection capability={capability} /> : null}
    </>
  );
  const body = (p: ModelPage): ReactNode => (p === 'voices' ? <MyVoices /> : models);

  return (
    <>
      <header className={intro}>
        <h1 className={title}>{info.label}</h1>
        <p className={lede}>{info.description}</p>
      </header>
      {/* 一种能力一个默认模型，放在页签之上（产品设计 §7.6）。 */}
      {category === 'asr' ? <LegacySettingsNotice /> : null}
      <CapabilityDefault category={category} />
      {category === 'llm' ? <TextDefault /> : null}
      {info.pages.length > 1 ? (
        <Tabs
          aria-label={MODELS_PAGE_COPY.tabs(info.label)}
          selectedKey={location.page}
          onSelectionChange={(key) => {
            if (key !== location.page) replace({ tab: 'models', category, page: key as ModelPage });
          }}>
          <TabList aria-label={MODELS_PAGE_COPY.tabs(info.label)} styles={tabList}>
            {info.pages.map((p) => {
              const Icon = PAGE_ICON[p];
              return (
                <Tab key={p} id={p}>
                  <Icon />
                  <Text>{MODEL_PAGE_LABEL[p]}</Text>
                </Tab>
              );
            })}
          </TabList>
          {info.pages.map((p) => (
            <TabPanel key={p} id={p}>
              {body(p)}
            </TabPanel>
          ))}
        </Tabs>
      ) : (
        body(info.pages[0]!)
      )}
    </>
  );
}

/** 能力页的「API 提供方」一节：视图到了才画。 */
function ProvidersSection({ capability }: { capability: NonNullable<ReturnType<typeof categoryCapability>> }) {
  const view = useModels((s) => s.capabilities);
  const connected = useConnection((s) => s.state.status === 'connected');
  if (!view) return <PageStatus>{connected ? MODELS_PAGE_COPY.loading : MODELS_PAGE_COPY.offline}</PageStatus>;
  return <CapabilityProviders key={capability} view={view} capability={capability} />;
}
