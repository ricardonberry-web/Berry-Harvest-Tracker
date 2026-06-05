import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workersTable } from "./workers";

export const attendanceTable = pgTable(
  "worker_attendance",
  {
    id: serial("id").primaryKey(),
    workerId: text("worker_id").notNull().references(() => workersTable.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    checkInAt: timestamp("check_in_at", { withTimezone: true }).notNull().defaultNow(),
    checkOutAt: timestamp("check_out_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Multiple shifts (entradas/saídas) per worker per day are allowed, so this
    // is a plain (non-unique) index to keep per-worker/day lookups fast.
    workerDayIdx: index("worker_attendance_worker_day_idx").on(t.workerId, t.date),
  }),
);

export const insertAttendanceSchema = createInsertSchema(attendanceTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;
export type Attendance = typeof attendanceTable.$inferSelect;
