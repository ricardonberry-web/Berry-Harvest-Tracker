import { Router, type IRouter } from "express";
import { and, eq, gte, lte } from "drizzle-orm";
import { db, workersTable, attendanceTable } from "@workspace/db";

const router: IRouter = Router();

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

type TimesheetDay = {
  date: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  hoursWorked: number | null;
  pay: number | null;
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

  const days: TimesheetDay[] = rows.map((r) => {
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
      date: r.date,
      checkInAt: checkIn ? checkIn.toISOString() : null,
      checkOutAt: checkOut ? checkOut.toISOString() : null,
      hoursWorked,
      pay,
    };
  });

  const totalHours =
    Math.round(days.reduce((acc, d) => acc + (d.hoursWorked ?? 0), 0) * 100) / 100;
  const totalDays = days.filter((d) => d.checkInAt !== null).length;
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
    .map(
      (d) =>
        `${d.date};${fmtTime(d.checkInAt)};${fmtTime(d.checkOutAt)};${d.hoursWorked ?? ""};${d.pay ?? ""}`,
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
