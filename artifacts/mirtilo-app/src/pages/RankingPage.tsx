import { useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import { useGetDailyReport } from "@workspace/api-client-react";
import { Trophy, Download, Calendar as CalendarIcon, Medal, Filter } from "lucide-react";
import { format } from "date-fns";

type SortKey = "kg" | "kgPorHora" | "caixas" | "horas";

function fmtHours(h: number | null | undefined) {
  if (h === null || h === undefined) return "—";
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh}h${String(mm).padStart(2, "0")}`;
}

export default function RankingPage() {
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [sortKey, setSortKey] = useState<SortKey>("kg");
  const [onlyWithHours, setOnlyWithHours] = useState(false);

  const { data: report, isLoading } = useGetDailyReport(
    { date },
    { query: { keepPreviousData: true } },
  );

  const sortedWorkers = useMemo(() => {
    if (!report?.workers) return [];
    const filtered = onlyWithHours
      ? report.workers.filter(w => w.hoursWorked !== null && w.hoursWorked > 0)
      : report.workers;
    const sorted = [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "kgPorHora":
          return (b.kgPorHora ?? -1) - (a.kgPorHora ?? -1);
        case "caixas":
          return b.totalCaixas - a.totalCaixas;
        case "horas":
          return (b.hoursWorked ?? -1) - (a.hoursWorked ?? -1);
        case "kg":
        default:
          return b.totalKg - a.totalKg;
      }
    });
    return sorted;
  }, [report, sortKey, onlyWithHours]);

  const teamHours = useMemo(
    () => (report?.workers ?? []).reduce((acc, w) => acc + (w.hoursWorked ?? 0), 0),
    [report],
  );
  const teamKgPorHora = teamHours > 0 ? (report?.totalKg ?? 0) / teamHours : null;

  const handleExport = () => {
    window.location.href = `/api/reports/export?date=${date}`;
  };

  return (
    <Layout>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">

        {/* Header Controls */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-card p-6 rounded-2xl border border-border shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-primary/10 text-primary rounded-xl">
              <Trophy className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-display font-bold">Ranking Diário</h1>
              <p className="text-muted-foreground text-sm">Produtividade da colheita</p>
            </div>
          </div>

          <div className="flex gap-3 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none">
              <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                <CalendarIcon className="w-4 h-4 text-muted-foreground" />
              </div>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-background border border-border rounded-xl pl-10 pr-4 py-2 font-medium text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <button
              onClick={handleExport}
              className="flex items-center justify-center gap-2 bg-secondary text-secondary-foreground px-4 py-2 rounded-xl font-bold hover:bg-secondary/80 transition-colors"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Exportar CSV</span>
            </button>
          </div>
        </div>

        {/* Stats Summary */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard label="Total Colhido" value={`${report?.totalKg.toFixed(1) || 0} kg`} />
          <StatCard label="Total Caixas" value={report?.totalRecords.toString() || "0"} />
          <StatCard label="Trabalhadores" value={report?.workers.length.toString() || "0"} />
          <StatCard label="Horas equipa" value={`${teamHours.toFixed(1)} h`} />
          <StatCard
            label="Kg / hora (equipa)"
            value={teamKgPorHora !== null ? `${teamKgPorHora.toFixed(2)} kg/h` : "—"}
            highlight
          />
        </div>

        {/* Filter / sort bar */}
        <div className="bg-card border border-border rounded-2xl p-4 flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground uppercase tracking-wider">
            <Filter className="w-4 h-4" /> Ordenar por
          </div>
          <div className="flex flex-wrap gap-2">
            {([
              { k: "kg" as SortKey, label: "Total kg" },
              { k: "kgPorHora" as SortKey, label: "Kg / hora" },
              { k: "caixas" as SortKey, label: "Caixas" },
              { k: "horas" as SortKey, label: "Horas" },
            ]).map(({ k, label }) => (
              <button
                key={k}
                onClick={() => setSortKey(k)}
                className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-colors ${
                  sortKey === k
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/70"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="md:ml-auto inline-flex items-center gap-2 text-sm font-medium text-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={onlyWithHours}
              onChange={(e) => setOnlyWithHours(e.target.checked)}
              className="w-4 h-4 accent-primary"
            />
            Só com horas registadas
          </label>
        </div>

        {/* Ranking Table */}
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="p-12 flex justify-center">
              <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div>
            </div>
          ) : !sortedWorkers.length ? (
            <div className="p-12 text-center text-muted-foreground">
              <Trophy className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p>Sem dados para este dia/filtro.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="p-4 font-bold text-xs uppercase tracking-wider text-muted-foreground w-16 text-center">Rank</th>
                    <th className="p-4 font-bold text-xs uppercase tracking-wider text-muted-foreground">Trabalhador</th>
                    <th className="p-4 font-bold text-xs uppercase tracking-wider text-muted-foreground text-right">Caixas</th>
                    <th className="p-4 font-bold text-xs uppercase tracking-wider text-muted-foreground text-right">Total (kg)</th>
                    <th className="p-4 font-bold text-xs uppercase tracking-wider text-muted-foreground text-right">Horas</th>
                    <th className="p-4 font-bold text-xs uppercase tracking-wider text-primary text-right">Kg / h</th>
                    <th className="p-4 font-bold text-xs uppercase tracking-wider text-muted-foreground text-right hidden sm:table-cell">Méd/Cx</th>
                    <th className="p-4 font-bold text-xs uppercase tracking-wider text-muted-foreground text-right hidden md:table-cell">Cx/h</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedWorkers.map((w, i) => (
                    <tr key={w.workerId} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="p-4 text-center">
                        {i === 0 ? <Medal className="w-6 h-6 text-yellow-500 mx-auto" /> :
                         i === 1 ? <Medal className="w-6 h-6 text-slate-400 mx-auto" /> :
                         i === 2 ? <Medal className="w-6 h-6 text-amber-700 mx-auto" /> :
                         <span className="font-bold text-muted-foreground">{i + 1}</span>}
                      </td>
                      <td className="p-4">
                        <p className="font-bold text-foreground">{w.workerName}</p>
                        <p className="text-xs text-muted-foreground font-mono">{w.workerId}</p>
                      </td>
                      <td className="p-4 text-right font-medium">{w.totalCaixas}</td>
                      <td className="p-4 text-right">
                        <span className="bg-primary/10 text-primary px-3 py-1 rounded-lg font-bold text-lg">
                          {w.totalKg.toFixed(2)}
                        </span>
                      </td>
                      <td className="p-4 text-right font-medium text-foreground">{fmtHours(w.hoursWorked)}</td>
                      <td className="p-4 text-right">
                        {w.kgPorHora !== null ? (
                          <span className="bg-success/10 text-success px-2.5 py-1 rounded-lg font-bold">
                            {w.kgPorHora.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-4 text-right text-muted-foreground hidden sm:table-cell">{w.mediaGrPorCaixa.toFixed(0)}g</td>
                      <td className="p-4 text-right text-muted-foreground hidden md:table-cell">{w.caixasPorHora.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </Layout>
  );
}

function StatCard({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`border rounded-2xl p-4 shadow-sm ${
      highlight ? "bg-primary/5 border-primary/30" : "bg-card border-border"
    }`}>
      <p className={`text-xs font-bold uppercase tracking-wider mb-1 ${
        highlight ? "text-primary/80" : "text-muted-foreground"
      }`}>{label}</p>
      <p className={`text-2xl font-display font-bold ${highlight ? "text-primary" : "text-foreground"}`}>{value}</p>
    </div>
  );
}
