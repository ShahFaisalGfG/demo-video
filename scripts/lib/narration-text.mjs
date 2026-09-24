import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_PRONUNCIATIONS = {
  AI: 'A I',
  API: 'A P I',
  AWS: 'A W S',
  CSV: 'C S V',
  ECS: 'E C S',
  JSON: 'J son',
  OAuth: 'Oh auth',
  PDF: 'P D F',
  QHD: 'Q H D',
  RLS: 'R L S',
  SAGE: 'Sage',
  SRT: 'S R T',
  UI: 'U I',
  URL: 'U R L',
  UX: 'U X',
  XLSX: 'X L S X',
  XML: 'X M L',
};

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadDictionary(config, baseDir) {
  let additions = {};
  if (config.pronunciationFile) {
    const dictionaryPath = path.resolve(baseDir, config.pronunciationFile);
    additions = JSON.parse(fs.readFileSync(dictionaryPath, 'utf8'));
  }
  return {
    ...DEFAULT_PRONUNCIATIONS,
    ...additions,
    ...(config.pronunciations ?? {}),
  };
}

function replaceTerms(text, dictionary) {
  return Object.entries(dictionary)
    .sort(([left], [right]) => right.length - left.length)
    .reduce((value, [term, pronunciation]) => {
      const boundary = /\w/.test(term.at(0) ?? '') && /\w/.test(term.at(-1) ?? '');
      const source = boundary ? `\\b${escapePattern(term)}\\b` : escapePattern(term);
      return value.replace(new RegExp(source, 'gi'), pronunciation);
    }, text);
}

function lintNarration(text, config) {
  const warnings = [];
  const maxSentenceWords = config.maxSentenceWords ?? 28;
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    if (words.length > maxSentenceWords) {
      warnings.push(`Sentence has ${words.length} words; target ${maxSentenceWords} or fewer.`);
    }
  }
  const unknownAcronyms = [...new Set(text.match(/\b[A-Z][A-Z0-9]{1,}\b/g) ?? [])]
    .filter((term) => !(term in loadDictionary(config, config.baseDir ?? process.cwd())));
  if (unknownAcronyms.length) {
    warnings.push(`Add pronunciations for: ${unknownAcronyms.join(', ')}.`);
  }
  if (/\([^)]{45,}\)/.test(text)) warnings.push('Long parenthetical phrasing may sound unnatural.');
  return warnings;
}

export function prepareNarration(text, config = {}, baseDir = process.cwd()) {
  const displayText = String(text).replace(/\s+/g, ' ').trim();
  const normalized = displayText.replace(/[\u2013\u2014]/g, ',').replace(/\s*,\s*/g, ', ');
  const dictionary = loadDictionary(config, baseDir);
  const spokenText = replaceTerms(normalized, dictionary).replace(/\s+/g, ' ').trim();
  const warnings = lintNarration(displayText, { ...config, baseDir });
  if (config.strictNarration && warnings.length) {
    throw new Error(`Narration quality check failed: ${warnings.join(' ')}`);
  }
  return { displayText, spokenText, warnings };
}

export { DEFAULT_PRONUNCIATIONS };
