# Transcriber v2.36 — DeepSeek API model and response handling

The model dropdown now offers the documented `deepseek-flash` (V4.1 Flash) and `deepseek-v4-pro` IDs. Thinking is an independent Off / Low / High / Maximum control, defaulting to Off. Refresh DeepSeek models retrieves the authenticated `/models` list; unavailable selections reset to an available model. The backend still accepts old Chat/Reasoner/Flash aliases. Model IDs and thinking effort are validated separately, and request bodies use the selected provider/model rather than a hardcoded Claude ID.

DeepSeek requests use upstream SSE streaming. The browser receives normalized waiting/thinking/generating status and ten-second keepalives, plus a single final result. This avoids the previous silent, non-streaming wait. Each request has a three-minute total server deadline and a 200-second browser deadline. Cancel AI propagates to the provider, including after response headers arrive. The parser handles keepalive comments, split UTF-8 chunks, finish reasons and interrupted streams. Private reasoning content is never returned as an answer. Empty answers, provider errors and timeouts clear the busy state with useful feedback.

Structured review, clip, translation and assembly requests explicitly select JSON object mode with a JSON schema example in their prompts. Freeform requests remain prose. Clip finding uses a `clips` object property; translation uses `translations` with exact input cue IDs. Legacy array responses remain accepted, but unknown, duplicate, missing or reversed IDs/ranges are rejected before edits. Existing review/assembly parsers continue validating issued targets. Truncated structured output is marked incomplete for the caller's bounded batch-splitting logic; it is not applied or retried again at the provider layer. Non-thinking freeform output retains its existing single larger-budget retry and partial-output/Continue workflow. Thinking translation batches use eight cues.

The app deliberately bounds initial output to 8K/16K tokens and caps retries at 32K. These are application budgets, not claims about DeepSeek's maximum capacity. Higher thinking levels can still exceed the request deadline; Flash with thinking Off is the responsive editing default.

Verified against official DeepSeek documentation on 2026-10-15:

- [Current model list](https://api-docs.deepseek.com/api/list-models/)
- [Thinking and effort parameters](https://api-docs.deepseek.com/guides/thinking_mode/)
- [JSON output requirements](https://api-docs.deepseek.com/guides/json_mode/)
- [Chat completions, streaming and finish reasons](https://api-docs.deepseek.com/api/create-chat-completion/)
- [Keepalive behavior](https://api-docs.deepseek.com/quick_start/rate_limit/)

Regression tests cover model mapping/discovery, JSON/prose separation, thinking settings, Unicode SSE framing, private reasoning exclusion, truncated/empty/interrupted/error replies, timeout, cancellation and browser busy-state recovery. Providers are mocked; no paid inference was needed. GitHub CI runs HTTP integration tests, all browser suites and the deployment image build. Signed-in Render and live provider latency are not independently verified by these tests.
