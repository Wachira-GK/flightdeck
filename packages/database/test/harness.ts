import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'supabase', 'migrations');

export type Who =
  | { role: 'anon' }
  | { role: 'authenticated'; uid: string }
  | { role: 'service_role' };

export const anon: Who = { role: 'anon' };
export const service: Who = { role: 'service_role' };
export const user = (uid: string): Who => ({ role: 'authenticated', uid });

export interface Db {
  pg: PGlite;
  /** Run statements as `who` inside a transaction that is always rolled back. */
  as<T = Record<string, unknown>>(who: Who, sql: string, params?: unknown[]): Promise<T[]>;
  /** Run a multi-step scenario; `step` switches role per statement. Always rolled back. */
  scenario<T>(fn: (step: <R = Record<string, unknown>>(who: Who | 'postgres', sql: string, params?: unknown[]) => Promise<R[]>) => Promise<T>): Promise<T>;
}

async function switchTo(pg: PGlite, who: Who | 'postgres') {
  await pg.exec('reset role');
  if (who === 'postgres') return;
  const uid = who.role === 'authenticated' ? who.uid : '';
  await pg.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
  await pg.exec(`set local role ${who.role}`);
}

export async function createDb(seedSql: string): Promise<Db> {
  const pg = new PGlite();
  await pg.exec(readFileSync(join(here, 'supabase-shim.sql'), 'utf8'));
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    await pg.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  }
  await pg.exec(seedSql);
  // Mutation testing: inject a deliberate security regression to prove the suite catches it.
  if (process.env.RLS_MUTATION) await pg.exec(process.env.RLS_MUTATION);

  const scenario: Db['scenario'] = async (fn) => {
    await pg.exec('begin');
    try {
      return await fn(async (who, sql, params = []) => {
        await switchTo(pg, who);
        return (await pg.query(sql, params)).rows as never;
      });
    } finally {
      await pg.exec('rollback');
    }
  };

  return {
    pg,
    scenario,
    as: (who, sql, params) => scenario((step) => step(who, sql, params)),
  };
}

/** Matches PostgreSQL authorisation failures: missing grant, RLS WITH CHECK, or our 42501 guards. */
export const DENIED = /permission denied|row-level security|is immutable|not an assigned reviewer|cannot publish own|attempt limit/i;
