import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { iconikPlugin } from './server/iconik.js';
import { mediaMiddleware } from './server/media.js';
import { providerMiddleware } from './server/providers.js';
function apiPlugin(env) {
  const media = mediaMiddleware(env), providers = providerMiddleware(env);
  const setup = server => {
    server.middlewares.use(media); server.middlewares.use(providers);
    server.httpServer?.once('close', () => void media.close());
  };
  return { name: 'transcriber-api', configureServer: setup, configurePreviewServer: setup };
}
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  return { plugins: [react(), iconikPlugin(env), apiPlugin(env)], server: { port: 5173, open: true }, build: { outDir: 'dist' } };
});
