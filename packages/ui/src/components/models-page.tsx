import { useEffect, type ComponentType, type ReactNode } from 'react';
import { Tab, TabList, TabPanel, Tabs, Text } from '@react-spectrum/s2';
import AudioWave from '@react-spectrum/s2/icons/AudioWave';
import Cloud from '@react-spectrum/s2/icons/Cloud';
import DeviceLaptop from '@react-spectrum/s2/icons/DeviceLaptop';
import ImageIcon from '@react-spectrum/s2/icons/Image';
import Microphone from '@react-spectrum/s2/icons/Microphone';
import TextIcon from '@react-spectrum/s2/icons/Text';
import Transcript from '@react-spectrum/s2/icons/Transcript';
import UnlinkHoriz from '@react-spectrum/s2/icons/UnlinkHoriz';
import Visibility from '@react-spectrum/s2/icons/Visibility';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { resolveModelsRoute } from '../model/models-route.ts';
import {
  MODEL_PAGE_LABEL,
  modelCategory,
  ONLY_PAGE_NOTE,
  type ModelCategory,
  type ModelPage,
} from '../model/settings-nav.ts';
import { useShell } from '../state/shell-store.ts';
import { CloudModels } from './models/cloud-models.tsx';
import { LocalModels } from './models/local-models.tsx';
import { ModelsDirCard } from './models/models-dir-card.tsx';
import { MODELS_PAGE_COPY } from './models/models-copy.ts';
import { MyVoices } from './models/my-voices.tsx';

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
  sep: UnlinkHoriz,
  vision: Visibility,
};
/** 页签的图标（page-settings.jsx:250）。 */
const PAGE_ICON: Record<ModelPage, ComponentType> = { local: DeviceLaptop, cloud: Cloud, voices: Microphone };

/** 设置中的模型配置（产品设计 §2.1、§7.6），共用设置导航与滚动容器。
 * 模型类记住本地 / 云端 / 我的声音的最后一页；切换页签不增加历史记录。
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

  const body = (p: ModelPage): ReactNode =>
    p === 'local' ? (
      <>
        <ModelsDirCard />
        <LocalModels category={category} />
      </>
    ) : p === 'cloud' ? (
      <CloudModels category={category} />
    ) : (
      <MyVoices />
    );
  const firstPage = info.pages[0]!;

  return (
    <>
      <header className={intro}>
        <h1 className={title}>{info.label}</h1>
        <p className={lede}>{info.description}</p>
      </header>
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
        <>
          <p className={only}>{ONLY_PAGE_NOTE[firstPage]}</p>
          {body(firstPage)}
        </>
      )}
    </>
  );
}
