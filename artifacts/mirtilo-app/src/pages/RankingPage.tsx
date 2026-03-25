import { useState } from "react";
import { Layout } from "@/components/Layout";
import { useGetDailyReport } from "@workspace/api-client-react";
import { Trophy, Download, Calendar as CalendarIcon, Medal } from "lucide-react";
import { format } from "date-fns";

export default function RankingPage() {
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  
  const { data: report, isLoading } = useGetDailyReport({ date }, {
    query: { keepPreviousData: true }
  });

  const handleExport = () => {
    // Basic export redirect relying on API endpoint returning CSV
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Colhido" value={`${report?.totalKg.toFixed(1) || 0} kg`} />
          <StatCard label="Total Caixas" value={report?.totalRecords.toString() || "0"} />
          <StatCard label="Trabalhadores" value={report?.workers.length.toString() || "0"} />
          <StatCard 
            label="Média p/ Trabalhador" 
            value={report?.workers.length ? `${(report.totalKg / report.workers.length).toFixed(1)} kg` : "0 kg"} 
          />
        </div>

        {/* Ranking Table */}
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="p-12 flex justify-center">
              <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div>
            </div>
          ) : !report?.workers.length ? (
             <div className="p-12 text-center text-muted-foreground">
                <Trophy className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p>Sem dados de colheita para este dia.</p>
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
                    <th className="p-4 font-bold text-xs uppercase tracking-wider text-muted-foreground text-right hidden sm:table-cell">Média/Caixa</th>
                    <th className="p-4 font-bold text-xs uppercase tracking-wider text-muted-foreground text-right hidden md:table-cell">Caixas/H</th>
                  </tr>
                </thead>
                <tbody>
                  {report.workers.map((w, i) => (
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
      <p className="text-2xl font-display font-bold text-foreground">{value}</p>
    </div>
  );
}
