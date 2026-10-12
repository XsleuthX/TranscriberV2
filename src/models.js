export const OPENAI_MODELS = [
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', note: 'fast translation and edits' },
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', note: 'translation, editing and story reasoning' },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna', note: 'lighter text tasks' },
  { id: 'gpt-6-astra', label: 'GPT-6 Astra', note: 'complex story work' },
  { id: 'gpt-4.1', label: 'GPT-4.1', note: 'text translation and editing' },
  { id: 'gpt-4o-mini', label: 'GPT-4o mini', note: 'lightweight text tasks' },
  { id: 'gpt-4o', label: 'GPT-4o', note: 'text translation and editing' },
  { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo', note: 'legacy text option' },
  { id: 'gpt-4-turbo', label: 'GPT-4 Turbo', note: 'legacy text option' },
];
export const TRANSCRIPTION_MODELS = [
  { id: 'whisper-1', label: 'Whisper-1 — native word timestamps' },
  { id: 'gpt-transcribe', label: 'GPT-Transcribe + Whisper timing' },
  { id: 'gpt-4o-transcribe', label: 'GPT-4o Transcribe + Whisper timing' },
  { id: 'gpt-4o-mini-transcribe', label: 'GPT-4o mini Transcribe + Whisper timing' },
];
export const usesResponses = model => /^gpt-6(?:[.-]|$)/.test(model);
