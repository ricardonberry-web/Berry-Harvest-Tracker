import { Router, type IRouter } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, weighRecordsTable, workersTable, attendanceTable } from "@workspace/db";

const BUSINESS_TZ = "Europe/Lisbon";

const ALLOWED_QUALITY_ISSUES = ["CALIBRE", "PENDUNCULOS", "VERDE", "MOLE", "OUTROS"] as const;
type QualityIssue = (typeof ALLOWED_QUALITY_ISSUES)[number];

function sanitizeIssues(input: unknown): QualityIssue[] {
  if (!Array.isArray(input)) return [];
  const set = new Set<QualityIssue>();
  for (const v of input) {
    if (typeof v === "string" && (ALLOWED_QUALITY_ISSUES as readonly string[]).includes(v)) {
      set.add(v as QualityIssue);
    }
  }
  return Array.from(set);
}

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
      qualityIssues: weighRecordsTable.qualityIssues,
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
  const qualityIssues = sanitizeIssues((parsed.data as { qualityIssues?: unknown }).qualityIssues);

  // Reject inactive workers up-front so a stale UI can't insert orphan records
  const [workerRow] = await db
    .select()
    .from(workersTable)
    .where(eq(workersTable.id, workerId));
  if (!workerRow) {
    res.status(404).json({ error: "Trabalhador não encontrado." });
    return;
  }
  if (!workerRow.active) {
    res.status(403).json({ error: "Trabalhador inativo — não pode pesar." });
    return;
  }

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
    const checkOutTime = new Date(att.checkOutAt).getTime();
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    if (now - checkOutTime > oneHour) {
      res.status(403).json({ error: "Trabalhador já deu saída há mais de 1 hora — registe nova entrada para pesar." });
      return;
    }
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
      qualityIssues,
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

  const issuesProvided = (body.data as { qualityIssues?: unknown }).qualityIssues !== undefined;
  const timestampProvided = (body.data as { timestamp?: unknown }).timestamp !== undefined;
  const setPayload: Record<string, unknown> = {
    weightGrams: body.data.weightGrams,
    editedAt: new Date(),
  };
  if (timestampProvided) {
    const ts = (body.data as { timestamp?: unknown }).timestamp;
    setPayload.timestamp = ts ? new Date(ts as string) : new Date();
  }
  if (issuesProvided) {
    setPayload.qualityIssues = sanitizeIssues((body.data as { qualityIssues?: unknown }).qualityIssues);
  }

  const [updated] = await db
    .update(weighRecordsTable)
    .set(setPayload)
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
