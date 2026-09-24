import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

function parseJson(content) {
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error(`VLM did not return JSON: ${content.slice(0, 200)}`);
  return JSON.parse(cleaned.slice(start, end + 1));
}

const [videoPath, configPath, reportPathArg] = process.argv.slice(2);
if (!videoPath || !configPath) {
  console.error('Usage: node verify-semantic-evidence.mjs <video> <checks.json> [report.json]');
  process.exit(1);
}
const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const checks = Array.isArray(rawConfig) ? rawConfig : rawConfig.checks;
if (!Array.isArray(checks) || checks.length === 0) throw new Error('Semantic checks must be a non-empty array.');
const baseUrl = rawConfig.baseUrl ?? process.env.DEMO_VLM_BASE_URL ?? 'http://127.0.0.1:8080/v1';
const model = rawConfig.model ?? process.env.DEMO_VLM_MODEL ?? 'Qwen/Qwen3-VL-2B-Instruct';
const apiKey = process.env[rawConfig.apiKeyEnv ?? 'DEMO_VLM_API_KEY'];
const reportPath = reportPathArg ?? path.join(path.dirname(configPath), 'semantic-evidence-report.json');
const frameDir = path.join(path.dirname(reportPath), `${path.basename(reportPath, '.json')}-frames`);
fs.mkdirSync(frameDir, { recursive: true });
const results = [];

for (let index = 0; index < checks.length; index++) {
  const check = checks[index];
  const timestamp = Number(check.timestamp);
  if (!Number.isFinite(timestamp) || timestamp < 0 || !check.claim) {
    throw new Error(`Semantic check ${index + 1} needs a non-negative timestamp and claim.`);
  }
  const safeName = String(check.name ?? `check-${index + 1}`).replace(/[^a-z0-9_-]+/gi, '-');
  const frame = path.join(frameDir, `${String(index + 1).padStart(3, '0')}-${safeName}.jpg`);
  const filters = check.crop
    ? ['-vf', `crop=${check.crop.width}:${check.crop.height}:${check.crop.x}:${check.crop.y},scale=1280:-2`]
    : ['-vf', 'scale=1280:-2'];
  execFileSync(ffmpegPath, ['-ss', timestamp.toFixed(3), '-i', videoPath, ...filters,
    '-frames:v', '1', '-q:v', '3', '-y', frame], { stdio: 'ignore' });
  if (!fs.existsSync(frame)) throw new Error(`No frame exists at ${timestamp.toFixed(3)}s.`);
  const image = `data:image/jpeg;base64,${fs.readFileSync(frame).toString('base64')}`;
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 220,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: image } },
          { type: 'text', text: `Evaluate only visible evidence in this product screenshot. Claim: ${check.claim}\n` +
            'Return JSON only: {"passed":boolean,"confidence":number,"observed":"short factual description","reason":"short explanation"}. ' +
            'Fail when the frame is ambiguous, clipped, loading, blank, or does not visibly support the full claim.' },
        ],
      }],
    }),
  });
  if (!response.ok) throw new Error(`Semantic endpoint returned HTTP ${response.status}: ${await response.text()}`);
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('Semantic endpoint returned no message content.');
  const verdict = parseJson(content);
  const minimumConfidence = check.minimumConfidence ?? 0.72;
  const passed = verdict.passed === true && Number(verdict.confidence) >= minimumConfidence;
  results.push({ name: check.name ?? `check-${index + 1}`, timestamp, claim: check.claim,
    minimumConfidence, frame, verdict, passed });
}

const failed = results.filter((result) => !result.passed);
fs.writeFileSync(reportPath, JSON.stringify({ video: path.resolve(videoPath), baseUrl, model,
  passed: failed.length === 0, results }, null, 2));
console.log(`[semantic-evidence] ${results.length - failed.length}/${results.length} checks passed; report ${reportPath}`);
if (failed.length) process.exit(1);
