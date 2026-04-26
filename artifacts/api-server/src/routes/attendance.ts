import { Router, type IRouter } from "express";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, workersTable, attendanceTable } from "@workspace/db";

const router: IRouter = Router();

function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normaliseDate(input: unknown): string {
  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  return todayISO();
}

type AttendanceRow = {
  workerId: string;
  workerName: string;
  date: string;
  checkInAt: Date | null;
  checkOutAt: Date | null;
};

function serialiseEntry(row: AttendanceRow) {
  const checkIn = row.checkInAt ? new Date(row.checkInAt) : null;
  const checkOut = row.checkOutAt ? new Date(row.checkOutAt) : null;
  const hoursWorked =
    checkIn && checkOut
      ? Math.max(0, (checkOut.getTime() - checkIn.getTime()) / 3_600_000)
      : null;
  return {
    workerId: row.workerId,
    workerName: row.workerName,
    date: row.date,
    checkInAt: checkIn ? checkIn.toISOString() : null,
    checkOutAt: checkOut ? checkOut.toISOString() : null,
    hoursWorked: hoursWorked === null ? null : Number(hoursWorked.toFixed(2)),
  };
}

async function loadEntriesForDate(date: string) {
  const workers = await db
    .select()
    .from(workersTable)
    .orderBy(workersTable.name);

  const attendance = await db
    .select()
    .from(attendanceTable)
    .where(eq(attendanceTable.date, date));

  const byWorker = new Map(attendance.map((a) => [a.workerId, a]));

  return workers.map((w) =>
    serialiseEntry({
      workerId: w.id,
      workerName: w.name,
      date,
      checkInAt: byWorker.get(w.id)?.checkInAt ?? null,
      checkOutAt: byWorker.get(w.id)?.checkOutAt ?? null,
    }),
  );
}

router.get("/attendance", async (req, res): Promise<void> => {
  const date = normaliseDate(req.query.date);
  const entries = await loadEntriesForDate(date);
  res.json(entries);
});

router.post("/attendance/check-in", async (req, res): Promise<void> => {
  const workerId =
    typeof req.body?.workerId === "string" ? req.body.workerId.trim() : "";
  const date = normaliseDate(req.body?.date);
  if (!workerId) {
    res.status(400).json({ error: "workerId is required" });
    return;
  }

  const [worker] = await db
    .select()
    .from(workersTable)
    .where(eq(workersTable.id, workerId));
  if (!worker) {
    res.status(404).json({ error: "Worker not found" });
    return;
  }

  // Insert if absent; otherwise update check-in to now and clear check-out
  const existing = await db
    .select()
    .from(attendanceTable)
    .where(and(eq(attendanceTable.workerId, workerId), eq(attendanceTable.date, date)));

  let row;
  if (existing.length === 0) {
    [row] = await db
      .insert(attendanceTable)
      .values({ workerId, date, checkInAt: new Date(), checkOutAt: null })
      .returning();
  } else {
    [row] = await db
      .update(attendanceTable)
      .set({ checkInAt: new Date(), checkOutAt: null })
      .where(eq(attendanceTable.id, existing[0].id))
      .returning();
  }

  res.json(
    serialiseEntry({
      workerId: worker.id,
      workerName: worker.name,
      date,
      checkInAt: row.checkInAt,
      checkOutAt: row.checkOutAt,
    }),
  );
});

router.post("/attendance/check-out", async (req, res): Promise<void> => {
  const workerId =
    typeof req.body?.workerId === "string" ? req.body.workerId.trim() : "";
  const date = normaliseDate(req.body?.date);
  if (!workerId) {
    res.status(400).json({ error: "workerId is required" });
    return;
  }

  const [worker] = await db
    .select()
    .from(workersTable)
    .where(eq(workersTable.id, workerId));
  if (!worker) {
    res.status(404).json({ error: "Worker not found" });
    return;
  }

  const existing = await db
    .select()
    .from(attendanceTable)
    .where(and(eq(attendanceTable.workerId, workerId), eq(attendanceTable.date, date)));

  if (existing.length === 0) {
    res.status(404).json({ error: "Worker is not checked in today" });
    return;
  }

  const [row] = await db
    .update(attendanceTable)
    .set({ checkOutAt: new Date() })
    .where(eq(attendanceTable.id, existing[0].id))
    .returning();

  res.json(
    serialiseEntry({
      workerId: worker.id,
      workerName: worker.name,
      date,
      checkInAt: row.checkInAt,
      checkOutAt: row.checkOutAt,
    }),
  );
});

router.post("/attendance/check-in-all", async (req, res): Promise<void> => {
  const date = normaliseDate(req.body?.date);
  const activeWorkers = await db
    .select()
    .from(workersTable)
    .where(eq(workersTable.active, true));

  if (activeWorkers.length === 0) {
    res.json([]);
    return;
  }

  const existing = await db
    .select()
    .from(attendanceTable)
    .where(
      and(
        eq(attendanceTable.date, date),
        inArray(
          attendanceTable.workerId,
          activeWorkers.map((w) => w.id),
        ),
      ),
    );
  const existingIds = new Set(existing.map((e) => e.workerId));

  const toInsert = activeWorkers
    .filter((w) => !existingIds.has(w.id))
    .map((w) => ({ workerId: w.id, date, checkInAt: new Date(), checkOutAt: null }));

  if (toInsert.length > 0) {
    await db.insert(attendanceTable).values(toInsert);
  }

  // Re-open any that had checked out earlier in the day? No — only fill missing.
  res.json(await loadEntriesForDate(date));
});

router.post("/attendance/check-out-all", async (req, res): Promise<void> => {
  const date = normaliseDate(req.body?.date);

  await db
    .update(attendanceTable)
    .set({ checkOutAt: new Date() })
    .where(and(eq(attendanceTable.date, date), isNull(attendanceTable.checkOutAt)));

  res.json(await loadEntriesForDate(date));
});

export default router;
