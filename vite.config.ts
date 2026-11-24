import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    build: {
      rollupOptions: {
        output: {
          // Só o Supabase tem chunk fixo (cache longo). Gráficos, PDF e Excel já ficam fora da
          // entrada porque as telas que os usam são carregadas sob demanda.
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('@supabase')) return 'supabase';
            return undefined;
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
