import { Router, type IRouter } from "express";
import { eq, and, gte, lt, sql } from "drizzle-orm";
import { db, weighRecordsTable, workersTable } from "@workspace/db";
import {
  GetDailyReportQueryParams,
  ExportRecordsQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/reports/daily", async (req, res): Promise<void> => {
  const query = GetDailyReportQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const dateStr = query.data.date ?? new Date().toISOString().split("T")[0];
  const dayStart = new Date(dateStr);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dateStr);
  dayEnd.setUTCHours(23, 59, 59, 999);

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
      and(
        gte(weighRecordsTable.timestamp, dayStart),
        lt(weighRecordsTable.timestamp, dayEnd)
      )
    )
    .groupBy(weighRecordsTable.workerId, workersTable.name)
    .orderBy(sql`sum(${weighRecordsTable.weightGrams}) desc`);

  const totalKgAll = records.reduce((acc, r) => acc + (r.totalGrams || 0), 0) / 1000;
  const totalRecordsAll = records.reduce((acc, r) => acc + (r.totalCaixas || 0), 0);

  const workers = records.map((r, idx) => {
    const totalKg = (r.totalGrams || 0) / 1000;
    const first = r.primeiroRegisto ? new Date(r.primeiroRegisto) : null;
    const last = r.ultimoRegisto ? new Date(r.ultimoRegisto) : null;
    let caixasPorHora = 0;
    if (first && last && last.getTime() - first.getTime() > 0) {
      const hoursWorked = (last.getTime() - first.getTime()) / 3600000;
      caixasPorHora = hoursWorked > 0 ? Math.round((r.totalCaixas / hoursWorked) * 100) / 100 : 0;
    }

    return {
      workerId: r.workerId,
      workerName: r.workerName ?? r.workerId,
      totalCaixas: r.totalCaixas,
      totalKg: Math.round(totalKg * 100) / 100,
      mediaGrPorCaixa: Math.round(r.mediaGrPorCaixa || 0),
      caixasPorHora,
      primeiroRegisto: r.primeiroRegisto ?? null,
      ultimoRegisto: r.ultimoRegisto ?? null,
      rankKg: idx + 1,
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
  const dayStart = new Date(dateStr);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dateStr);
  dayEnd.setUTCHours(23, 59, 59, 999);

  const conditions = [
    gte(weighRecordsTable.timestamp, dayStart),
    lt(weighRecordsTable.timestamp, dayEnd),
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

export default router;
