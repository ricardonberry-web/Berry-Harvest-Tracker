import { Router, type IRouter } from "express";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db, workersTable, attendanceTable, weighRecordsTable } from "@workspace/db";

const BUSINESS_TZ = "Europe/Lisbon";
const router: IRouter = Router();

type IssueCounts = { CALIBRE: number; PENDUNCULOS: number; VERDE: number; MOLE: number; OUTROS: number };
function emptyIssues(): IssueCounts {
  return { CALIBRE: 0, PENDUNCULOS: 0, VERDE: 0, MOLE: 0, OUTROS: 0 };
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isoDate(input: unknown): string | null {
  if (typeof input !== "string") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(input) ? input : null;
}

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseRate(input: unknown): number | null {
  if (input === undefined || input === null || input === "") return null;
  const n = Number(input);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

type TimesheetShift = {
  id: number;
  checkInAt: string | null;
  checkOutAt: string | null;
  hoursWorked: number | null;
  pay: number | null;
};

type TimesheetDay = {
  date: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  hoursWorked: number | null;
  pay: number | null;
  totalIssues: number;
  issuesByType: IssueCounts;
  shifts: TimesheetShift[];
};

async function buildTimesheet(workerId: string, from: string, to: string, hourlyRate: number | null) {
  const [worker] = await db.select().from(workersTable).where(eq(workersTable.id, workerId));
  if (!worker) return null;

  const rows = await db
    .select()
    .from(attendanceTable)
    .where(
      and(
        eq(attendanceTable.workerId, workerId),
        gte(attendanceTable.date, from),
        lte(attendanceTable.date, to),
      ),
    )
    .orderBy(attendanceTable.date);

  // Aggregate quality issue counts per day for this worker (Lisbon TZ).
  const issueRows = await db.execute<{ d: string; issue: string; cnt: number }>(sql`
    SELECT (${weighRecordsTable.timestamp} AT TIME ZONE ${BUSINESS_TZ})::date::text AS d,
           issue,
           COUNT(*)::int AS cnt
    FROM ${weighRecordsTable},
         LATERAL unnest(${weighRecordsTable.qualityIssues}) AS issue
    WHERE ${weighRecordsTable.workerId} = ${workerId}
      AND (${weighRecordsTable.timestamp} AT TIME ZONE ${BUSINESS_TZ})::date BETWEEN ${from}::date AND ${to}::date
    GROUP BY d, issue
  `);
  const issuesByDay = new Map<string, IssueCounts>();
  for (const row of issueRows.rows) {
    const bucket = issuesByDay.get(row.d) ?? emptyIssues();
    if (row.issue in bucket) {
      (bucket as Record<string, number>)[row.issue] = Number(row.cnt) || 0;
    }
    issuesByDay.set(row.d, bucket);
  }

  // A day can now have several shifts (entradas/saídas). Group the rows by day,
  // expose each shift, and aggregate the day total = sum of all its shifts.
  const rowsByDate = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = rowsByDate.get(r.date) ?? [];
    list.push(r);
    rowsByDate.set(r.date, list);
  }

  const days: TimesheetDay[] = [...rowsByDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, dayRows]) => {
      const shifts: TimesheetShift[] = dayRows
        .slice()
        .sort(
          (a, b) =>
            (a.checkInAt ? new Date(a.checkInAt).getTime() : 0) -
            (b.checkInAt ? new Date(b.checkInAt).getTime() : 0),
        )
        .map((r) => {
          const checkIn = r.checkInAt ? new Date(r.checkInAt) : null;
          const checkOut = r.checkOutAt ? new Date(r.checkOutAt) : null;
          let hoursWorked: number | null = null;
          if (checkIn && checkOut) {
            const h = Math.max(0, (checkOut.getTime() - checkIn.getTime()) / 3_600_000);
            hoursWorked = Math.round(h * 100) / 100;
          }
          const pay =
            hoursWorked !== null && hourlyRate !== null
              ? Math.round(hoursWorked * hourlyRate * 100) / 100
              : null;
          return {
            id: r.id,
            checkInAt: checkIn ? checkIn.toISOString() : null,
            checkOutAt: checkOut ? checkOut.toISOString() : null,
            hoursWorked,
            pay,
          };
        });

      const hasClosed = shifts.some((s) => s.hoursWorked !== null);
      const hoursWorked = hasClosed
        ? Math.round(shifts.reduce((acc, s) => acc + (s.hoursWorked ?? 0), 0) * 100) / 100
        : null;
      const pay =
        hoursWorked !== null && hourlyRate !== null
          ? Math.round(hoursWorked * hourlyRate * 100) / 100
          : null;

      const hasOpen = shifts.some((s) => s.checkOutAt === null);
      const firstCheckIn = shifts.reduce<string | null>(
        (m, s) => (s.checkInAt && (!m || s.checkInAt < m) ? s.checkInAt : m),
        null,
      );
      const lastCheckOut = hasOpen
        ? null
        : shifts.reduce<string | null>(
            (m, s) => (s.checkOutAt && (!m || s.checkOutAt > m) ? s.checkOutAt : m),
            null,
          );

      const issuesByType = issuesByDay.get(date) ?? emptyIssues();
      const totalIssues = Object.values(issuesByType).reduce((a, b) => a + b, 0);
      return {
        date,
        checkInAt: firstCheckIn,
        checkOutAt: lastCheckOut,
        hoursWorked,
        pay,
        totalIssues,
        issuesByType,
        shifts,
      };
    });

  const totalHours =
    Math.round(days.reduce((acc, d) => acc + (d.hoursWorked ?? 0), 0) * 100) / 100;
  const totalDays = days.length;
  const totalPay =
    hourlyRate !== null ? Math.round(totalHours * hourlyRate * 100) / 100 : null;

  return {
    workerId: worker.id,
    workerName: worker.name,
    from,
    to,
    hourlyRate,
    days,
    totalDays,
    totalHours,
    totalPay,
  };
}

