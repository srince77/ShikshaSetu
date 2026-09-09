import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getPool } from './client';

const MIGRATIONS_DIR = join(__dirname, 'migrations');

/**
 * Split a SQL file into individual statements. A plain `split(';')` would
 * carve the `BEGIN ... END;` blocks inside dollar-quoted plpgsql bodies into
 * bogus statements, so this skips over quoted strings/identifiers,
 * `$$...$$` / `$tag$...$tag$` bodies, and comments.
 */
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  const end = sql.length;
  while (i < end) {
    const rest = sql.slice(i);
    const ch = sql[i];
    if (ch === ';') {
      statements.push(current);
      current = '';
      i += 1;
      continue;
    }
    if (ch === '-' && rest.startsWith('--')) {
      const newline = rest.indexOf('\n');
      const lineEnd = newline === -1 ? end : i + newline + 1;
      current += sql.slice(i, lineEnd);
      i = lineEnd;
      continue;
    }
    if (ch === '/' && rest.startsWith('/*')) {
      const close = rest.indexOf('*/', 2);
      const blockEnd = close === -1 ? end : i + close + 2;
      current += sql.slice(i, blockEnd);
      i = blockEnd;
      continue;
    }
    if (ch === "'" || ch === '"') {
      current += ch;
      i += 1;
      while (i < end) {
        current += sql[i];
        if (sql[i] === ch) {
          if (sql[i + 1] === ch) {
            current += sql[i + 1];
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === '$') {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(rest)?.[0];
      if (tag) {
        const close = rest.indexOf(tag, tag.length);
        if (close !== -1) {
          current += rest.slice(0, close + tag.length);
          i += close + tag.length;
          continue;
        }
      }
    }
    current += ch;
    i += 1;
  }
  return statements.map((s) => s.trim()).filter((s) => s !== '');
}

async function main() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const applied = new Set(
    (await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name as string),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`applying ${file}`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const statement of splitSqlStatements(sql)) {
        await client.query(statement);
      }
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }

  console.log('migrations up to date');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
