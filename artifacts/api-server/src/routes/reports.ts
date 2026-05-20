import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, weighRecordsTable, workersTable, attendanceTable } from "@workspace/db";
import {
  GetDailyReportQueryParams,
  ExportRecordsQueryParams,
} from "@workspace/api-zod";

const BUSINESS_TZ = "Europe/Lisbon";
const router: IRouter = Router();

router.get("/reports/daily", async (req, res): Promise<void> => {
  const query = GetDailyReportQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const dateStr = query.data.date ?? new Date().toISOString().split("T")[0];

  const records = await db
    .select({
      workerId: weighRecordsTable.workerId,
      workerName: workersTable.name,
      totalCaixas: sql<number>`count(${weighRecordsTable.id})::int`,
      totalGrams: sql<number>`sum(${weighRecordsTable.weightGrams})::float`,
      mediaGrPorCaixa: sql<number>`avg(${weighRecordsTable.weightGrams})::float`,
      primeiroRegisto: sql<string>`min(${weighRecordsTable.timestamp})::text`,
      ultimoRegisto: sql<string>`max(${weighRecordsTable.timestamp})::text`,
    })
    .from(weighRecordsTable)
    .leftJoin(workersTable, eq(weighRecordsTable.workerId, workersTable.id))
    .where(
      sql`(${weighRecordsTable.timestamp} AT TIME ZONE ${BUSINESS_TZ})::date = ${dateStr}::date`,
    )
    .groupBy(weighRecordsTable.workerId, workersTable.name)
    .orderBy(sql`sum(${weighRecordsTable.weightGrams}) desc`);

  // Aggregate quality issue counts per worker for the same day.
  // unnest(quality_issues) flattens arrays so we can count per type.
  const issueRows = await db.execute<{
    worker_id: string;
    issue: string;
    cnt: number;
  }>(sql`
    SELECT ${weighRecordsTable.workerId} AS worker_id,
           issue,
           COUNT(*)::int AS cnt
    FROM ${weighRecordsTable},
         LATERAL unnest(${weighRecordsTable.qualityIssues}) AS issue
    WHERE (${weighRecordsTable.timestamp} AT TIME ZONE ${BUSINESS_TZ})::date = ${dateStr}::date
    GROUP BY ${weighRecordsTable.workerId}, issue
  `);
  const issuesByWorker = new Map<string, Record<string, number>>();
  for (const row of issueRows.rows) {
    const map = issuesByWorker.get(row.worker_id) ?? {};
    map[row.issue] = Number(row.cnt) || 0;
    issuesByWorker.set(row.worker_id, map);
  }
  const emptyIssues = (): { CALIBRE: number; PENDUNCULOS: number; VERDE: number; MOLE: number; OUTROS: number } => ({
    CALIBRE: 0,
    PENDUNCULOS: 0,
    VERDE: 0,
    MOLE: 0,
    OUTROS: 0,
  });

  // Load attendance for the day so we can compute hoursWorked / kgPorHora from real check-in/out
  const attendance = await db
    .select()
    .from(attendanceTable)
    .where(eq(attendanceTable.date, dateStr));
  const attendanceByWorker = new Map(attendance.map((a) => [a.workerId, a]));

  const totalKgAll = records.reduce((acc, r) => acc + (r.totalGrams || 0), 0) / 1000;
  const totalRecordsAll = records.reduce((acc, r) => acc + (r.totalCaixas || 0), 0);

  const workers = records.map((r, idx) => {
    const totalKg = (r.totalGrams || 0) / 1000;
    const first = r.primeiroRegisto ? new Date(r.primeiroRegisto) : null;
    const last = r.ultimoRegisto ? new Date(r.ultimoRegisto) : null;

    // Prefer real attendance hours; fall back to first/last weighing as legacy estimate
    const att = attendanceByWorker.get(r.workerId);
    let hoursWorked: number | null = null;
    if (att?.checkInAt) {
      const start = new Date(att.checkInAt).getTime();
      const end = att.checkOutAt ? new Date(att.checkOutAt).getTime() : Date.now();
      const h = (end - start) / 3_600_000;
      if (h > 0) hoursWorked = Math.round(h * 100) / 100;
    }

    const kgPorHora =
      hoursWorked !== null && hoursWorked > 0
        ? Math.round((totalKg / hoursWorked) * 100) / 100
        : null;

    let caixasPorHora = 0;
    if (hoursWorked !== null && hoursWorked > 0) {
      caixasPorHora = Math.round((r.totalCaixas / hoursWorked) * 100) / 100;
    } else if (first && last && last.getTime() - first.getTime() > 0) {
      const h = (last.getTime() - first.getTime()) / 3_600_000;
      caixasPorHora = h > 0 ? Math.round((r.totalCaixas / h) * 100) / 100 : 0;
    }

    const counts = issuesByWorker.get(r.workerId) ?? {};
    const issuesByType = emptyIssues();
    for (const k of Object.keys(issuesByType) as Array<keyof typeof issuesByType>) {
      issuesByType[k] = counts[k] ?? 0;
    }
    const totalIssues = Object.values(issuesByType).reduce((a, b) => a + b, 0);

    return {
      workerId: r.workerId,
      workerName: r.workerName ?? r.workerId,
      totalCaixas: r.totalCaixas,
      totalKg: Math.round(totalKg * 100) / 100,
      mediaGrPorCaixa: Math.round(r.mediaGrPorCaixa || 0),
      caixasPorHora,
      hoursWorked,
      kgPorHora,
      primeiroRegisto: r.primeiroRegisto ?? null,
      ultimoRegisto: r.ultimoRegisto ?? null,
      rankKg: idx + 1,
      totalIssues,
      issuesByType,
    };
  });

  res.json({
    date: dateStr,
    workers,
    totalRecords: totalRecordsAll,
    totalKg: Math.round(totalKgAll * 100) / 100,
  });
});

