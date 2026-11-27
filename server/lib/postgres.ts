import dotenv from "dotenv";
dotenv.config();
import { Pool, PoolConfig } from "pg";
import { logger } from "./logger";

let pool: Pool | null = null;
let isInitialized = false;
let isConnected = false;
let initPromise: Promise<Pool | null> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

export interface ProductionStatePayload {
  piDatabase: any[];
  glassItemsDatabase: any[];
  productionHistoryDatabase: any[];
  rejectDatabase: any[];
  reworkDatabase: any[];
  notificationsDatabase: any[];
}

interface SnapshotEntry {
  json: string;
  sortOrder: number;
}

interface TableDiff<T> {
  upserts: Array<{ item: T; json: string; sortOrder: number }>;
  deletedIds: string[];
  nextMinOrder: number;
  nextMaxOrder: number;
}

const tableSnapshots: Record<string, Map<string, SnapshotEntry>> = {
  pis: new Map(),
  glass_items: new Map(),
  production_history: new Map(),
  rejects: new Map(),
  reworks: new Map(),
  notifications: new Map(),
  users: new Map(),
  revoked_users: new Map(),
};

const tableBounds: Record<string, { min: number; max: number }> = {
  pis: { min: 0, max: 0 },
  glass_items: { min: 0, max: 0 },
  production_history: { min: 0, max: 0 },
  rejects: { min: 0, max: 0 },
  reworks: { min: 0, max: 0 },
};

let productionLoadedFromDb = false;
let usersLoadedFromDb = false;

export function isNonRuntimeEnvironment(): boolean {
  return Boolean(
    process.env.npm_lifecycle_event === "build" ||
      process.env.npm_lifecycle_event === "build:client" ||
      process.env.npm_lifecycle_event === "build:server" ||
      process.argv.includes("build") ||
      process.env.VITEST ||
      process.env.NODE_ENV === "test"
  );
}

export function sanitizeDbIdentifier(name: string): string {
  const cleaned = String(name || "").trim().replace(/[^a-zA-Z0-9_]/g, "_");
  return cleaned || "glass_production_dev";
}

export function getTargetDbName(): string {
  const url = (process.env.DATABASE_URL || "").trim();
  if (url) {
    try {
      const parsed = new URL(url);
      const dbPath = parsed.pathname.replace(/^\/+/, "").trim();
      if (dbPath) return dbPath;
    } catch {
      // Fall back to PGDATABASE / env default if URL parsing fails
    }
  }

  const configured = (process.env.PGDATABASE || "").trim();
  if (configured) return configured;

  return process.env.NODE_ENV === "production" ? "glass_production_erp" : "glass_production_dev";
}

export function getPoolConfig(databaseOverride?: string): PoolConfig {
  const url = (process.env.DATABASE_URL || "").trim();
  const useSsl =
    process.env.PGSSL === "true" ||
    (url.includes("sslmode=require") && !url.includes("sslmode=disable"));
  const ssl = useSsl ? { rejectUnauthorized: false } : undefined;

  if (url) {
    let connectionString = url;
    if (databaseOverride) {
      try {
        const parsed = new URL(url);
        parsed.pathname = `/${databaseOverride}`;
        connectionString = parsed.toString();
      } catch {
        // Keep original URL if unparseable
      }
    }
    return {
      connectionString,
      max: 15,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl,
    };
  }

  return {
    host: (process.env.PGHOST || "127.0.0.1").trim(),
    port: Number(process.env.PGPORT || 5432),
    user: (process.env.PGUSER || "postgres").trim(),
    password: process.env.PGPASSWORD ?? "postgres",
    database: databaseOverride || getTargetDbName(),
    max: 15,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl,
  };
}

async function ensureDatabaseExists(targetDbName: string): Promise<void> {
  const safeDb = sanitizeDbIdentifier(targetDbName);
  const adminPool = new Pool(getPoolConfig("postgres"));
  try {
    const existing = await adminPool.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [safeDb]
    );
    if (existing.rowCount === 0) {
      await adminPool.query(`CREATE DATABASE "${safeDb}"`);
      logger.info(`[PostgreSQL] Created local database "${safeDb}"`);
    }
  } finally {
    await adminPool.end().catch(() => {});
  }
}

