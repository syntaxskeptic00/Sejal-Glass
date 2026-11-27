import { describe, it, expect } from "vitest";
import {
  computeTableDiff,
  getPoolConfig,
  getTargetDbName,
  sanitizeDbIdentifier,
} from "./postgres";

describe("PostgreSQL Local Storage Layer", () => {
  it("should sanitize database identifiers safely", () => {
    expect(sanitizeDbIdentifier("glass_production_dev")).toBe("glass_production_dev");
    expect(sanitizeDbIdentifier("glass-db; DROP TABLE users;")).toBe("glass_db__DROP_TABLE_users_");
    expect(sanitizeDbIdentifier("")).toBe("glass_production_dev");
  });

  it("should resolve local PostgreSQL database name and pool defaults", () => {
    const prevUrl = process.env.DATABASE_URL;
    const prevDb = process.env.PGDATABASE;
    delete process.env.DATABASE_URL;
    delete process.env.PGDATABASE;

    const dbName = getTargetDbName();
    expect(["glass_production_dev", "glass_production_erp"]).toContain(dbName);

    const cfg = getPoolConfig();
    expect(cfg.host).toBe(process.env.PGHOST || "127.0.0.1");
    expect(cfg.port).toBe(Number(process.env.PGPORT || 5432));

    if (prevUrl !== undefined) process.env.DATABASE_URL = prevUrl;
    if (prevDb !== undefined) process.env.PGDATABASE = prevDb;
  });

  it("should compute minimal incremental upserts and deletes without touching unchanged rows", () => {
    const snapshot = new Map([
      ["item-1", { json: JSON.stringify({ id: "item-1", stage: "Cutting" }), sortOrder: 1 }],
      ["item-2", { json: JSON.stringify({ id: "item-2", stage: "Cutting" }), sortOrder: 2 }],
      ["item-3", { json: JSON.stringify({ id: "item-3", stage: "Polishing" }), sortOrder: 3 }],
    ]);

    // Simulate: unshift item-0 at front, mutate item-2, keep item-1 unchanged, delete item-3
    const current = [
      { id: "item-0", stage: "Cutting" },
      { id: "item-1", stage: "Cutting" },
      { id: "item-2", stage: "Pairing" },
    ];

    const diff = computeTableDiff(current, snapshot, { min: 1, max: 3 });

    expect(diff.deletedIds).toEqual(["item-3"]);
    expect(diff.upserts.map((u) => u.item.id)).toEqual(["item-0", "item-2"]);
    expect(diff.upserts[0].sortOrder).toBe(0); // unshifted before existing min=1
    expect(diff.upserts[1].sortOrder).toBe(2); // preserves existing sortOrder
  });
});
