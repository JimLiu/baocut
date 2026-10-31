import { describe, expect, it } from 'vitest';
import { guessLanguage } from './text-rules.ts';

describe('guessLanguage', () => {
  it('names only languages a writing system settles', () => {
    expect(guessLanguage(['今天把片头剪短一点'])).toBe('zh');
    expect(guessLanguage(['今日はイントロを短くしてください'])).toBe('ja');
    expect(guessLanguage(['인트로를 짧게 잘라 주세요'])).toBe('ko');
  });

  it('does not call Latin or Cyrillic text English or Russian; the model reads the messages instead', () => {
    expect(guessLanguage(['Corta la introducción a cinco segundos, por favor'])).toBeNull();
    expect(guessLanguage(["Coupe l'introduction à cinq secondes, s'il te plaît"])).toBeNull();
    expect(guessLanguage(['Kürze bitte das Intro auf fünf Sekunden'])).toBeNull();
    expect(guessLanguage(['Cut the intro to five seconds'])).toBeNull();
    expect(guessLanguage(['Скороти вступ до п’яти секунд'])).toBeNull();
    expect(guessLanguage([''])).toBeNull();
  });
});
