type ColorKey = 'brightness' | 'contrast' | 'saturation' | 'temperature' | 'hue';
type OtherKey = 'filterPreset' | 'effectPreset' | 'grayscale' | 'exposure' | 'sharpen' | 'noise' | 'vignette';
import type { EffectsPanelMessages } from './effects-panel.ts';

export const de: EffectsPanelMessages = {
  color: {
    brightness: "Helligkeit",
    contrast: "Kontrast",
    saturation: "Sättigung",
    temperature: "Temperatur",
    hue: "Farbton",
  } as Record<ColorKey, string>,
  other: {
    filterPreset: "Filtervoreinstellung",
    effectPreset: "Effektvoreinstellung",
    grayscale: "Graustufen",
    exposure: "Belichtung",
    sharpen: "Schärfen",
    noise: "Rauschen",
    vignette: "Vignette",
  } as Record<OtherKey, string>,
};
