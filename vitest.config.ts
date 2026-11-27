import path from 'path';
import { defineConfig } from 'vitest/config';

// Edge Functions rodam no teste com um dublê do cliente (tests/doubles/supabaseEdge.ts). O Vite não resolve
// import por URL, então um plugin troca o esm.sh antes.
const edgeDoubles = {
  name: 'edge-doubles',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    const slash = (p: string) => p.split(path.sep).join('/');
    if (!slash(id).includes('/supabase/functions/')) return null;
    const double = slash(path.resolve(__dirname, 'tests/doubles/supabaseEdge.ts'));
    return code.replace('https://esm.sh/@supabase/supabase-js@2.39.0', double);
  },
};

export default defineConfig({
  plugins: [edgeDoubles],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
