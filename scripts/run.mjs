// Native config loading also works in restricted Windows environments where
// esbuild cannot enumerate parent directories while bundling vite.config.js.
import { build, createServer, preview } from 'vite';
import config from '../vite.config.js';
const command = process.argv[2] || 'dev';
const mode = command === 'dev' ? 'development' : 'production';
const options = { ...config({ mode }), configFile: false,
  esbuild: { tsconfigRaw: { compilerOptions: { jsx: 'automatic' } } } };
if (command === 'build') await build(options);
else if (command === 'preview') { const server = await preview(options); server.printUrls(); }
else {
  const server = await createServer({ ...options, server: { ...options.server, open: !process.env.NO_OPEN } });
  await server.listen(); server.printUrls();
}
