import { Router, type IRouter } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, weighRecordsTable, workersTable, attendanceTable } from "@workspace/db";

const BUSINESS_TZ = "Europe/Lisbon";

function todayISO(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
import {
  CreateWeighRecordBody,
  DeleteWeighRecordParams,
  ListWeighRecordsQueryParams,
  ListWeighRecordsResponse,
  UpdateWeighRecordBody,
  UpdateWeighRecordParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/weigh-records", async (req, res): Promise<void> => {
  const query = ListWeighRecordsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { workerId, date, limit } = query.data;

  const conditions = [];

  if (workerId) {
    conditions.push(eq(weighRecordsTable.workerId, workerId));
  }

  if (date) {
    // Compare the timestamp's *local* date (Europe/Lisbon) to the requested date,
    // so records made near midnight local time fall in the correct business day
    // regardless of the server / DB time zone.
    conditions.push(
      sql`(${weighRecordsTable.timestamp} AT TIME ZONE ${BUSINESS_TZ})::date = ${date}::date`,
    );
  }

  const baseQuery = db
    .select({
      id: weighRecordsTable.id,
      workerId: weighRecordsTable.workerId,
      workerName: workersTable.name,
      timestamp: weighRecordsTable.timestamp,
      weightGrams: weighRecordsTable.weightGrams,
      unit: weighRecordsTable.unit,
      scaleId: weighRecordsTable.scaleId,
      rawLine: weighRecordsTable.rawLine,
      syncStatus: weighRecordsTable.syncStatus,
      createdAt: weighRecordsTable.createdAt,
      editedAt: weighRecordsTable.editedAt,
    })
    .from(weighRecordsTable)
    .leftJoin(workersTable, eq(weighRecordsTable.workerId, workersTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(weighRecordsTable.timestamp));

  const records = limit ? await baseQuery.limit(limit) : await baseQuery;

  res.json(ListWeighRecordsResponse.parse(records.map(r => ({ ...r, workerName: r.workerName ?? r.workerId }))));
});

router.post("/weigh-records", async (req, res): Promise<void> => {
  const body = { ...req.body };
  if (typeof body.timestamp === "string") {
    body.timestamp = new Date(body.timestamp);
  }
  const parsed = CreateWeighRecordBody.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { workerId, weightGrams, unit, scaleId, rawLine, timestamp } = parsed.data;

  // Reject if worker hasn't checked in today (or has already checked out)
  const recordDate = todayISO(timestamp ? new Date(timestamp) : new Date());
  const [att] = await db
    .select()
    .from(attendanceTable)
    .where(and(eq(attendanceTable.workerId, workerId), eq(attendanceTable.date, recordDate)));
  if (!att) {
    res.status(403).json({ error: "Trabalhador sem entrada registada para hoje." });
    return;
  }
  if (att.checkOutAt) {
    res.status(403).json({ error: "Trabalhador já deu saída — registe nova entrada para pesar." });
    return;
  }

  const [record] = await db
    .insert(weighRecordsTable)
    .values({
      workerId,
      weightGrams,
      unit,
      scaleId,
      rawLine,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
      syncStatus: "SYNCED",
    })
    .returning();

  const worker = await db
    .select()
    .from(workersTable)
    .where(eq(workersTable.id, record.workerId));

  res.status(201).json({
    ...record,
    workerName: worker[0]?.name ?? record.workerId,
  });
});

router.patch("/weigh-records/:id", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateWeighRecordParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateWeighRecordBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  if (!Number.isInteger(body.data.weightGrams)) {
    res.status(400).json({ error: "weightGrams must be an integer (whole grams)" });
    return;
  }

  const [updated] = await db
    .update(weighRecordsTable)
    .set({
      weightGrams: body.data.weightGrams,
      editedAt: new Date(),
    })
    .where(eq(weighRecordsTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Record not found" });
    return;
  }

  const [worker] = await db
    .select()
    .from(workersTable)
    .where(eq(workersTable.id, updated.workerId));

  res.json({
    ...updated,
    workerName: worker?.name ?? updated.workerId,
  });
});

router.delete("/weigh-records/:id", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteWeighRecordParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [record] = await db
    .delete(weighRecordsTable)
    .where(eq(weighRecordsTable.id, params.data.id))
    .returning();

  if (!record) {
    res.status(404).json({ error: "Record not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
