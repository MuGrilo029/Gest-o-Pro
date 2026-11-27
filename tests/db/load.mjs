// Carrega stubs + base + migrações num PGlite. Compartilhado pelo harness (Vitest) e pelo replay (diagnóstico).
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');
export const MIG_DIR = path.join(ROOT, 'database', 'migrations');

// 001 não foi aplicada em produção (DROP ... CASCADE; substituída pela 007). Ver APLICADAS.md.
const SKIP = new Set(['001_create_push_subscriptions.sql']);

export function migrationFiles() {
  return readdirSync(MIG_DIR).filter(f => f.endsWith('.sql') && !SKIP.has(f)).sort();
}

// Extensões que o PGlite não tem: os stubs em stubs.sql fazem o papel delas.
function prepare(sql) {
  return sql
    .replace(/CREATE EXTENSION IF NOT EXISTS (pg_net|pg_cron|pgcrypto)[^;]*;/gi, '-- (extensão substituída por stub)')
    .replace(/FROM pg_available_extensions WHERE name = 'pg_cron'/g, 'FROM (SELECT 1) AS stub_pg_cron');
}

/** extra: arquivos de database/migrations/pendentes aplicados no fim (só teste; não estão em produção). */
export async function loadSchema(db, { upTo, log, extra = [] } = {}) {
  await db.exec(readFileSync(path.join(here, 'stubs.sql'), 'utf8'));
  await db.exec(readFileSync(path.join(ROOT, 'MASTER_SCHEMA.sql.example'), 'utf8'));
  for (const f of migrationFiles()) {
    if (upTo && f > upTo) break;
    try {
      await db.exec(prepare(readFileSync(path.join(MIG_DIR, f), 'utf8')));
      log?.(`ok ${f}`);
    } catch (e) {
      throw new Error(`migração ${f}: ${e.message}`);
    }
  }
  for (const f of extra) {
    await db.exec(prepare(readFileSync(path.join(MIG_DIR, 'pendentes', f), 'utf8')));
    log?.(`ok pendentes/${f}`);
  }
}
