import type { JobsParamsMessages } from './params.ts';

export const tr: JobsParamsMessages = {
unknownParam: (p) => `Bilinmeyen parametre ${p.key}`, invalidParam: (p) => `${p.key} parametresi ${p.problem}`, mustBeNonEmptyString: 'boş olmayan dize olmalı', atMostChars: (p) => `en fazla ${p.max} karakter olmalı`, mustBeIntegerBetween: (p) => `${p.min}–${p.max} arasında tam sayı olmalı`, mustBeOneOf: (p) => `${p.values} değerlerinden biri olmalı`, mustBeArray: 'dizi olmalı', atLeastItems: (p) => `en az ${p.min} öğe içermeli`, atMostItems: (p) => `en fazla ${p.max} öğe içermeli`, mustBeBoolean: 'true veya false olmalı', mustBeLanguageTag: 'BCP 47 dil etiketi olmalı', mustBeAbsolutePath: 'mutlak yol olmalı', itemsMustBeAbsolutePaths: 'yalnızca mutlak yollar içermeli', onlyOneOf: (p) => `${p.other} ile birleştirilemez`, createExcludesVideoId: 'yeni video oluşturur ve videoId ile birleştirilemez', targetShape: '{ videoId }, { entryId } veya { create } biçiminde olmalı',
};
