import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { logger } from "./logger";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // keepAlive håller TCP-anslutningen vid liv så att managed-PG/idle-reapers
  // inte tyst tappar den mitt i en period av inaktivitet.
  keepAlive: true,
  // Återvinn lediga anslutningar innan managed-PG hinner reapa dem server-side.
  idleTimeoutMillis: 30_000,
});

// KRITISKT: en ledig (idle) klient vars anslutning tappas server-side — t.ex.
// vid managed-Postgres-underhåll/skalning eller idle-reaping (SQLSTATE 57P01,
// "terminating connection due to administrator command") — avger ett 'error'-
// event på poolen. UTAN denna lyssnare eskalerar Node felet till en
// uncaughtException → process.exit(1) i server/index.ts → HELA servern startar
// om (~60s observerad nedtid i prod), vilket gör att inloggning och alla andra
// requests under fönstret får ett rått "Internal Server Error" från edgen.
// Logga och absorbera: pg-poolen kastar den döda anslutningen och öppnar en ny
// transparent vid nästa query.
pool.on("error", (err: Error & { code?: string }) => {
  logger.error(
    { err, code: err?.code },
    "[db] idle pool client error — absorberad, servern hålls vid liv",
  );
});

export const db = drizzle(pool, { schema });