async function ensureSchema(pgPool: Pool): Promise<void> {
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS pis (
      id TEXT PRIMARY KEY,
      pi_number TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      data JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pis_pi_number ON pis (pi_number);
    CREATE INDEX IF NOT EXISTS idx_pis_file_name_lower ON pis (LOWER(file_name));
    CREATE INDEX IF NOT EXISTS idx_pis_status ON pis (status);

    CREATE TABLE IF NOT EXISTS glass_items (
      id TEXT PRIMARY KEY,
      pi_id TEXT NOT NULL DEFAULT '',
      pi_number TEXT NOT NULL DEFAULT '',
      serial_number TEXT NOT NULL DEFAULT '',
      barcode TEXT NOT NULL DEFAULT '',
      current_stage TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      is_dispatched BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      data JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_glass_items_pi_id ON glass_items (pi_id);
    CREATE INDEX IF NOT EXISTS idx_glass_items_pi_number ON glass_items (pi_number);
    CREATE INDEX IF NOT EXISTS idx_glass_items_serial ON glass_items (serial_number);
    CREATE INDEX IF NOT EXISTS idx_glass_items_barcode ON glass_items (barcode);
    CREATE INDEX IF NOT EXISTS idx_glass_items_stage_status ON glass_items (current_stage, status, is_dispatched);

    CREATE TABLE IF NOT EXISTS production_history (
      id TEXT PRIMARY KEY,
      serial_number TEXT NOT NULL DEFAULT '',
      barcode TEXT NOT NULL DEFAULT '',
      pi_number TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT '',
      ts TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      data JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_prod_history_serial ON production_history (serial_number);
    CREATE INDEX IF NOT EXISTS idx_prod_history_pi ON production_history (pi_number);
    CREATE INDEX IF NOT EXISTS idx_prod_history_ts ON production_history (ts DESC);

    CREATE TABLE IF NOT EXISTS rejects (
      id TEXT PRIMARY KEY,
      serial_number TEXT NOT NULL DEFAULT '',
      pi_number TEXT NOT NULL DEFAULT '',
      resolved BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      data JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rejects_serial ON rejects (serial_number);

    CREATE TABLE IF NOT EXISTS reworks (
      id TEXT PRIMARY KEY,
      serial_number TEXT NOT NULL DEFAULT '',
      pi_number TEXT NOT NULL DEFAULT '',
      resolved BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      data JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reworks_serial ON reworks (serial_number);

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      raw_date BIGINT NOT NULL DEFAULT 0,
      read BOOLEAN NOT NULL DEFAULT FALSE,
      data JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_raw_date ON notifications (raw_date DESC);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      data JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS revoked_users (
      key TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function getPostgresPool(): Promise<Pool | null> {
  if (isNonRuntimeEnvironment()) return null;
  if (pool && isInitialized && isConnected) return pool;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const targetDb = getTargetDbName();
    try {
      let candidatePool = new Pool(getPoolConfig(targetDb));
      try {
        await candidatePool.query("SELECT 1");
      } catch (err: any) {
        if (err?.code === "3D000") {
          await candidatePool.end().catch(() => {});
          await ensureDatabaseExists(targetDb);
          candidatePool = new Pool(getPoolConfig(targetDb));
          await candidatePool.query("SELECT 1");
        } else {
          await candidatePool.end().catch(() => {});
          throw err;
        }
      }

      await ensureSchema(candidatePool);
      pool = candidatePool;
      isInitialized = true;
      isConnected = true;
      logger.info(
        `[PostgreSQL] Connected to local database "${targetDb}" (env: ${process.env.NODE_ENV || "development"})`
      );
      return pool;
    } catch (err: any) {
      isConnected = false;
      logger.error("[PostgreSQL] Connection/initialization error", {
        database: targetDb,
        error: err?.message || String(err),
      });
      return null;
    }
  })();

  const resolved = await initPromise;
  if (!resolved) initPromise = null;
  return resolved;
}

export function isPostgresActive(): boolean {
  return Boolean(isInitialized && isConnected && pool);
}

export function isPostgresConfigured(): boolean {
  return Boolean(
    process.env.DATABASE_URL ||
      process.env.PGHOST ||
      process.env.PGDATABASE ||
      process.env.PGUSER
  );
}

/**
 * Compute minimal row-level diff against the last persisted snapshot.
 * Preserves array order (including unshift at front and push at back) in O(N) without updating unchanged rows.
 */
export function computeTableDiff<T extends { id?: string }>(
  items: T[],
  snapshot: Map<string, SnapshotEntry>,
  bounds: { min: number; max: number }
): TableDiff<T> {
  const seenIds = new Set<string>();
  const newFrontIndices: number[] = [];
  let firstExistingIdx = -1;

  for (let i = 0; i < items.length; i++) {
    const id = items[i]?.id;
    if (!id) continue;
    seenIds.add(id);
    if (!snapshot.has(id) && firstExistingIdx === -1) {
      newFrontIndices.push(i);
    } else if (snapshot.has(id) && firstExistingIdx === -1) {
      firstExistingIdx = i;
    }
  }

  let nextMin = bounds.min;
  let nextMax = bounds.max;
  const assignedOrder = new Map<number, number>();

  // Assign decreasing sortOrder to items unshifted at the front so ORDER BY sort_order ASC stays exact
  if (newFrontIndices.length > 0 && firstExistingIdx !== -1) {
    const count = newFrontIndices.length;
    for (let k = 0; k < count; k++) {
      assignedOrder.set(newFrontIndices[k], nextMin - (count - k));
    }
    nextMin -= count;
  }

  const upserts: Array<{ item: T; json: string; sortOrder: number }> = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const id = item?.id;
    if (!id) continue;

    const json = JSON.stringify(item);
    const existing = snapshot.get(id);
    if (existing) {
      if (existing.json !== json) {
        upserts.push({ item, json, sortOrder: existing.sortOrder });
      }
    } else {
      const sortOrder = assignedOrder.has(i) ? assignedOrder.get(i)! : ++nextMax;
      upserts.push({ item, json, sortOrder });
    }
  }

  const deletedIds: string[] = [];
  for (const id of snapshot.keys()) {
    if (!seenIds.has(id)) {
      deletedIds.push(id);
    }
  }

  return { upserts, deletedIds, nextMinOrder: nextMin, nextMaxOrder: nextMax };
}

function hydrateOrderedSnapshot(
  table: string,
  rows: Array<{ id: string; sort_order: number; data: any }>
): any[] {
  const snap = tableSnapshots[table];
  snap.clear();
  let min = 0;
  let max = 0;
  const items: any[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const order = Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : i + 1;
    if (i === 0 || order < min) min = order;
    if (i === 0 || order > max) max = order;
    snap.set(row.id, { json: JSON.stringify(row.data), sortOrder: order });
    items.push(row.data);
  }
  if (tableBounds[table]) {
    tableBounds[table].min = min;
    tableBounds[table].max = max;
  }
  return items;
}

export async function loadProductionFromPostgres(): Promise<ProductionStatePayload | null> {
  const pgPool = await getPostgresPool();
  if (!pgPool) return null;

  try {
    const [pisRes, itemsRes, histRes, rejRes, rewRes, notifRes] = await Promise.all([
      pgPool.query("SELECT id, sort_order, data FROM pis ORDER BY sort_order ASC"),
      pgPool.query("SELECT id, sort_order, data FROM glass_items ORDER BY sort_order ASC"),
      pgPool.query("SELECT id, sort_order, data FROM production_history ORDER BY sort_order ASC"),
      pgPool.query("SELECT id, sort_order, data FROM rejects ORDER BY sort_order ASC"),
      pgPool.query("SELECT id, sort_order, data FROM reworks ORDER BY sort_order ASC"),
      pgPool.query("SELECT id, raw_date, data FROM notifications ORDER BY raw_date DESC"),
    ]);

    const piDatabase = hydrateOrderedSnapshot("pis", pisRes.rows);
    const glassItemsDatabase = hydrateOrderedSnapshot("glass_items", itemsRes.rows);
    const productionHistoryDatabase = hydrateOrderedSnapshot("production_history", histRes.rows);
    const rejectDatabase = hydrateOrderedSnapshot("rejects", rejRes.rows);
    const reworkDatabase = hydrateOrderedSnapshot("reworks", rewRes.rows);

    const notifSnap = tableSnapshots.notifications;
    notifSnap.clear();
    const notificationsDatabase: any[] = [];
    for (const row of notifRes.rows) {
      notifSnap.set(row.id, { json: JSON.stringify(row.data), sortOrder: Number(row.raw_date) || 0 });
      notificationsDatabase.push(row.data);
    }

    productionLoadedFromDb = true;
    return {
      piDatabase,
      glassItemsDatabase,
      productionHistoryDatabase,
      rejectDatabase,
      reworkDatabase,
      notificationsDatabase,
    };
  } catch (err: any) {
    logger.error("[PostgreSQL] Failed to load production state", {
      error: err?.message || String(err),
    });
    return null;
  }
}

export function saveProductionToPostgres(state: ProductionStatePayload): Promise<boolean> {
  if (isNonRuntimeEnvironment()) return Promise.resolve(false);

  const task = writeQueue.then(async () => {
    const pgPool = await getPostgresPool();
    if (!pgPool) return;

    // Safeguard: wait until initial load completes if snapshots are still empty and incoming state is empty
    const incomingEmpty =
      state.piDatabase.length === 0 &&
      state.glassItemsDatabase.length === 0 &&
      state.productionHistoryDatabase.length === 0 &&
      state.rejectDatabase.length === 0 &&
      state.reworkDatabase.length === 0 &&
      state.notificationsDatabase.length === 0;

    if (!productionLoadedFromDb && incomingEmpty) {
      return;
    }

    const piDiff = computeTableDiff(state.piDatabase, tableSnapshots.pis, tableBounds.pis);
    const itemDiff = computeTableDiff(state.glassItemsDatabase, tableSnapshots.glass_items, tableBounds.glass_items);
    const histDiff = computeTableDiff(
      state.productionHistoryDatabase,
      tableSnapshots.production_history,
      tableBounds.production_history
    );
    const rejDiff = computeTableDiff(state.rejectDatabase, tableSnapshots.rejects, tableBounds.rejects);
    const rewDiff = computeTableDiff(state.reworkDatabase, tableSnapshots.reworks, tableBounds.reworks);
    const notifDiff = computeTableDiff(state.notificationsDatabase, tableSnapshots.notifications, {
      min: 0,
      max: 0,
    });

    const hasAnyChanges =
      piDiff.upserts.length > 0 ||
      piDiff.deletedIds.length > 0 ||
      itemDiff.upserts.length > 0 ||
      itemDiff.deletedIds.length > 0 ||
      histDiff.upserts.length > 0 ||
      histDiff.deletedIds.length > 0 ||
      rejDiff.upserts.length > 0 ||
      rejDiff.deletedIds.length > 0 ||
      rewDiff.upserts.length > 0 ||
      rewDiff.deletedIds.length > 0 ||
      notifDiff.upserts.length > 0 ||
      notifDiff.deletedIds.length > 0;

    if (!hasAnyChanges) return;

    const client = await pgPool.connect();
    try {
      await client.query("BEGIN");

      if (piDiff.deletedIds.length > 0) {
        await client.query("DELETE FROM pis WHERE id = ANY($1::text[])", [piDiff.deletedIds]);
      }
      if (piDiff.upserts.length > 0) {
        const rows = piDiff.upserts.map(({ item, sortOrder }) => ({
          id: item.id,
          pi_number: String(item.piNumber || ""),
          file_name: String(item.fileName || ""),
          status: String(item.status || ""),
          created_at: String(item.createdAt || ""),
          sort_order: sortOrder,
          data: item,
        }));
        await client.query(
          `INSERT INTO pis (id, pi_number, file_name, status, created_at, sort_order, data)
           SELECT id, pi_number, file_name, status, created_at, sort_order, data
           FROM jsonb_to_recordset($1::jsonb) AS x(
             id TEXT, pi_number TEXT, file_name TEXT, status TEXT, created_at TEXT, sort_order INTEGER, data JSONB
           )
           ON CONFLICT (id) DO UPDATE SET
             pi_number = EXCLUDED.pi_number,
             file_name = EXCLUDED.file_name,
             status = EXCLUDED.status,
             created_at = EXCLUDED.created_at,
             sort_order = EXCLUDED.sort_order,
             data = EXCLUDED.data`,
          [JSON.stringify(rows)]
        );
      }

      if (itemDiff.deletedIds.length > 0) {
        await client.query("DELETE FROM glass_items WHERE id = ANY($1::text[])", [itemDiff.deletedIds]);
      }
      if (itemDiff.upserts.length > 0) {
        const rows = itemDiff.upserts.map(({ item, sortOrder }) => ({
          id: item.id,
          pi_id: String(item.piId || ""),
          pi_number: String(item.piNumber || ""),
          serial_number: String(item.serialNumber || ""),
          barcode: String(item.barcode || ""),
          current_stage: String(item.currentStage || ""),
          status: String(item.status || ""),
          is_dispatched: Boolean(item.isDispatched || item.currentStage === "Dispatched"),
          updated_at: String(item.updatedAt || ""),
          sort_order: sortOrder,
          data: item,
        }));
        await client.query(
          `INSERT INTO glass_items (id, pi_id, pi_number, serial_number, barcode, current_stage, status, is_dispatched, updated_at, sort_order, data)
           SELECT id, pi_id, pi_number, serial_number, barcode, current_stage, status, is_dispatched, updated_at, sort_order, data
           FROM jsonb_to_recordset($1::jsonb) AS x(
             id TEXT, pi_id TEXT, pi_number TEXT, serial_number TEXT, barcode TEXT, current_stage TEXT, status TEXT, is_dispatched BOOLEAN, updated_at TEXT, sort_order INTEGER, data JSONB
           )
           ON CONFLICT (id) DO UPDATE SET
             pi_id = EXCLUDED.pi_id,
             pi_number = EXCLUDED.pi_number,
             serial_number = EXCLUDED.serial_number,
             barcode = EXCLUDED.barcode,
             current_stage = EXCLUDED.current_stage,
             status = EXCLUDED.status,
             is_dispatched = EXCLUDED.is_dispatched,
             updated_at = EXCLUDED.updated_at,
             sort_order = EXCLUDED.sort_order,
             data = EXCLUDED.data`,
          [JSON.stringify(rows)]
        );
      }

      if (histDiff.deletedIds.length > 0) {
        await client.query("DELETE FROM production_history WHERE id = ANY($1::text[])", [histDiff.deletedIds]);
      }
      if (histDiff.upserts.length > 0) {
        const rows = histDiff.upserts.map(({ item, sortOrder }) => ({
          id: item.id,
          serial_number: String(item.serialNumber || ""),
          barcode: String(item.barcode || ""),
          pi_number: String(item.piNumber || ""),
          stage: String(item.stage || ""),
          ts: String(item.timestamp || ""),
          sort_order: sortOrder,
          data: item,
        }));
        await client.query(
          `INSERT INTO production_history (id, serial_number, barcode, pi_number, stage, ts, sort_order, data)
           SELECT id, serial_number, barcode, pi_number, stage, ts, sort_order, data
           FROM jsonb_to_recordset($1::jsonb) AS x(
             id TEXT, serial_number TEXT, barcode TEXT, pi_number TEXT, stage TEXT, ts TEXT, sort_order INTEGER, data JSONB
           )
           ON CONFLICT (id) DO UPDATE SET
             serial_number = EXCLUDED.serial_number,
             barcode = EXCLUDED.barcode,
             pi_number = EXCLUDED.pi_number,
             stage = EXCLUDED.stage,
             ts = EXCLUDED.ts,
             sort_order = EXCLUDED.sort_order,
             data = EXCLUDED.data`,
          [JSON.stringify(rows)]
        );
      }

      if (rejDiff.deletedIds.length > 0) {
        await client.query("DELETE FROM rejects WHERE id = ANY($1::text[])", [rejDiff.deletedIds]);
      }
      if (rejDiff.upserts.length > 0) {
        const rows = rejDiff.upserts.map(({ item, sortOrder }) => ({
          id: item.id,
          serial_number: String(item.serialNumber || ""),
          pi_number: String(item.piNumber || ""),
          resolved: Boolean(item.resolved),
          sort_order: sortOrder,
          data: item,
        }));
        await client.query(
          `INSERT INTO rejects (id, serial_number, pi_number, resolved, sort_order, data)
           SELECT id, serial_number, pi_number, resolved, sort_order, data
           FROM jsonb_to_recordset($1::jsonb) AS x(
             id TEXT, serial_number TEXT, pi_number TEXT, resolved BOOLEAN, sort_order INTEGER, data JSONB
           )
           ON CONFLICT (id) DO UPDATE SET
             serial_number = EXCLUDED.serial_number,
             pi_number = EXCLUDED.pi_number,
             resolved = EXCLUDED.resolved,
             sort_order = EXCLUDED.sort_order,
             data = EXCLUDED.data`,
          [JSON.stringify(rows)]
        );
      }

      if (rewDiff.deletedIds.length > 0) {
        await client.query("DELETE FROM reworks WHERE id = ANY($1::text[])", [rewDiff.deletedIds]);
      }
      if (rewDiff.upserts.length > 0) {
        const rows = rewDiff.upserts.map(({ item, sortOrder }) => ({
          id: item.id,
          serial_number: String(item.serialNumber || ""),
          pi_number: String(item.piNumber || ""),
          resolved: Boolean(item.resolved),
          sort_order: sortOrder,
          data: item,
        }));
        await client.query(
          `INSERT INTO reworks (id, serial_number, pi_number, resolved, sort_order, data)
           SELECT id, serial_number, pi_number, resolved, sort_order, data
           FROM jsonb_to_recordset($1::jsonb) AS x(
             id TEXT, serial_number TEXT, pi_number TEXT, resolved BOOLEAN, sort_order INTEGER, data JSONB
           )
           ON CONFLICT (id) DO UPDATE SET
             serial_number = EXCLUDED.serial_number,
             pi_number = EXCLUDED.pi_number,
             resolved = EXCLUDED.resolved,
             sort_order = EXCLUDED.sort_order,
             data = EXCLUDED.data`,
          [JSON.stringify(rows)]
        );
      }

      if (notifDiff.deletedIds.length > 0) {
        await client.query("DELETE FROM notifications WHERE id = ANY($1::text[])", [notifDiff.deletedIds]);
      }
      if (notifDiff.upserts.length > 0) {
        const rows = notifDiff.upserts.map(({ item }) => ({
          id: item.id,
          raw_date: Number(item.rawDate) || Date.now(),
          read: Boolean(item.read),
          data: item,
        }));
        await client.query(
          `INSERT INTO notifications (id, raw_date, read, data)
           SELECT id, raw_date, read, data
           FROM jsonb_to_recordset($1::jsonb) AS x(
             id TEXT, raw_date BIGINT, read BOOLEAN, data JSONB
           )
           ON CONFLICT (id) DO UPDATE SET
             raw_date = EXCLUDED.raw_date,
             read = EXCLUDED.read,
             data = EXCLUDED.data`,
          [JSON.stringify(rows)]
        );
      }

      await client.query("COMMIT");

      const commitSnapshot = (
        table: string,
        diff: TableDiff<any>,
        bounds?: { min: number; max: number }
      ) => {
        const snap = tableSnapshots[table];
        for (const id of diff.deletedIds) snap.delete(id);
        for (const u of diff.upserts) {
          snap.set(u.item.id, { json: u.json, sortOrder: u.sortOrder });
        }
        if (bounds) {
          bounds.min = diff.nextMinOrder;
          bounds.max = diff.nextMaxOrder;
        }
      };

      commitSnapshot("pis", piDiff, tableBounds.pis);
      commitSnapshot("glass_items", itemDiff, tableBounds.glass_items);
      commitSnapshot("production_history", histDiff, tableBounds.production_history);
      commitSnapshot("rejects", rejDiff, tableBounds.rejects);
      commitSnapshot("reworks", rewDiff, tableBounds.reworks);
      commitSnapshot("notifications", notifDiff);
      productionLoadedFromDb = true;
    } catch (err: any) {
      await client.query("ROLLBACK").catch(() => {});
      logger.error("[PostgreSQL] Failed to save production changes", {
        error: err?.message || String(err),
      });
    } finally {
      client.release();
    }
  });

  writeQueue = task.catch(() => {});
  return task.then(() => true).catch(() => false);
}

export async function loadUsersFromPostgres(): Promise<{
  users: any[];
  revokedIds: string[];
  revokedUsernames: string[];
} | null> {
  const pgPool = await getPostgresPool();
  if (!pgPool) return null;

  try {
    const [usersRes, revokedRes] = await Promise.all([
      pgPool.query("SELECT id, data FROM users ORDER BY id ASC"),
      pgPool.query("SELECT key, kind, value FROM revoked_users"),
    ]);

    const userSnap = tableSnapshots.users;
    userSnap.clear();
    const users: any[] = [];
    for (const row of usersRes.rows) {
      userSnap.set(row.id, { json: JSON.stringify(row.data), sortOrder: 0 });
      users.push(row.data);
    }

    const revokedSnap = tableSnapshots.revoked_users;
    revokedSnap.clear();
    const revokedIds: string[] = [];
    const revokedUsernames: string[] = [];
    for (const row of revokedRes.rows) {
      revokedSnap.set(row.key, { json: row.value, sortOrder: 0 });
      if (row.kind === "id") revokedIds.push(row.value);
      else if (row.kind === "username") revokedUsernames.push(row.value);
    }

    usersLoadedFromDb = true;
    return { users, revokedIds, revokedUsernames };
  } catch (err: any) {
    logger.error("[PostgreSQL] Failed to load users", {
      error: err?.message || String(err),
    });
    return null;
  }
}

export function saveUsersToPostgres(
  users: any[],
  revokedIds: Set<string>,
  revokedUsernames: Set<string>
): Promise<boolean> {
  if (isNonRuntimeEnvironment()) return Promise.resolve(false);

  const task = writeQueue.then(async () => {
    const pgPool = await getPostgresPool();
    if (!pgPool) return;
    if (!usersLoadedFromDb && users.length === 0) return;

    const userDiff = computeTableDiff(users, tableSnapshots.users, { min: 0, max: 0 });

    const revokedEntries: Array<{ id: string; kind: string; value: string }> = [
      ...Array.from(revokedIds).map((v) => ({ id: `id:${v}`, kind: "id", value: v })),
      ...Array.from(revokedUsernames).map((v) => ({ id: `username:${v}`, kind: "username", value: v })),
    ];
    const revokedDiff = computeTableDiff(revokedEntries, tableSnapshots.revoked_users, { min: 0, max: 0 });

    if (
      userDiff.upserts.length === 0 &&
      userDiff.deletedIds.length === 0 &&
      revokedDiff.upserts.length === 0 &&
      revokedDiff.deletedIds.length === 0
    ) {
      return;
    }

    const client = await pgPool.connect();
    try {
      await client.query("BEGIN");

      if (userDiff.deletedIds.length > 0) {
        await client.query("DELETE FROM users WHERE id = ANY($1::text[])", [userDiff.deletedIds]);
      }
      if (userDiff.upserts.length > 0) {
        const rows = userDiff.upserts.map(({ item }) => ({
          id: item.id,
          username: String(item.username || "").toLowerCase(),
          email: String(item.email || "").toLowerCase(),
          is_active: item.isActive !== false,
          data: item,
        }));
        await client.query(
          `INSERT INTO users (id, username, email, is_active, data)
           SELECT id, username, email, is_active, data
           FROM jsonb_to_recordset($1::jsonb) AS x(
             id TEXT, username TEXT, email TEXT, is_active BOOLEAN, data JSONB
           )
           ON CONFLICT (id) DO UPDATE SET
             username = EXCLUDED.username,
             email = EXCLUDED.email,
             is_active = EXCLUDED.is_active,
             data = EXCLUDED.data`,
          [JSON.stringify(rows)]
        );
      }

      if (revokedDiff.deletedIds.length > 0) {
        await client.query("DELETE FROM revoked_users WHERE key = ANY($1::text[])", [revokedDiff.deletedIds]);
      }
      if (revokedDiff.upserts.length > 0) {
        const rows = revokedDiff.upserts.map(({ item }) => ({
          key: item.id,
          kind: item.kind,
          value: item.value,
        }));
        await client.query(
          `INSERT INTO revoked_users (key, kind, value)
           SELECT key, kind, value
           FROM jsonb_to_recordset($1::jsonb) AS x(
             key TEXT, kind TEXT, value TEXT
           )
           ON CONFLICT (key) DO UPDATE SET
             kind = EXCLUDED.kind,
             value = EXCLUDED.value`,
          [JSON.stringify(rows)]
        );
      }

      await client.query("COMMIT");

      for (const id of userDiff.deletedIds) tableSnapshots.users.delete(id);
      for (const u of userDiff.upserts) tableSnapshots.users.set(u.item.id, { json: u.json, sortOrder: 0 });
      for (const id of revokedDiff.deletedIds) tableSnapshots.revoked_users.delete(id);
      for (const u of revokedDiff.upserts) tableSnapshots.revoked_users.set(u.item.id, { json: u.json, sortOrder: 0 });
      usersLoadedFromDb = true;
    } catch (err: any) {
      await client.query("ROLLBACK").catch(() => {});
      logger.error("[PostgreSQL] Failed to save users", {
        error: err?.message || String(err),
      });
    } finally {
      client.release();
    }
  });

  writeQueue = task.catch(() => {});
  return task.then(() => true).catch(() => false);
}
