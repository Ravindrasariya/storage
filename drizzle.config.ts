import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // Leave one-off, date-suffixed heal/snapshot backup tables (e.g.
  // `cold_charges_heal_snapshot_2026_05_29`) untouched. They are intentional
  // safety backups created by past one-time migrations and are not part of the
  // app schema, so `db:push` would otherwise try to DROP them and block on an
  // interactive data-loss prompt (which hangs non-interactive post-merge/deploy
  // runs). This preserves the backups while keeping `push` non-interactive.
  tablesFilter: ["!*_[0-9][0-9][0-9][0-9]_[0-9][0-9]_[0-9][0-9]"],
});
