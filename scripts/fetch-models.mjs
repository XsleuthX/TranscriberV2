#!/usr/bin/env node
/**
 * Download Whisper weights into public/models so the app can run them from its
 * own files.
 *
 * Why this exists: transformers.js otherwise fetches weights from a CDN and
 * stores them in the browser's Cache API, which shares the origin storage
 * quota — and on a machine with little free space that fails with
 * QuotaExceededError, repeatedly, with no way for the app to fix it.
 *
 * Served from public/models the weights are ordinary static files: the HTTP
 * cache handles them, the storage quota is never touched, and the app works
 * completely offline afterwards.
 *
 *   npm run fetch-models              # tiny + base
 *   npm run fetch-models -- small     # add small
 *   npm run fetch-models -- turbo     # add large-v3-turbo (~800 MB)
 */
import { mkdir, writeFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

const HOST = process.env.HF_HOST || "https://huggingface.co";
const OUT = "public/models";

const REPOS = {
  tiny: "Xenova/whisper-tiny",
  base: "Xenova/whisper-base",
  small: "Xenova/whisper-small",
  turbo: "onnx-community/whisper-large-v3-turbo",
};

// Config files are required; ONNX names vary by repo, so try each and accept
// whichever exist.
const CONFIG = [
  "config.json",
  "generation_config.json",
  "preprocessor_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
];
const WEIGHTS = [
  "onnx/encoder_model_quantized.onnx",
  "onnx/decoder_model_merged_quantized.onnx",
  "onnx/encoder_model_q8.onnx",
  "onnx/decoder_model_merged_q8.onnx",
  "onnx/encoder_model.onnx",
  "onnx/decoder_model_merged.onnx",
];

const human = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`);

async function grab(repo, file, { required }) {
  const dest = join(OUT, repo, file);
  try {
    const st = await stat(dest);
    if (st.size > 0) { console.log(`  · ${file} — already have it`); return true; }
  } catch { /* not downloaded yet */ }

  const url = `${HOST}/${repo}/resolve/main/${file}`;
  const res = await fetch(url);
  if (!res.ok) {
    if (required) throw new Error(`${file} → HTTP ${res.status}`);
    return false;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  console.log(`  ✓ ${file}  ${human(buf.length)}`);
  return true;
}

const wanted = process.argv.slice(2).filter((a) => REPOS[a]);
const keys = wanted.length ? wanted : ["tiny", "base"];

for (const k of keys) {
  const repo = REPOS[k];
  console.log(`\n${repo}`);
  try {
    for (const f of CONFIG) await grab(repo, f, { required: true });
    let got = 0;
    for (const f of WEIGHTS) if (await grab(repo, f, { required: false })) got++;
    if (!got) throw new Error("no ONNX weights found in this repo");
    console.log(`  done — ${repo} ready`);
  } catch (err) {
    console.error(`  ✗ ${repo}: ${err.message}`);
    console.error(`    Check your connection, or set HF_HOST to a mirror.`);
    process.exitCode = 1;
  }
}

console.log(`\nModels are in ${OUT}/. Restart the dev server; the Local engine will use them.`);
