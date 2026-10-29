import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate as runMigrations } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import pg from "pg";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export type Database = ReturnType<typeof connectDatabase>;

export function connectDatabase(url: string) {
  const pool = new pg.Pool({ connectionString: url });
  // An idle connection dropped by PostgreSQL (a restart, a failover) must not crash the app; the pool reconnects on the next query.
  pool.on("error", (error) => console.error(`PostgreSQL dropped an idle connection: ${error.message}`));
  const db = drizzle(pool);
  return {
    db,
    async isReachable() {
      try {
        await db.execute(sql`select 1`);
        return true;
      } catch {
        return false;
      }
    },
    close: () => pool.end(),
  };
}

export function migrate(database: Database) {
  return runMigrations(database.db, { migrationsFolder });
}
