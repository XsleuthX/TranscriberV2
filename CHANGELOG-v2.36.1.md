# Transcriber v2.36.1 — Production container startup fix

The v2.36 runtime Docker stage copied only `src/models.js`. The server also imports `src/deepseek-models.js`, so Render could build the image successfully but Node failed during startup with `ERR_MODULE_NOT_FOUND`.

The runtime image now copies the complete `src` dependency tree from the build stage. This keeps server/shared imports available as the app evolves. The web server continues serving frontend files only from `dist`.

CI now starts the built image in production mode and checks health, password protection, sign-in, the compiled frontend bundle, and DeepSeek routes without making external AI calls. Image build success alone is no longer the deployment check.
