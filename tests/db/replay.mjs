// Diagnóstico: aplica as migrações uma a uma. Uso: node tests/db/replay.mjs [--hashes] [--twice]
// --hashes imprime md5(prosrc) das funções de public (para comparar com produção, só leitura).
// --twice reaplica 048+ para provar idempotência.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadSchema, migrationFiles, MIG_DIR } from './load.mjs';

const db = await PGlite.create();
try {
  await loadSchema(db, { log: console.log });
} catch (e) { console.log('FALHA', e.message); process.exit(1); }
if (process.argv.includes('--twice')) {
  for (const f of migrationFiles().filter(f => f >= '048')) {
    try { await db.exec(readFileSync(path.join(MIG_DIR, f), 'utf8')); console.log('reaplicada ok', f); }
    catch (e) { console.log('FALHA na reaplicação', f, e.message); process.exit(1); }
  }
}
if (process.argv.includes('--hashes')) {
  const r = await db.query(`select p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' f, md5(replace(p.prosrc, chr(13), '')) h from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1`);
  for (const x of r.rows) console.log('H', x.f, x.h);
}
await db.close();
