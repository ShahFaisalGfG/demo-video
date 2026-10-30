import fs from 'node:fs';
import path from 'node:path';

// Kokoro and Piper both phonemize with espeak-ng, which spells plain capitals
// letter by letter in most positions. Spaced letters backfire: "A P I" turns
// the leading A into the article ("a P I"). Hyphenated letters fix the few
// abbreviations espeak-ng reads as words in some positions, such as AWS as
// "awz" at the end of a sentence.
const DEFAULT_PRONUNCIATIONS = {
  AI: 'AI',
  API: 'API',
  AWS: 'A-W-S',
  CSV: 'CSV',
  ECS: 'E-C-S',
  ID: 'ID',
  JSON: 'Jason',
  OAuth: 'Oh auth',
  PDF: 'PDF',
  QHD: 'QHD',
  RLS: 'RLS',
  SAGE: 'Sage',
  SRT: 'SRT',
  UI: 'UI',
  URL: 'URL',
  UX: 'U-X',
  XLSX: 'XLSX',
  XML: 'XML',
};

// espeak-ng drops the plural of an abbreviation ("IDs" sounds like "ID").
// Spelling the last letter's name as a plural keeps it: "I-Dees", "P-D-Effs".
const LETTER_PLURALS = {
  A: 'Ays', B: 'Bees', C: 'Cees', D: 'Dees', E: 'Ees', F: 'Effs', G: 'Gees', H: 'Aitches', I: 'Eyes',
  J: 'Jays', K: 'Kays', L: 'Ells', M: 'Ems', N: 'Ens', O: 'Ohs', P: 'Pees', Q: 'Cues', R: 'Ars', S: 'Esses',
  T: 'Tees', U: 'Yous', V: 'Vees', W: 'Double-yous', X: 'Exes', Y: 'Wyes', Z: 'Zees',
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

function termPattern(term) {
  const boundary = /\w/.test(term.at(0) ?? '') && /\w/.test(term.at(-1) ?? '');
  return new RegExp(boundary ? `\\b${escapePattern(term)}\\b` : escapePattern(term), 'gi');
}

function replaceTerms(text, dictionary) {
  return Object.entries(dictionary)
    .sort(([left], [right]) => right.length - left.length)
    .reduce((value, [term, pronunciation]) => value.replace(termPattern(term), pronunciation), text);
}

/** Speak abbreviation plurals: a word reading gets an s ("Jasons"), spelled letters end on a plural letter name. */
function spellPlurals(text, dictionary) {
  return text.replace(/\b([A-Z]{2,6})s\b/g, (_, singular) => {
    const reading = dictionary[singular] ?? singular;
    if (/[a-z]/.test(reading)) return `${reading}s`;
    const letters = reading.replace(/[^A-Z]/g, '');
    return [...letters.slice(0, -1), LETTER_PLURALS[letters.at(-1)]].join('-');
  });
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
  const dictionary = loadDictionary(config, config.baseDir ?? process.cwd());
  const unknownAcronyms = [...new Set(text.match(/\b[A-Z][A-Z0-9]{1,}\b/g) ?? [])]
    .filter((term) => !(term in dictionary));
  if (unknownAcronyms.length) {
    warnings.push(`Add pronunciations for: ${unknownAcronyms.join(', ')}. Map a spelled term to itself (SPF) `
      + 'or to hyphenated letters (A-W-S), and a spoken word to its reading (SAGE: Sage).');
  }
  const spacedArticles = Object.entries(dictionary)
    .filter(([term, spoken]) => termPattern(term).test(text) && /(^|\s)A( [A-Z])+(\s|$)/.test(spoken))
    .map(([term]) => term);
  if (spacedArticles.length) {
    warnings.push(`Spaced letters starting with A are read as the article: ${spacedArticles.join(', ')}. `
      + 'Use plain capitals or hyphens (A-P-I).');
  }
  if (/\([^)]{45,}\)/.test(text)) warnings.push('Long parenthetical phrasing may sound unnatural.');
  return warnings;
}

/**
 * Prepare caption text and speech text for one narration line.
 * `spoken` replaces the words given to the voice (for example past-tense "read" as "red"); captions keep `text`.
 */
export function prepareNarration(text, config = {}, baseDir = process.cwd(), spoken = undefined) {
  const displayText = String(text).replace(/\s+/g, ' ').trim();
  const speechSource = String(spoken ?? text).replace(/\s+/g, ' ').trim();
  const normalized = speechSource.replace(/[\u2013\u2014]/g, ',').replace(/\s*,\s*/g, ', ');
  const dictionary = loadDictionary(config, baseDir);
  const spokenText = spellPlurals(replaceTerms(normalized, dictionary), dictionary).replace(/\s+/g, ' ').trim();
  const warnings = lintNarration(speechSource, { ...config, baseDir });
  if (config.strictNarration && warnings.length) {
    throw new Error(`Narration quality check failed: ${warnings.join(' ')}`);
  }
  return { displayText, spokenText, warnings };
}

export { DEFAULT_PRONUNCIATIONS };
