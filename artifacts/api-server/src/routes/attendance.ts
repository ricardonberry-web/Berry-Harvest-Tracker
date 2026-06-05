import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
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
  id?: number;
  workerId: string;
  workerName: string;
  date: string;
  checkInAt: Date | null;
  checkOutAt: Date | null;
};

// Serialises a SINGLE shift row (used by check-in/out and create/edit endpoints).
function serialiseEntry(row: AttendanceRow) {
  const checkIn = row.checkInAt ? new Date(row.checkInAt) : null;
  const checkOut = row.checkOutAt ? new Date(row.checkOutAt) : null;
  const hoursWorked =
    checkIn && checkOut
      ? Math.max(0, (checkOut.getTime() - checkIn.getTime()) / 3_600_000)
      : null;
  return {
    id: row.id ?? null,
    workerId: row.workerId,
    workerName: row.workerName,
    date: row.date,
    checkInAt: checkIn ? checkIn.toISOString() : null,
    checkOutAt: checkOut ? checkOut.toISOString() : null,
    hoursWorked: hoursWorked === null ? null : Number(hoursWorked.toFixed(2)),
  };
}

type Shift = { id: number; checkInAt: Date | null; checkOutAt: Date | null };

// Aggregates ALL shifts of a worker for a day into one summary entry, so the
// daily Entradas/Saídas board and the weighing gate see a single per-worker
// state even when the worker has several entradas/saídas.
function aggregateWorkerDay(
  workerId: string,
  workerName: string,
  date: string,
  shifts: Shift[],
) {
  const ordered = shifts
    .slice()
    .sort(
      (a, b) =>
        (a.checkInAt ? a.checkInAt.getTime() : 0) -
        (b.checkInAt ? b.checkInAt.getTime() : 0),
    );

  let firstCheckIn: Date | null = null;
  let lastCheckOut: Date | null = null;
  let hasOpen = false;
  let hasClosed = false;
  let closedMs = 0;

  for (const s of ordered) {
    const ci = s.checkInAt ? new Date(s.checkInAt) : null;
    const co = s.checkOutAt ? new Date(s.checkOutAt) : null;
    if (ci && (!firstCheckIn || ci.getTime() < firstCheckIn.getTime())) firstCheckIn = ci;
    if (ci && co) {
      hasClosed = true;
      closedMs += Math.max(0, co.getTime() - ci.getTime());
      if (!lastCheckOut || co.getTime() > lastCheckOut.getTime()) lastCheckOut = co;
    } else if (ci && !co) {
      hasOpen = true;
    }
  }

  // hoursWorked counts only CLOSED shifts (stable, matches the ranking reports).
  const hoursWorked = hasClosed ? Number((closedMs / 3_600_000).toFixed(2)) : null;

  return {
    workerId,
    workerName,
    date,
    // An open shift means the worker is currently "no terreno": leave the
    // aggregate check-out null so the UI shows the in-progress state.
    checkInAt: firstCheckIn ? firstCheckIn.toISOString() : null,
    checkOutAt: hasOpen ? null : lastCheckOut ? lastCheckOut.toISOString() : null,
    hoursWorked,
    shiftsCount: ordered.length,
  };
}

