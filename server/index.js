import { createAppServer } from './app.js';
try { process.loadEnvFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const server = createAppServer(process.env);
const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const port = Number(process.env.PORT) || 3000;
server.listen(port, host, () => console.log(`Transcriber listening on ${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  server.close(); server.closeAllConnections();
});