router.get("/workers/:id/timesheet", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const from = isoDate(req.query.from) ?? defaultFrom();
  const to = isoDate(req.query.to) ?? todayISO();
  const hourlyRate = parseRate(req.query.hourlyRate);

  const ts = await buildTimesheet(id, from, to, hourlyRate);
  if (!ts) {
    res.status(404).json({ error: "Worker not found" });
    return;
  }
  res.json(ts);
});

router.get("/workers/:id/timesheet/export", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const from = isoDate(req.query.from) ?? defaultFrom();
  const to = isoDate(req.query.to) ?? todayISO();
  const hourlyRate = parseRate(req.query.hourlyRate);

  const ts = await buildTimesheet(id, from, to, hourlyRate);
  if (!ts) {
    res.status(404).json({ error: "Worker not found" });
    return;
  }

  const fmtTime = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" }) : "";

  const header =
    "Trabalhador;ID;Periodo_de;Periodo_a;Valor_hora_EUR\n" +
    `"${ts.workerName.replace(/"/g, '""')}";${ts.workerId};${from};${to};${hourlyRate ?? ""}\n\n` +
    "Data;Entrada;Saida;Horas;Valor_EUR\n";

  const rows = ts.days
    .flatMap((d) =>
      d.shifts.map(
        (s) =>
          `${d.date};${fmtTime(s.checkInAt)};${fmtTime(s.checkOutAt)};${s.hoursWorked ?? ""};${s.pay ?? ""}`,
      ),
    )
    .join("\n");

  const totals = `\n\nTOTAL;;;${ts.totalHours};${ts.totalPay ?? ""}\nDias trabalhados;${ts.totalDays}\n`;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="folha-horas-${ts.workerId}-${from}-a-${to}.csv"`,
  );
  res.send(header + rows + totals);
});

export default router;
