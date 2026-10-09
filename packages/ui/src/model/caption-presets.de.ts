import type { CaptionPresetsMessages } from './caption-presets.ts';

export const de: CaptionPresetsMessages = {
  categories: { basic: 'Basis', social: 'Social Media', business: 'Geschäftlich', retro: 'Retro', motion: 'Bewegung', kinetic: 'Kinetische Typo' },
  classic: 'Klassisch',
  simple: 'Schlicht',
  daoyazi: 'Kinetische Untertitel',
  studio: {
    'studio-focus': "Gesprochene Betonung",
    'studio-word-tiles': "Wortkacheln",
    'studio-word-drop': "Wortfall",
    'studio-paper-typewriter': "Schreibmaschine",
    'studio-line-swipe': "Zeilenwischen",
    'studio-soft-focus': "Weicher Fokus",
    'studio-rise-settle': "Steigen und Einrasten",
    'studio-kinetic-wave': "Kinetische Welle",
    'studio-ktv': "Karaoke",
  } as Record<string, string>,
  styleDocument: "Untertitelstil",
};
