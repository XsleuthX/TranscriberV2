import { deepSeekRequest } from './deepseek.js';
import { discoveredDeepSeek } from '../src/deepseek-models.js';
import { OPENAI_MODELS, TRANSCRIPTION_MODELS, usesResponses } from '../src/models.js';
import { sameOrigin, json, readBody } from './access.js';

export function providerMiddleware(env = {}, deps = {}) {
  const apiFetch = deps.fetch || fetch;
  const sendUpstream = async (res, response) => {
    const body = await response.text();
    res.statusCode = response.status; res.setHeader('Content-Type', 'application/json'); res.end(body);
  };
  return async (req, res, next) => {
    const route = new URL(req.url, 'http://localhost').pathname;
    if (!['/api/keys', '/api/ai', '/api/transcribe', '/api/deepseek-models'].includes(route)) return next();
    if (!sameOrigin(req, env)) return json(res, 403, { error: { message: 'Open the app from its configured address.' } });
    if (route === '/api/keys') return json(res, 200, { openai: !!env.OPENAI_API_KEY, groq: !!env.GROQ_API_KEY,
      anthropic: !!env.ANTHROPIC_API_KEY, deepseek: !!env.DEEPSEEK_API_KEY, local: true, workspaceProtected: !!env.APP_PASSWORD });
    if (req.method !== 'POST') return json(res, 405, { error: { message: 'POST only.' } });
    const controller = new AbortController();
    const disconnected = () => controller.abort();
    const closed = () => { if (!res.writableEnded) disconnected(); };
    req.once('aborted', disconnected); res.once('close', closed);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(300000)]);
    try {
      if(route==='/api/deepseek-models'){
        const key=req.headers['x-user-key']||env.DEEPSEEK_API_KEY;
        if(!key)return json(res,501,{error:{message:'Add your DeepSeek API key first.'}});
        const response=await apiFetch('https://api.deepseek.com/models',{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])});
        if(!response.ok)return sendUpstream(res,response);
        return json(res,200,{models:discoveredDeepSeek(await response.json())});
      }
      if (route === '/api/ai') {
        const provider = String(req.headers['x-ai-provider'] || 'anthropic');
        const conf = { openai: ['OPENAI_API_KEY', 'gpt-4.1-mini', 'https://api.openai.com/v1/chat/completions'],
          deepseek: ['DEEPSEEK_API_KEY', 'deepseek-flash', 'https://api.deepseek.com/chat/completions'],
          anthropic: ['ANTHROPIC_API_KEY', null, 'https://api.anthropic.com/v1/messages'] }[provider];
        if (!conf) throw new Error('Unknown AI provider.');
        const key = req.headers['x-user-key'] || env[conf[0]];
        if (!key) return json(res, 501, { error: { message: `Add a ${provider} API key in the app or on the server.` } });
        const input = JSON.parse((await readBody(req)).toString()), model = String(req.headers['x-ai-model'] || conf[1]);
        if(provider==='deepseek')return await deepSeekRequest(req,res,input,model,key,apiFetch,signal,deps.aiTimeoutMs);
        let url = conf[2], payload = input;
        const headers = { 'Content-Type': 'application/json' };
        if (provider === 'anthropic') Object.assign(headers, { 'x-api-key': key, 'anthropic-version': '2023-06-01' });
        else {
          headers.Authorization = `Bearer ${key}`;
          if (provider === 'openai' && !OPENAI_MODELS.some(m => m.id === model)) throw new Error('Choose a supported text model.');
          const messages = (input.messages || []).map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : (m.content || []).map(c => c.text || '').join('\n') }));
          if (input.system) messages.unshift({ role: 'system', content: input.system });
          if (provider === 'openai' && usesResponses(model)) {
            url = 'https://api.openai.com/v1/responses';
            payload = { model, input: messages, store: false, reasoning: { effort: 'low' },
              max_output_tokens: Math.min(32768, Math.max(8192, Number(input.max_tokens) || 1000)) };
          } else {
            payload = { model, messages };
            if (!/reason|-r1|thinking/i.test(model)) payload.max_tokens = input.max_tokens || 4096;

          }
        }
        const response = await apiFetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal });
        if (!response.ok || provider === 'anthropic') return sendUpstream(res, response);
        const data = await response.json();
        const text = usesResponses(model) && provider === 'openai'
          ? (data.output || []).filter(o => o.type === 'message').flatMap(o => o.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('\n')
          : data.choices?.[0]?.message?.content;
        if (data.status === 'incomplete' || data.choices?.[0]?.finish_reason === 'length') {

          return json(res, 502, { error: { message: `${model} reached its output limit. Try a smaller batch.` } });
        }
        if (!text) return json(res, 502, { error: { message: `${model} returned no answer. Try a smaller batch.` } });
        return json(res, 200, { content: [{ type: 'text', text }] });
      }
      const engine = String(req.headers['x-engine'] || 'openai');
      const conf = { openai: ['https://api.openai.com/v1/audio/transcriptions', 'OPENAI_API_KEY', 'whisper-1'],
        groq: ['https://api.groq.com/openai/v1/audio/transcriptions', 'GROQ_API_KEY', 'whisper-large-v3'],
        local: [env.LOCAL_WHISPER_URL || 'http://127.0.0.1:8000/v1/audio/transcriptions', null, env.LOCAL_WHISPER_MODEL || 'Systran/faster-whisper-large-v3'] }[engine];
      if (!conf) throw new Error('Unknown transcription engine.');
      const key = conf[1] ? (req.headers['x-user-key'] || env[conf[1]]) : '';
      if (conf[1] && !key) return json(res, 501, { error: { message: `Add a ${engine} API key in the app or on the server.` } });
      const model = String(req.headers['x-model'] || conf[2]);
      if (engine === 'openai' && !TRANSCRIPTION_MODELS.some(m => m.id === model)) throw new Error('Choose a supported transcription model.');
      const bytes = await readBody(req, 25 * 1024 * 1024);
      const fd = new FormData(); fd.append('file', new Blob([bytes]), decodeURIComponent(req.headers['x-filename'] || 'audio.wav'));
      fd.append('model', model);
      const timed = engine !== 'openai' || model === 'whisper-1';
      fd.append('response_format', timed ? 'verbose_json' : 'json');
      if (timed) { fd.append('timestamp_granularities[]', 'word'); fd.append('timestamp_granularities[]', 'segment'); }
      const language = req.headers['x-language'], prompt = decodeURIComponent(req.headers['x-prompt'] || '');
      if (language && language !== 'auto') fd.append(model === 'gpt-transcribe' ? 'languages[]' : 'language', language);
      if (prompt) fd.append('prompt', prompt);
      const response = await apiFetch(conf[0], { method: 'POST', body: fd,
        headers: key ? { Authorization: `Bearer ${key}` } : {}, signal });
      return sendUpstream(res, response);
    } catch (error) {
      if (!controller.signal.aborted && !res.destroyed) return json(res, error.status || 502, { error: { message: error.message } });
    } finally { req.off('aborted', disconnected); res.off('close', closed); }
  };
}
