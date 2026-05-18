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
  const activeWorkers = await db
    .select()
    .from(workersTable)
    .where(eq(workersTable.active, true));

  const attendance = await db
    .select()
    .from(attendanceTable)
    .where(eq(attendanceTable.date, date));

  // Also surface inactive workers that already have an attendance row for the
  // date, so an open shift can still be closed after deactivation.
  const activeIds = new Set(activeWorkers.map((w) => w.id));
  const orphanIds = attendance.map((a) => a.workerId).filter((id) => !activeIds.has(id));
  const orphanWorkers = orphanIds.length
    ? await db.select().from(workersTable).where(inArray(workersTable.id, orphanIds))
    : [];

  const allWorkers = [...activeWorkers, ...orphanWorkers].sort((a, b) =>
    a.name.localeCompare(b.name, "pt"),
  );
  const byWorker = new Map(attendance.map((a) => [a.workerId, a]));

  return allWorkers.map((w) =>
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
  if (!worker.active) {
    res.status(403).json({ error: "Trabalhador inativo. Reative-o em Equipa para registar entrada." });
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

  // Allow check-out for inactive workers IF they already have an open
  // attendance row for the date — otherwise we'd strand their shift.
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

function parseWorkerIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const ids = raw.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return ids.length > 0 ? ids : null;
}

router.post("/attendance/check-in-all", async (req, res): Promise<void> => {
  const date = normaliseDate(req.body?.date);
  const explicitIds = parseWorkerIds(req.body?.workerIds);

  const targetWorkers = explicitIds
    ? await db
        .select()
        .from(workersTable)
        .where(and(inArray(workersTable.id, explicitIds), eq(workersTable.active, true)))
    : await db.select().from(workersTable).where(eq(workersTable.active, true));

  if (targetWorkers.length === 0) {
    res.json(await loadEntriesForDate(date));
    return;
  }

  const targetIds = targetWorkers.map((w) => w.id);
  const existing = await db
    .select()
    .from(attendanceTable)
    .where(and(eq(attendanceTable.date, date), inArray(attendanceTable.workerId, targetIds)));
  const existingByWorker = new Map(existing.map((e) => [e.workerId, e]));

  // Insert new check-ins for workers without any record
  const toInsert = targetWorkers
    .filter((w) => !existingByWorker.has(w.id))
    .map((w) => ({ workerId: w.id, date, checkInAt: new Date(), checkOutAt: null }));
  if (toInsert.length > 0) {
    await db.insert(attendanceTable).values(toInsert);
  }

  // For workers who had already checked out today, re-open with a fresh check-in
  const toReopen = existing.filter((e) => e.checkOutAt !== null).map((e) => e.id);
  if (toReopen.length > 0) {
    await db
      .update(attendanceTable)
      .set({ checkInAt: new Date(), checkOutAt: null })
      .where(inArray(attendanceTable.id, toReopen));
  }

  res.json(await loadEntriesForDate(date));
});

router.post("/attendance/check-out-all", async (req, res): Promise<void> => {
  const date = normaliseDate(req.body?.date);
  const explicitIds = parseWorkerIds(req.body?.workerIds);

  const conditions = [eq(attendanceTable.date, date), isNull(attendanceTable.checkOutAt)];
  if (explicitIds) {
    conditions.push(inArray(attendanceTable.workerId, explicitIds));
  }

  await db
    .update(attendanceTable)
    .set({ checkOutAt: new Date() })
    .where(and(...conditions));

  res.json(await loadEntriesForDate(date));
});


export default router;

router.patch("/attendance/:workerId/:date", async (req, res): Promise<void> => {
  const { workerId, date } = req.params;
  const { checkInAt, checkOutAt } = req.body;

  const existing = await db
    .select()
    .from(attendanceTable)
    .where(and(eq(attendanceTable.workerId, workerId), eq(attendanceTable.date, date)));

  if (existing.length === 0) {
    res.status(404).json({ error: "Registo não encontrado" });
    return;
  }

  const updateData: Record<string, unknown> = {};
  if (checkInAt !== undefined) updateData.checkInAt = checkInAt ? new Date(checkInAt) : null;
  if (checkOutAt !== undefined) updateData.checkOutAt = checkOutAt ? new Date(checkOutAt) : null;

  const [updated] = await db
    .update(attendanceTable)
    .set(updateData)
    .where(eq(attendanceTable.id, existing[0].id))
    .returning();

  const [worker] = await db.select().from(workersTable).where(eq(workersTable.id, workerId));

  res.json(serialiseEntry({
    workerId,
    workerName: worker?.name ?? workerId,
    date,
    checkInAt: updated.checkInAt,
    checkOutAt: updated.checkOutAt,
  }));
});

router.delete("/attendance/:workerId/:date", async (req, res): Promise<void> => {
  const { workerId, date } = req.params;

  const existing = await db
    .select()
    .from(attendanceTable)
    .where(and(eq(attendanceTable.workerId, workerId), eq(attendanceTable.date, date)));

  if (existing.length === 0) {
    res.status(404).json({ error: "Registo não encontrado" });
    return;
  }

  await db.delete(attendanceTable).where(eq(attendanceTable.id, existing[0].id));
  res.sendStatus(204);
});
