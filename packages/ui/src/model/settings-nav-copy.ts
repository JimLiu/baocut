import { defineMessages } from '@baocut/protocol';
import { zhHans } from './settings-nav-copy.zh-Hans.ts';
import { zhHant } from './settings-nav-copy.zh-Hant.ts';
import { ja } from './settings-nav-copy.ja.ts';
import { ko } from './settings-nav-copy.ko.ts';
import { es } from './settings-nav-copy.es.ts';
import { fr } from './settings-nav-copy.fr.ts';
import { de } from './settings-nav-copy.de.ts';
import { nl } from './settings-nav-copy.nl.ts';
import { ptBR } from './settings-nav-copy.pt-BR.ts';
import { it } from './settings-nav-copy.it.ts';
import { ru } from './settings-nav-copy.ru.ts';
import { pl } from './settings-nav-copy.pl.ts';
import { tr } from './settings-nav-copy.tr.ts';
import { vi } from './settings-nav-copy.vi.ts';

/** 设置分节表的文案（model/settings-nav.ts；译文在 `settings-nav-copy.<语言>.ts`）。 */
const en = {
  category: {
    asr: { label: 'Speech recognition', description: 'Turn speech into transcripts and subtitles, and tell speakers apart.' },
    tts: { label: 'Speech synthesis', description: 'Generate speech, clone voices and make voice-overs for videos.' },
    llm: { label: 'Text generation', description: 'Polish transcripts, translate subtitles and generate text.' },
    image: { label: 'Image generation', description: 'Generate the images and covers your videos need.' },
    sep: { label: 'Source separation', description: 'Separate vocals, accompaniment and background sound.' },
    vision: { label: 'Visual understanding', description: 'Recognize people, speakers and what’s on screen to help with smart cropping.' },
  },
  page: { local: 'Local models', cloud: 'Cloud models', voices: 'My voices' },
  onlyPage: {
    local: 'This category only has local models that run on this computer; there are no cloud models yet.',
    cloud: 'Text generation only has cloud models. Coding Agents are set up under “Agent”.',
  },
  section: {
    general: 'General',
    shortcuts: 'Shortcuts',
    fonts: 'Fonts',
    agent: 'Agent providers',
    skills: 'Skills',
    glossary: 'Glossary',
    privacy: 'Privacy and permissions',
    diagnostics: 'Diagnostics',
    about: 'About',
  },
  group: { preferences: 'Preferences', agents: 'Agent', app: 'App' },
};
export type SettingsNavMessages = typeof en;
export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
