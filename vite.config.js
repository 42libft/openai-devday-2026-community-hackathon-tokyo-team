import { defineConfig, loadEnv } from 'vite';
import { createHandler } from './api/decide.js';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), 'OPENAI_API_KEY');
  const api = createHandler({getApiKey: () => process.env.OPENAI_API_KEY || env.OPENAI_API_KEY});
  const mountApi = (server) => {
    server.middlewares.use('/api/decide', (req, res) => { void api(req, res); });
  };
  return {
  plugins: [{name:'decisions-local-api',configureServer:mountApi,configurePreviewServer:mountApi}],
  base: './',
  appType: 'mpa',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, modulePreload: false },
  };
});