router.get("/reports/export", async (req, res): Promise<void> => {
  const query = ExportRecordsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const dateStr = query.data.date ?? new Date().toISOString().split("T")[0];

  const conditions = [
    sql`(${weighRecordsTable.timestamp} AT TIME ZONE ${BUSINESS_TZ})::date = ${dateStr}::date`,
  ];

  if (query.data.workerId) {
    conditions.push(eq(weighRecordsTable.workerId, query.data.workerId));
  }

  const records = await db
    .select({
      id: weighRecordsTable.id,
      workerId: weighRecordsTable.workerId,
      workerName: workersTable.name,
      timestamp: weighRecordsTable.timestamp,
      weightGrams: weighRecordsTable.weightGrams,
      unit: weighRecordsTable.unit,
      scaleId: weighRecordsTable.scaleId,
      rawLine: weighRecordsTable.rawLine,
    })
    .from(weighRecordsTable)
    .leftJoin(workersTable, eq(weighRecordsTable.workerId, workersTable.id))
    .where(and(...conditions))
    .orderBy(weighRecordsTable.timestamp);

  const csvHeader = "id,worker_id,worker_name,timestamp,weight_g,unit,scale_id,raw_line\n";
  const csvRows = records
    .map((r) => {
      const ts = r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp);
      const rawLine = `"${(r.rawLine ?? "").replace(/"/g, '""')}"`;
      const workerName = `"${(r.workerName ?? r.workerId ?? "").replace(/"/g, '""')}"`;
      return `${r.id},${r.workerId},${workerName},${ts},${r.weightGrams},${r.unit},${r.scaleId},${rawLine}`;
    })
    .join("\n");

  const csv = csvHeader + csvRows;

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="pesagens-${dateStr}.csv"`);
  res.send(csv);
});


router.get("/reports/range", async (req, res): Promise<void> => {
  const { from, to } = req.query as { from?: string; to?: string };
  if (!from || !to) {
    res.status(400).json({ error: "from and to are required" });
    return;
  }

  const records = await db
    .select({
      workerId: weighRecordsTable.workerId,
      workerName: workersTable.name,
      totalCaixas: sql<number>`count(${weighRecordsTable.id})::int`,
      totalGrams: sql<number>`sum(${weighRecordsTable.weightGrams})::float`,
      mediaGrPorCaixa: sql<number>`avg(${weighRecordsTable.weightGrams})::float`,
    })
    .from(weighRecordsTable)
    .leftJoin(workersTable, eq(weighRecordsTable.workerId, workersTable.id))
    .where(sql`(${weighRecordsTable.timestamp} AT TIME ZONE ${BUSINESS_TZ})::date BETWEEN ${from}::date AND ${to}::date`)
    .groupBy(weighRecordsTable.workerId, workersTable.name)
    .orderBy(sql`sum(${weighRecordsTable.weightGrams}) desc`);

  const totalKgAll = records.reduce((acc, r) => acc + (r.totalGrams || 0), 0) / 1000;
  const totalRecordsAll = records.reduce((acc, r) => acc + (r.totalCaixas || 0), 0);

  const workers = records.map((r) => {
    const totalKg = (r.totalGrams || 0) / 1000;
    return {
      workerId: r.workerId,
      workerName: r.workerName ?? r.workerId,
      totalCaixas: r.totalCaixas,
      totalKg: Math.round(totalKg * 100) / 100,
      mediaGrPorCaixa: Math.round(r.mediaGrPorCaixa || 0),
    };
  });

  res.json({ from, to, workers, totalRecords: totalRecordsAll, totalKg: Math.round(totalKgAll * 100) / 100 });
});

export default router;


router.get("/reports/range", async (req, res): Promise<void> => {
  const { from, to } = req.query as { from?: string; to?: string };
  if (!from || !to) {
    res.status(400).json({ error: "from and to are required" });
    return;
  }

  const records = await db
    .select({
      workerId: weighRecordsTable.workerId,
      workerName: workersTable.name,
      totalCaixas: sql<number>`count(${weighRecordsTable.id})::int`,
      totalGrams: sql<number>`sum(${weighRecordsTable.weightGrams})::float`,
      mediaGrPorCaixa: sql<number>`avg(${weighRecordsTable.weightGrams})::float`,
    })
    .from(weighRecordsTable)
    .leftJoin(workersTable, eq(weighRecordsTable.workerId, workersTable.id))
    .where(
      sql`(${weighRecordsTable.timestamp} AT TIME ZONE ${BUSINESS_TZ})::date BETWEEN ${from}::date AND ${to}::date`,
    )
    .groupBy(weighRecordsTable.workerId, workersTable.name)
    .orderBy(sql`sum(${weighRecordsTable.weightGrams}) desc`);

  const issueRows = await db.execute<{ worker_id: string; issue: string; cnt: number }>(sql`
    SELECT ${weighRecordsTable.workerId} AS worker_id, issue, COUNT(*)::int AS cnt
    FROM ${weighRecordsTable}, LATERAL unnest(${weighRecordsTable.qualityIssues}) AS issue
    WHERE (${weighRecordsTable.timestamp} AT TIME ZONE ${BUSINESS_TZ})::date BETWEEN ${from}::date AND ${to}::date
    GROUP BY ${weighRecordsTable.workerId}, issue
  `);

  const issuesByWorker = new Map<string, Record<string, number>>();
  for (const row of issueRows.rows) {
    const map = issuesByWorker.get(row.worker_id) ?? {};
    map[row.issue] = Number(row.cnt) || 0;
    issuesByWorker.set(row.worker_id, map);
  }

  const emptyIssues = () => ({
export default router;
