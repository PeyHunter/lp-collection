import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate as runMigrations } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import pg from "pg";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export type Database = ReturnType<typeof connectDatabase>;

export function connectDatabase(url: string) {
  const pool = new pg.Pool({ connectionString: url });
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