// Validates a manual shift against the worker's other shifts that day. Returns a
// PT error message when the shift is not allowed, or null when it is fine.
// Rules: at most one OPEN shift per worker/day, and CLOSED shifts must not
// overlap (overlapping closed shifts would double-count hours na folha).
async function findDayConflict(
  workerId: string,
  date: string,
  checkIn: Date,
  checkOut: Date | null,
  excludeId: number | null,
): Promise<string | null> {
  const rows = await db
    .select()
    .from(attendanceTable)
    .where(and(eq(attendanceTable.workerId, workerId), eq(attendanceTable.date, date)));
  const others = rows.filter((r) => r.id !== excludeId);

  if (!checkOut && others.some((r) => r.checkOutAt === null)) {
    return "Já existe um turno aberto neste dia. Feche-o antes de adicionar outro.";
  }
  if (checkOut) {
    for (const r of others) {
      if (!r.checkInAt || !r.checkOutAt) continue;
      const oci = new Date(r.checkInAt).getTime();
      const oco = new Date(r.checkOutAt).getTime();
      if (checkIn.getTime() < oco && oci < checkOut.getTime()) {
        return "Este turno sobrepõe-se a outro turno do mesmo dia.";
      }
    }
  }
  return null;
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

  const shiftsByWorker = new Map<string, Shift[]>();
  for (const a of attendance) {
    const list = shiftsByWorker.get(a.workerId) ?? [];
    list.push({ id: a.id, checkInAt: a.checkInAt, checkOutAt: a.checkOutAt });
    shiftsByWorker.set(a.workerId, list);
  }

  return allWorkers.map((w) =>
    aggregateWorkerDay(w.id, w.name, date, shiftsByWorker.get(w.id) ?? []),
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

  // If there is already an open shift today, return it instead of opening a
  // duplicate — a new shift is only started after the previous one is closed.
  const [open] = await db
    .select()
    .from(attendanceTable)
    .where(
      and(
        eq(attendanceTable.workerId, workerId),
        eq(attendanceTable.date, date),
        isNull(attendanceTable.checkOutAt),
      ),
    )
    .orderBy(desc(attendanceTable.checkInAt))
    .limit(1);

  const row =
    open ??
    (
      await db
        .insert(attendanceTable)
        .values({ workerId, date, checkInAt: new Date(), checkOutAt: null })
        .returning()
    )[0];

  res.json(
    serialiseEntry({
      id: row.id,
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
  // Close the last open shift for this worker today.
  const existing = await db
    .select()
    .from(attendanceTable)
    .where(and(eq(attendanceTable.workerId, workerId), eq(attendanceTable.date, date), isNull(attendanceTable.checkOutAt)))
    .orderBy(desc(attendanceTable.checkInAt))
    .limit(1);

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
      id: row.id,
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

  // A worker counts as "already in" only while they have an OPEN shift. Workers
  // who have no record yet, or whose previous shift is already closed, get a
  // fresh check-in — this is what starts a second (afternoon) shift.
  const openWorkerIds = new Set(
    existing.filter((e) => e.checkOutAt === null).map((e) => e.workerId),
  );

  const toInsert = targetWorkers
    .filter((w) => !openWorkerIds.has(w.id))
    .map((w) => ({ workerId: w.id, date, checkInAt: new Date(), checkOutAt: null }));
  if (toInsert.length > 0) {
    await db.insert(attendanceTable).values(toInsert);
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

  // Closes every open shift for the targeted workers today.
  await db
    .update(attendanceTable)
    .set({ checkOutAt: new Date() })
    .where(and(...conditions));

  res.json(await loadEntriesForDate(date));
});

// Create a new shift (turno) for a worker on a given day. Used by the timesheet
// to add an extra entrada/saída to a day manually.
router.post("/attendance/shift", async (req, res): Promise<void> => {
  const workerId =
    typeof req.body?.workerId === "string" ? req.body.workerId.trim() : "";
  if (!workerId) {
    res.status(400).json({ error: "workerId is required" });
    return;
  }
  const date = typeof req.body?.date === "string" ? req.body.date : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "Data inválida (formato AAAA-MM-DD)" });
    return;
  }
  if (!req.body?.checkInAt) {
    res.status(400).json({ error: "Entrada obrigatória" });
    return;
  }

  const [worker] = await db.select().from(workersTable).where(eq(workersTable.id, workerId));
  if (!worker) {
    res.status(404).json({ error: "Worker not found" });
    return;
  }

  const checkInAt = new Date(req.body.checkInAt);
  if (Number.isNaN(checkInAt.getTime())) {
    res.status(400).json({ error: "Entrada inválida" });
    return;
  }
  const checkOutAt = req.body.checkOutAt ? new Date(req.body.checkOutAt) : null;
  if (checkOutAt && Number.isNaN(checkOutAt.getTime())) {
    res.status(400).json({ error: "Saída inválida" });
    return;
  }
  if (checkOutAt && checkOutAt.getTime() <= checkInAt.getTime()) {
    res.status(400).json({ error: "A saída deve ser posterior à entrada" });
    return;
  }

  const conflict = await findDayConflict(workerId, date, checkInAt, checkOutAt, null);
  if (conflict) {
    res.status(409).json({ error: conflict });
    return;
  }

  const [row] = await db
    .insert(attendanceTable)
    .values({ workerId, date, checkInAt, checkOutAt })
    .returning();

  res.status(201).json(
    serialiseEntry({
      id: row.id,
      workerId: worker.id,
      workerName: worker.name,
      date,
      checkInAt: row.checkInAt,
      checkOutAt: row.checkOutAt,
    }),
  );
});

// Edit a single shift by its id. Supports moving the shift to another day and
// changing entrada/saída times.
router.patch("/attendance/shift/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [existing] = await db
    .select()
    .from(attendanceTable)
    .where(eq(attendanceTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Registo não encontrado" });
    return;
  }

  const { checkInAt, checkOutAt, date: newDateRaw } = req.body ?? {};
  const updateData: Record<string, unknown> = {};

  if (checkInAt !== undefined) {
    if (!checkInAt) {
      res.status(400).json({ error: "Entrada obrigatória" });
      return;
    }
    const ci = new Date(checkInAt);
    if (Number.isNaN(ci.getTime())) {
      res.status(400).json({ error: "Entrada inválida" });
      return;
    }
    updateData.checkInAt = ci;
  }
  if (checkOutAt !== undefined) {
    if (!checkOutAt) {
      updateData.checkOutAt = null;
    } else {
      const co = new Date(checkOutAt);
      if (Number.isNaN(co.getTime())) {
        res.status(400).json({ error: "Saída inválida" });
        return;
      }
      updateData.checkOutAt = co;
    }
  }

  const newDate = typeof newDateRaw === "string" && newDateRaw ? newDateRaw : existing.date;
  if (newDate !== existing.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      res.status(400).json({ error: "Data inválida (formato AAAA-MM-DD)" });
      return;
    }
    updateData.date = newDate;
  }

  // Validate the resulting shift (effective values) against the other shifts of
  // the worker on the (possibly new) day: no inverted times, no overlap, single
  // open shift. Multiple non-overlapping shifts per day are allowed.
  const effCheckIn = (updateData.checkInAt as Date | undefined) ?? existing.checkInAt;
  const effCheckOut =
    "checkOutAt" in updateData
      ? (updateData.checkOutAt as Date | null)
      : existing.checkOutAt;
  if (effCheckIn && effCheckOut && new Date(effCheckOut).getTime() <= new Date(effCheckIn).getTime()) {
    res.status(400).json({ error: "A saída deve ser posterior à entrada" });
    return;
  }
  if (effCheckIn) {
    const conflict = await findDayConflict(
      existing.workerId,
      newDate,
      new Date(effCheckIn),
      effCheckOut ? new Date(effCheckOut) : null,
      id,
    );
    if (conflict) {
      res.status(409).json({ error: conflict });
      return;
    }
  }

  const [updated] = await db
    .update(attendanceTable)
    .set(updateData)
    .where(eq(attendanceTable.id, id))
    .returning();

  const [worker] = await db.select().from(workersTable).where(eq(workersTable.id, existing.workerId));

  res.json(
    serialiseEntry({
      id: updated.id,
      workerId: existing.workerId,
      workerName: worker?.name ?? existing.workerId,
      date: updated.date,
      checkInAt: updated.checkInAt,
      checkOutAt: updated.checkOutAt,
    }),
  );
});

// Delete a single shift by its id.
router.delete("/attendance/shift/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [existing] = await db
    .select()
    .from(attendanceTable)
    .where(eq(attendanceTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Registo não encontrado" });
    return;
  }

  await db.delete(attendanceTable).where(eq(attendanceTable.id, id));
  res.sendStatus(204);
});

export default router;
