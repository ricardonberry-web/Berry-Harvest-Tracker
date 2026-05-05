import { pgTable, serial, text, doublePrecision, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workersTable } from "./workers";

export const weighRecordsTable = pgTable("weigh_records", {
  id: serial("id").primaryKey(),
  workerId: text("worker_id").notNull().references(() => workersTable.id),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  weightGrams: doublePrecision("weight_grams").notNull(),
  unit: text("unit").notNull().default("g"),
  scaleId: text("scale_id").notNull(),
  rawLine: text("raw_line").notNull(),
  syncStatus: text("sync_status").notNull().default("SYNCED"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  // Optional quality flags reported by the operator at weigh time.
  // Values come from a fixed enum: CALIBRE, PENDUNCULOS, VERDE, MOLE, OUTROS.
  // Stored as a Postgres text[] for cheap filtering / aggregation.
  qualityIssues: text("quality_issues").array().notNull().default(sql`ARRAY[]::text[]`),
});

export const insertWeighRecordSchema = createInsertSchema(weighRecordsTable).omit({ id: true, createdAt: true });
export type InsertWeighRecord = z.infer<typeof insertWeighRecordSchema>;
export type WeighRecord = typeof weighRecordsTable.$inferSelect;
