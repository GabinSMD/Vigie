import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

/**
 * Base D1 simulée pour les tests : SQLite en mémoire (`node:sqlite`) derrière la petite partie
 * de l'API D1 qu'utilise le Worker (`prepare`, `bind`, `first`, `all`, `run`, `batch`).
 * Les migrations du dépôt (`worker/migrations/`) sont appliquées telles quelles.
 */

const MIGRATIONS = join(import.meta.dirname, '..', '..', 'migrations');

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    private readonly params: SQLInputValue[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new Statement(this.db, this.sql, values.map((v) => (v === undefined ? null : (v as SQLInputValue))));
  }

  async first<T>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T>() {
    return { success: true, results: this.db.prepare(this.sql).all(...this.params) as T[], meta: { changes: 0 } };
  }

  async run() {
    return this.exec();
  }

  exec() {
    const stmt = this.db.prepare(this.sql);
    if (/^\s*select/i.test(this.sql)) return { success: true, results: stmt.all(...this.params), meta: { changes: 0 } };
    const info = stmt.run(...this.params);
    return { success: true, results: [], meta: { changes: Number(info.changes) } };
  }
}

export function fakeD1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
  }
  const d1 = {
    prepare: (sql: string) => new Statement(db, sql),
    /** Comme D1 : tout le lot dans une transaction, annulée au premier échec. */
    batch: async (statements: Statement[]) => {
      db.exec('BEGIN');
      try {
        const results = statements.map((s) => s.exec());
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { d1: d1 as unknown as D1Database, sqlite: db };
}
