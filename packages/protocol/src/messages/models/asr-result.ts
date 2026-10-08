import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './asr-result.zh-Hans.ts';
import { zhHant } from './asr-result.zh-Hant.ts';
import { ja } from './asr-result.ja.ts';
import { ko } from './asr-result.ko.ts';
import { es } from './asr-result.es.ts';
import { fr } from './asr-result.fr.ts';
import { de } from './asr-result.de.ts';
import { nl } from './asr-result.nl.ts';
import { ptBR } from './asr-result.pt-BR.ts';
import { it } from './asr-result.it.ts';
import { ru } from './asr-result.ru.ts';
import { pl } from './asr-result.pl.ts';
import { tr } from './asr-result.tr.ts';
import { vi } from './asr-result.vi.ts';

/** `packages/models/src/asr-result.ts` 校验 `baocut.asr-result/v1` 时列出的问题。 */
const en = {
  notObject: 'The result is not an object',
  schemaShouldBe: (p: { schema: string }) => `schema should be ${p.schema}`,
  outcomeOutOfRange: 'outcome is not an allowed value',
  timescaleInvalid: 'timescale should be a positive integer',
  clockInvalid: 'clock should be source-asset',
  durationInvalid: 'duration should be a non-negative integer of ticks',
  languageNotObject: 'language should be an object',
  languageTagInvalid: 'language.tag is not a valid BCP 47 tag',
  languageSourceOutOfRange: 'language.source is not an allowed value',
  languageConfidenceInvalid: 'language.confidence should be 0–1 or null',
  assertedWithoutRequest: 'The request did not assert a language, but the result is marked asserted',
  languageMismatch: 'language.tag does not match the asserted language',
  speakersNotArray: 'speakers should be an array',
  speakerIdInvalid: 'Each speakers[] id should be a non-empty string',
  speakerDuplicate: (p: { id: string }) => `Speaker ${p.id} appears more than once`,
  speakerLabelInvalid: (p: { id: string }) => `The label of speaker ${p.id} should be a string or null`,
  segmentsNotArray: 'segments should be an array',
  segmentsNotEmpty: (p: { outcome: string }) => `segments should be empty when outcome is ${p.outcome}`,
  notObjectAt: (p: { at: string }) => `${p.at} is not an object`,
  idInvalid: (p: { at: string }) => `${p.at}.id should be a non-empty string`,
  idDuplicate: (p: { at: string }) => `${p.at}.id appears more than once`,
  timeInvalid: (p: { at: string }) => `The times of ${p.at} should be non-negative integers of ticks`,
  startNotBeforeEnd: (p: { at: string }) => `The start of ${p.at} should be less than its end`,
  beyondDuration: (p: { at: string }) => `${p.at} goes past duration`,
  overlaps: (p: { at: string }) => `${p.at} overlaps the previous segment or is not in start order`,
  textEmpty: (p: { at: string }) => `${p.at}.text should be non-empty text`,
  speakerUnknown: (p: { at: string }) => `${p.at}.speakerId is not in speakers`,
  wordsNotArray: (p: { at: string }) => `${p.at}.words should be an array`,
  wordStartAfterEnd: (p: { at: string }) => `The start of ${p.at} is greater than its end`,
  wordOutsideSegment: (p: { at: string }) => `${p.at} goes outside its segment`,
  wordNotMonotonic: (p: { at: string }) => `${p.at} is not in increasing order`,
  confidenceInvalid: (p: { at: string }) => `${p.at}.confidence should be 0–1 or null`,
  timingQualityOutOfRange: (p: { at: string }) => `${p.at}.timingQuality is not an allowed value`,
  missingTimingStart: (p: { at: string }) => `When its time is missing, ${p.at} should sit at the start of its segment`,
  coverageNotArray: 'coverage should be an array',
  coverageInvalid: (p: { at: string }) => `${p.at} should be integers of ticks`,
  coverageOutOfRange: (p: { at: string }) => `${p.at} is out of range`,
  warningsNotArray: 'warnings should be an array',
  warningCodeOutOfRange: (p: { at: string }) => `${p.at}.code is not an allowed value`,
  warningSegmentIdInvalid: (p: { at: string }) => `${p.at}.segmentId should be a string`,
  provenanceNotObject: 'provenance should be an object',
  provenanceFieldEmpty: (p: { key: string }) => `provenance.${p.key} should be a non-empty string`,
  bundleIdInvalid: 'provenance.bundleId should be a string or null',
  modelsNotObject: 'provenance.models should be an object',
  runGenerationInvalid: 'provenance.runGeneration should be an integer',
  runGenerationMismatch: 'provenance.runGeneration does not match this attempt',
};

export type ModelsAsrResultMessages = typeof en;

export const ModelsAsrResult = defineCatalog('modelsAsrResult', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
