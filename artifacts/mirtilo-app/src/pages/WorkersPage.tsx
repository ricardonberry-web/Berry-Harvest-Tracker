import { useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import {
  useListWorkers,
  useCreateWorker,
  useGetWorkerTimesheet,
} from "@workspace/api-client-react";
import { Users, Plus, QrCode, Search, UserCheck, Clock, Download, X, Calendar as CalendarIcon, Euro } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { getListWorkersQueryKey } from "@workspace/api-client-react";
import { format, subDays } from "date-fns";

export default function WorkersPage() {
  const [search, setSearch] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [selectedQR, setSelectedQR] = useState<{id: string, name: string} | null>(null);
  const [selectedTimesheet, setSelectedTimesheet] = useState<{id: string, name: string} | null>(null);

  const { data: workers = [], isLoading } = useListWorkers();
  const filteredWorkers = workers.filter(w =>
    w.name.toLowerCase().includes(search.toLowerCase()) ||
    w.id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Layout>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Equipa</h1>
            <p className="text-muted-foreground">Gestão de trabalhadores, badges QR e folhas de horas</p>
          </div>

          <button
            onClick={() => setIsAddOpen(true)}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-3 rounded-xl font-bold shadow-lg shadow-primary/25 hover:shadow-xl hover:-translate-y-0.5 transition-all"
          >
            <Plus className="w-5 h-5" />
            Adicionar Trabalhador
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
            <Search className="w-5 h-5 text-muted-foreground" />
          </div>
          <input
            type="text"
            placeholder="Pesquisar por nome ou ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-card border-2 border-border rounded-xl pl-12 pr-4 py-4 text-foreground font-medium focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all shadow-sm"
          />
        </div>

        {/* Grid */}
        {isLoading ? (
           <div className="flex justify-center p-12">
             <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div>
           </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredWorkers.map(worker => (
              <div key={worker.id} className="bg-card border border-border rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow group flex flex-col">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-bold text-lg text-foreground">{worker.name}</h3>
                    <span className="inline-flex mt-1 items-center gap-1 bg-muted px-2 py-1 rounded text-xs font-mono font-medium text-muted-foreground">
                      <UserCheck className="w-3 h-3" /> {worker.id}
                    </span>
                  </div>
                  <div className={`w-3 h-3 rounded-full ${worker.active ? 'bg-success shadow-[0_0_8px_rgba(0,255,0,0.5)]' : 'bg-destructive'}`} />
                </div>

                <div className="mt-auto pt-4 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setSelectedQR({ id: worker.id, name: worker.name })}
                    className="flex items-center justify-center gap-2 bg-secondary text-secondary-foreground py-2 rounded-lg font-medium hover:bg-secondary/80 transition-colors text-sm"
                  >
                    <QrCode className="w-4 h-4" />
                    Badge
                  </button>
                  <button
                    onClick={() => setSelectedTimesheet({ id: worker.id, name: worker.name })}
                    className="flex items-center justify-center gap-2 bg-primary/10 text-primary py-2 rounded-lg font-bold hover:bg-primary/20 transition-colors text-sm"
                  >
                    <Clock className="w-4 h-4" />
                    Folha Horas
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>

      {isAddOpen && <AddWorkerModal onClose={() => setIsAddOpen(false)} />}
      {selectedQR && <QRModal data={selectedQR} onClose={() => setSelectedQR(null)} />}
      {selectedTimesheet && (
        <TimesheetModal
          worker={selectedTimesheet}
          onClose={() => setSelectedTimesheet(null)}
        />
      )}
    </Layout>
  );
}

function AddWorkerModal({ onClose }: { onClose: () => void }) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const createWorker = useCreateWorker();
  const queryClient = useQueryClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createWorker.mutateAsync({
        data: { id: id.trim().toUpperCase(), name: name.trim() }
      });
      queryClient.invalidateQueries({ queryKey: getListWorkersQueryKey() });
      onClose();
    } catch {
      alert("Erro ao criar. O ID já existe?");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-card w-full max-w-md rounded-2xl shadow-2xl p-6">
        <h2 className="text-2xl font-display font-bold mb-6">Novo Trabalhador</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-muted-foreground mb-1">ID (Identificador Único)</label>
            <input
              required
              value={id}
              onChange={e => setId(e.target.value)}
              placeholder="ex: W001"
              className="w-full bg-background border-2 border-border rounded-xl px-4 py-3 font-mono uppercase focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-muted-foreground mb-1">Nome Completo</label>
            <input
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Nome do trabalhador"
              className="w-full bg-background border-2 border-border rounded-xl px-4 py-3 focus:border-primary focus:outline-none"
            />
          </div>
          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 py-3 bg-muted text-muted-foreground font-bold rounded-xl hover:bg-muted/80">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={createWorker.isPending}
              className="flex-1 py-3 bg-primary text-primary-foreground font-bold rounded-xl shadow-lg shadow-primary/25 hover:shadow-primary/40 disabled:opacity-50"
            >
              {createWorker.isPending ? "A guardar..." : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function QRModal({ data, onClose }: { data: { id: string, name: string }, onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md" onClick={onClose}>
      <div className="bg-white text-black w-full max-w-sm rounded-3xl p-8 text-center flex flex-col items-center" onClick={e => e.stopPropagation()}>
        <h2 className="text-3xl font-display font-black mb-1">{data.name}</h2>
        <p className="text-gray-500 font-mono text-lg mb-8 tracking-widest">{data.id}</p>

        <div className="bg-white p-4 border-4 border-gray-100 rounded-2xl mb-8">
          <QRCodeSVG value={data.id} size={200} level="H" />
        </div>

        <button onClick={onClose} className="w-full py-4 bg-gray-100 text-gray-800 font-bold rounded-xl hover:bg-gray-200 transition-colors">
          Fechar
        </button>
      </div>
    </div>
  );
}

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return format(new Date(iso), "HH:mm");
}

function fmtHours(h: number | null) {
  if (h === null || h === undefined) return "—";
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh}h${String(mm).padStart(2, "0")}`;
}

function fmtDate(d: string) {
  try {
    return format(new Date(d), "dd/MM/yyyy");
  } catch {
    return d;
  }
}

function TimesheetModal({ worker, onClose }: { worker: { id: string, name: string }, onClose: () => void }) {
  const [from, setFrom] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [rateInput, setRateInput] = useState("");

  const hourlyRate = useMemo(() => {
    const n = Number(rateInput.replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [rateInput]);

  const { data: ts, isLoading } = useGetWorkerTimesheet(
    worker.id,
    { from, to, ...(hourlyRate !== null ? { hourlyRate } : {}) },
    { query: { keepPreviousData: true } },
  );

  const handleExport = () => {
    const params = new URLSearchParams({ from, to });
    if (hourlyRate !== null) params.set("hourlyRate", String(hourlyRate));
    window.location.href = `/api/workers/${encodeURIComponent(worker.id)}/timesheet/export?${params.toString()}`;
  };

  const setQuickRange = (days: number) => {
    setFrom(format(subDays(new Date(), days), "yyyy-MM-dd"));
    setTo(format(new Date(), "yyyy-MM-dd"));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-md overflow-y-auto" onClick={onClose}>
      <div
        className="bg-card w-full max-w-4xl sm:rounded-2xl shadow-2xl flex flex-col max-h-screen sm:max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 bg-primary/10 text-primary rounded-xl shrink-0">
              <Clock className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-display font-bold text-foreground truncate">Folha de Horas — {worker.name}</h2>
              <p className="text-xs text-muted-foreground font-mono">{worker.id}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filters */}
        <div className="p-5 space-y-3 border-b border-border">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">De</label>
              <div className="relative">
                <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  type="date"
                  value={from}
                  max={to}
                  onChange={e => setFrom(e.target.value)}
                  className="w-full bg-background border border-border rounded-xl pl-10 pr-3 py-2.5 font-medium focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Até</label>
              <div className="relative">
                <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  type="date"
                  value={to}
                  min={from}
                  onChange={e => setTo(e.target.value)}
                  className="w-full bg-background border border-border rounded-xl pl-10 pr-3 py-2.5 font-medium focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Valor / hora</label>
              <div className="relative">
                <Euro className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={rateInput}
                  onChange={e => setRateInput(e.target.value)}
                  className="w-full bg-background border border-border rounded-xl pl-10 pr-3 py-2.5 font-medium focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={() => setQuickRange(6)} className="px-3 py-1.5 text-xs font-bold bg-muted text-muted-foreground rounded-lg hover:bg-muted/70">Últ. 7 dias</button>
            <button onClick={() => setQuickRange(13)} className="px-3 py-1.5 text-xs font-bold bg-muted text-muted-foreground rounded-lg hover:bg-muted/70">Últ. 14 dias</button>
            <button onClick={() => setQuickRange(29)} className="px-3 py-1.5 text-xs font-bold bg-muted text-muted-foreground rounded-lg hover:bg-muted/70">Últ. 30 dias</button>
            <button onClick={() => {
              const d = new Date();
              setFrom(format(new Date(d.getFullYear(), d.getMonth(), 1), "yyyy-MM-dd"));
              setTo(format(d, "yyyy-MM-dd"));
            }} className="px-3 py-1.5 text-xs font-bold bg-muted text-muted-foreground rounded-lg hover:bg-muted/70">Este mês</button>
          </div>
        </div>

        {/* Stats */}
        <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-3 border-b border-border bg-muted/20">
          <Stat label="Dias" value={ts?.totalDays?.toString() ?? "0"} />
          <Stat label="Total horas" value={ts ? `${ts.totalHours.toFixed(2)} h` : "—"} />
          <Stat label="Valor / hora" value={hourlyRate !== null ? `${hourlyRate.toFixed(2)} €` : "—"} />
          <Stat
            label="Total a pagar"
            value={ts?.totalPay !== null && ts?.totalPay !== undefined ? `${ts.totalPay.toFixed(2)} €` : "—"}
            highlight
          />
        </div>

        {/* Days table */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="p-12 flex justify-center">
              <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div>
            </div>
          ) : !ts || ts.days.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Clock className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p>Sem dias trabalhados neste período.</p>
            </div>
          ) : (
            <table className="w-full text-left">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="p-3 font-bold text-xs uppercase tracking-wider text-muted-foreground">Data</th>
                  <th className="p-3 font-bold text-xs uppercase tracking-wider text-muted-foreground text-center">Entrada</th>
                  <th className="p-3 font-bold text-xs uppercase tracking-wider text-muted-foreground text-center">Saída</th>
                  <th className="p-3 font-bold text-xs uppercase tracking-wider text-muted-foreground text-right">Horas</th>
                  <th className="p-3 font-bold text-xs uppercase tracking-wider text-primary text-right">Valor (€)</th>
                </tr>
              </thead>
              <tbody>
                {ts.days.map(d => (
                  <tr key={d.date} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="p-3 font-medium text-foreground">{fmtDate(d.date)}</td>
                    <td className="p-3 text-center font-mono text-foreground">{fmtTime(d.checkInAt)}</td>
                    <td className="p-3 text-center font-mono text-foreground">{fmtTime(d.checkOutAt)}</td>
                    <td className="p-3 text-right font-bold text-foreground">{fmtHours(d.hoursWorked)}</td>
                    <td className="p-3 text-right">
                      {d.pay !== null ? (
                        <span className="bg-success/10 text-success px-2.5 py-1 rounded-lg font-bold">
                          {d.pay.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              {ts.days.length > 0 && (
                <tfoot className="bg-muted/40 border-t-2 border-border sticky bottom-0">
                  <tr>
                    <td className="p-3 font-display font-bold uppercase text-foreground" colSpan={3}>Total</td>
                    <td className="p-3 text-right font-display font-black text-foreground text-lg">{ts.totalHours.toFixed(2)} h</td>
                    <td className="p-3 text-right font-display font-black text-primary text-lg">
                      {ts.totalPay !== null ? `${ts.totalPay.toFixed(2)} €` : "—"}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex flex-col sm:flex-row gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 bg-muted text-foreground font-bold rounded-xl hover:bg-muted/80"
          >
            Fechar
          </button>
          <button
            onClick={handleExport}
            disabled={!ts || ts.days.length === 0}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-primary text-primary-foreground font-bold rounded-xl shadow-lg shadow-primary/25 hover:shadow-primary/40 disabled:opacity-50"
          >
            <Download className="w-5 h-5" />
            Exportar CSV
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl p-3 border ${highlight ? "bg-primary/5 border-primary/30" : "bg-card border-border"}`}>
      <p className={`text-[10px] font-bold uppercase tracking-wider mb-0.5 ${highlight ? "text-primary/80" : "text-muted-foreground"}`}>{label}</p>
      <p className={`text-lg sm:text-xl font-display font-bold ${highlight ? "text-primary" : "text-foreground"}`}>{value}</p>
    </div>
  );
}
