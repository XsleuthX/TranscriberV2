/**
 * IN-BROWSER WHISPER
 *
 * Runs Whisper locally through transformers.js — WebGPU where available, WASM
 * otherwise. No server, no key, and no audio leaves the machine.
 *
 * The library loads from a CDN at first use rather than from npm: the npm
 * package pulls `onnxruntime-node`, whose postinstall downloads native
 * binaries this app never uses, and that fails on restricted networks — taking
 * the whole `npm install` with it.
 */
const CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0";

let lib = null;
let asr = null;
let loadedKey = "";

/**
 * Local-first model loading.
 *
 * When weights have been fetched into public/models (npm run fetch-models),
 * they are ordinary static files on our own origin: the HTTP cache handles
 * them and the storage quota is never touched. Otherwise we fall back to the
 * CDN.
 *
 * Either way `useBrowserCache` is OFF. transformers.js otherwise copies every
 * weight into the Cache API, which shares the origin quota — that is the
 * QuotaExceededError, and it repeats on every run because the write never
 * succeeds. Disabling it costs a re-fetch at worst, and with local files it
 * costs nothing at all.
 */
let haveLocalModels = null;
/**
 * Probe for bundled weights — carefully.
 *
 * A dev server answers unknown paths with index.html and a 200, so "did the
 * request succeed?" is not a real test: it reports weights as present, the
 * library then fetches config.json, gets HTML, and dies on
 * `Unexpected token '<'`. So we GET it and require the response to actually
 * parse as JSON.
 */
async function localModelsPresent(model) {
  if (haveLocalModels !== null) return haveLocalModels;
  try {
    const r = await fetch(`/models/${model}/config.json`, { cache: "no-store" });
    if (!r.ok) { haveLocalModels = false; return false; }
    const ct = r.headers.get("content-type") || "";
    if (/html/i.test(ct)) { haveLocalModels = false; return false; }
    const body = await r.text();
    if (/^\s*</.test(body)) { haveLocalModels = false; return false; }
    JSON.parse(body);
    haveLocalModels = true;
  } catch {
    haveLocalModels = false;
  }
  return haveLocalModels;
}

async function getLib(model, id) {
  if (lib) return lib;
  lib = await import(/* @vite-ignore */ CDN);
  const local = await localModelsPresent(model);
  lib.env.useBrowserCache = false;      // never write weights into the quota
  lib.env.allowLocalModels = local;
  lib.env.allowRemoteModels = !local;
  if (local) lib.env.localModelPath = "/models/";
  self.postMessage({ type: "source", id, local });
  return lib;
}

/**
 * Model weights are quantised by default. fp32 on WebGPU sounds better on
 * paper but a base model is then ~290 MB to download and hold in one
 * allocation, which is exactly how you get "Array buffer allocation failed"
 * and a blown storage quota. q8 is roughly a fifth of that and the accuracy
 * cost on speech is small.
 */
async function ensure(model, device, dtype, id) {
  const key = `${model}::${device}::${dtype}`;
  if (asr && loadedKey === key) return asr;
  const { pipeline } = await getLib(model, id);
  asr = await pipeline("automatic-speech-recognition", model, {
    device,
    dtype,
    progress_callback: (p) => {
      if (p?.status === "progress" && p.total)
        self.postMessage({ type: "download", id, file: p.file, pct: (p.loaded / p.total) * 100 });
      else if (p?.status)
        self.postMessage({ type: "stage", id, stage: p.status, file: p.file });
    },
  });
  loadedKey = key;
  return asr;
}

/** Turn the library's opaque failures into something a user can act on. */
function explain(err) {
  const m = String(err?.message || err);
  const n = err?.name || "";
  if (n === "QuotaExceededError" || /quota/i.test(m))
    return "QUOTA:Out of browser storage. Run `npm run fetch-models` to ship the weights with the app, or clear space in Preferences → Storage.";
  if (/allocation failed|out of memory/i.test(m))
    return "MEM:Not enough memory for this model. Try a smaller one, or switch quality to Fast (q8).";
  if (/Unexpected token '<'|not valid JSON/i.test(m))
    return "HTML:The server returned a web page where a model file was expected. " +
           "Run `npm run fetch-models`, or delete public/models to use the CDN instead.";
  if (/fetch|network|Failed to load/i.test(m))
    return "NET:Could not download the model. The first run needs internet access to the CDN.";
  return m;
}

self.onmessage = async (e) => {
  const { type, model, device, dtype, audio, language, id } = e.data || {};
  try {
    if (type === "ping") { await getLib(model || "Xenova/whisper-tiny"); self.postMessage({ type: "pong" }); return; }
    if (type === "run") {
      const p = await ensure(model, device, dtype || "q8", id);
      self.postMessage({ type: "stage", id, stage: "transcribing" });
      const out = await p(audio, {
        // Word-level timestamps. Unlike the hosted APIs' word arrays these come
        // back in decode order, so grouping them into segments is safe.
        return_timestamps: "word",
        chunk_length_s: 30,
        stride_length_s: 5,
        language: language && language !== "auto" && language !== "multi" ? language : null,
        task: "transcribe",
      });
      self.postMessage({ type: "result", id, out });
      return;
    }
  } catch (err) {
    self.postMessage({ type: "error", id, message: explain(err) });
  }
};
