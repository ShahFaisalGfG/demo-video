import fs from 'node:fs';

const [inputPath, outputPath, ...options] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error('Usage: node reflow-subtitles.mjs <input.srt> <output.srt> [--max-words 9] [--max-line-chars 42]');
  process.exit(1);
}

function optionValue(name, fallback) {
  const index = options.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(options[index + 1]);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} requires a positive integer.`);
  return value;
}

const maxWords = optionValue('--max-words', 9);
const maxLineChars = optionValue('--max-line-chars', 42);

function parseTime(value) {
  const match = value.match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
  if (!match) throw new Error(`Invalid SRT timestamp: ${value}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}

function formatTime(seconds) {
  const millis = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(millis / 3600000);
  const minutes = Math.floor((millis % 3600000) / 60000);
  const wholeSeconds = Math.floor((millis % 60000) / 1000);
  const remainder = millis % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:` +
    `${String(wholeSeconds).padStart(2, '0')},${String(remainder).padStart(3, '0')}`;
}

function parseSrt(contents) {
  return contents.trim().split(/\r?\n\r?\n/).map((block) => {
    const lines = block.split(/\r?\n/);
    const timingIndex = lines.findIndex((line) => line.includes(' --> '));
    const [start, end] = lines[timingIndex].split(' --> ');
    return {
      start: parseTime(start),
      end: parseTime(end),
      text: lines.slice(timingIndex + 1).join(' ').replace(/\s+/g, ' ').trim(),
    };
  });
}

function splitWords(text) {
  const words = text.split(/\s+/);
  const chunks = [];
  let current = [];
  for (const word of words) {
    const candidate = [...current, word];
    const candidateLength = candidate.join(' ').length;
    if (current.length && (candidate.length > maxWords || candidateLength > maxLineChars * 2)) {
      chunks.push(current);
      current = [word];
      continue;
    }
    current = candidate;
    if (current.length >= 5 && /[.!?;:]$/.test(word)) {
      chunks.push(current);
      current = [];
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function wrapLines(words) {
  const text = words.join(' ');
  if (text.length <= maxLineChars) return text;
  let best = null;
  for (let split = 1; split < words.length; split += 1) {
    const first = words.slice(0, split).join(' ');
    const second = words.slice(split).join(' ');
    const score = Math.max(first.length, second.length) + Math.abs(first.length - second.length) / 10;
    if (!best || score < best.score) best = { first, second, score };
  }
  return `${best.first}\n${best.second}`;
}

const sourceCues = parseSrt(fs.readFileSync(inputPath, 'utf8'));
const outputCues = [];
for (const cue of sourceCues) {
  const chunks = splitWords(cue.text);
  const weights = chunks.map((chunk) => chunk.join(' ').length);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = cue.start;
  chunks.forEach((chunk, index) => {
    const end = index === chunks.length - 1
      ? cue.end
      : cursor + (cue.end - cue.start) * (weights[index] / totalWeight);
    outputCues.push({ start: cursor, end, text: wrapLines(chunk) });
    cursor = end;
  });
}

const output = outputCues.map((cue, index) => [
  String(index + 1),
  `${formatTime(cue.start)} --> ${formatTime(cue.end)}`,
  cue.text,
].join('\n')).join('\n\n') + '\n';
fs.writeFileSync(outputPath, output, 'utf8');
console.log(`reflowed ${sourceCues.length} cue(s) into ${outputCues.length} closed-caption cue(s)`);
