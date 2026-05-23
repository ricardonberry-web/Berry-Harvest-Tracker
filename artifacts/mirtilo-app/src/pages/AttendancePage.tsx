import { useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import {
  useListAttendance,
  useCheckInAll,
  useCheckOutAll,
} from "@workspace/api-client-react";
import {
  LogIn, LogOut, Users, Clock, CheckCircle2, Circle, Hourglass, RefreshCw, CheckSquare, Square,
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useBeep } from "@/hooks/use-beep";

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return format(new Date(iso), "HH:mm");
}

function fmtHours(h: number | null) {
  if (h === null || h === undefined) return "—";
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh}h ${String(mm).padStart(2, "0")}m`;
}

export default function AttendancePage() {
  const { toast } = useToast();
  const beep = useBeep();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<"in" | "out" | null>(null);

  const { data: entries = [], refetch, isFetching } = useListAttendance(undefined, {
    query: { refetchInterval: 30_000 },
  });

  const checkInAll = useCheckInAll();
  const checkOutAll = useCheckOutAll();

  const stats = useMemo(() => {
    const total = entries.length;
    const checkedIn = entries.filter(e => e.checkInAt && !e.checkOutAt).length;
    const done = entries.filter(e => e.checkInAt && e.checkOutAt).length;
    const totalHours = entries.reduce((acc, e) => acc + (e.hoursWorked ?? 0), 0);
    return { total, checkedIn, done, totalHours };
  }, [entries]);

  const today = format(new Date(), "EEEE, dd MMM yyyy");

  const toggle = (workerId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(workerId)) next.delete(workerId);
      else next.add(workerId);
      return next;
    });
  };

  const allSelected = entries.length > 0 && selected.size === entries.length;
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(entries.map(e => e.workerId)));
  };

  const doCheckInSelected = async () => {
    if (selected.size === 0) return;

    setBulkBusy("in");
    try {
      await checkInAll.mutateAsync({ data: { workerIds: Array.from(selected) } });
      beep("success");
      await refetch();
      toast({ title: "Entradas registadas", description: `${selected.size} trabalhador(es).` });
      setSelected(new Set());
    } catch {
      beep("error");
      toast({ title: "Erro ao registar entradas", variant: "destructive" });
    } finally {
      setBulkBusy(null);
    }
  };

  const doCheckOutSelected = async () => {
    if (selected.size === 0) return;

    setBulkBusy("out");
    try {
      await checkOutAll.mutateAsync({ data: { workerIds: Array.from(selected) } });
      beep("success");
      await refetch();
      toast({ title: "Saídas registadas", description: `${selected.size} trabalhador(es).` });
      setSelected(new Set());
    } catch {
      beep("error");
      toast({ title: "Erro ao registar saídas", variant: "destructive" });
    } finally {
      setBulkBusy(null);
    }
  };

  return (
    <Layout>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6 pb-32">
        {/* Header */}
        <div className="bg-card rounded-2xl shadow-sm border border-border p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
                <Clock className="text-primary w-6 h-6" /> Entradas / Saídas
              </h1>
              <p className="text-sm text-muted-foreground capitalize mt-1">{today}</p>
            </div>
            <button
              onClick={() => refetch()}
              className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/50 transition-colors"
              title="Actualizar"
            >
              <RefreshCw className={`w-5 h-5 ${isFetching ? "animate-spin" : ""}`} />
            </button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-success/10 border border-success/20 rounded-xl p-3">
              <p className="text-xs text-success/80 font-bold uppercase">No terreno</p>
              <p className="text-2xl font-display font-black text-success">{stats.checkedIn}</p>
            </div>
            <div className="bg-muted/50 border border-border rounded-xl p-3">
              <p className="text-xs text-muted-foreground font-bold uppercase">Já saíram</p>
              <p className="text-2xl font-display font-black text-foreground">{stats.done}</p>
            </div>
            <div className="bg-primary/10 border border-primary/20 rounded-xl p-3">
              <p className="text-xs text-primary/80 font-bold uppercase">Total horas</p>
              <p className="text-2xl font-display font-black text-primary">{stats.totalHours.toFixed(1)}h</p>
            </div>
          </div>
        </div>

        {/* Selection toolbar */}
        <div className="bg-card rounded-2xl shadow-sm border border-border p-3 flex items-center justify-between sticky top-2 z-10">
          <button
            onClick={toggleAll}
            className="flex items-center gap-2 px-3 py-2 text-sm font-bold text-foreground hover:bg-muted/50 rounded-lg transition-colors"
          >
            {allSelected
              ? <CheckSquare className="w-5 h-5 text-primary" />
              : <Square className="w-5 h-5 text-muted-foreground" />}
            {allSelected ? "Desmarcar todos" : "Seleccionar todos"}
          </button>
          <span className="text-sm font-bold text-muted-foreground">
            {selected.size} de {entries.length} seleccionado{selected.size === 1 ? "" : "s"}
          </span>
        </div>

        {/* Worker list */}
        <div className="bg-card rounded-2xl shadow-sm border border-border overflow-hidden">
          {entries.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Nenhum trabalhador registado ainda.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {entries.map((e) => {
                const isIn = !!e.checkInAt && !e.checkOutAt;
                const isDone = !!e.checkInAt && !!e.checkOutAt;
                const isChecked = selected.has(e.workerId);

                return (
                  <li
                    key={e.workerId}
                    className={`p-4 flex items-center gap-3 cursor-pointer transition-colors ${
                      isChecked ? "bg-primary/5" : "hover:bg-muted/30"
                    }`}
                    onClick={() => toggle(e.workerId)}
                  >
                    {/* Checkbox */}
                    <div className="shrink-0">
                      {isChecked
                        ? <CheckSquare className="w-6 h-6 text-primary" />
                        : <Square className="w-6 h-6 text-muted-foreground" />}
                    </div>

                    {/* Status dot */}
                    <div className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${
                      isIn ? "bg-success/15 text-success" :
                      isDone ? "bg-muted text-muted-foreground" :
                      "bg-destructive/10 text-destructive"
                    }`}>
                      {isIn ? <CheckCircle2 className="w-5 h-5" /> :
                       isDone ? <Hourglass className="w-5 h-5" /> :
                       <Circle className="w-5 h-5" />}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-foreground truncate">{e.workerName}</p>
                      <p className="text-xs text-muted-foreground font-mono">{e.workerId}</p>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11px] text-muted-foreground">
                        <span>Entrada: <strong className="text-foreground">{fmtTime(e.checkInAt)}</strong></span>
                        <span>Saída: <strong className="text-foreground">{fmtTime(e.checkOutAt)}</strong></span>
                        {e.hoursWorked !== null && (
                          <span>Total: <strong className="text-primary">{fmtHours(e.hoursWorked)}</strong></span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Sticky action bar */}
      <div className="fixed bottom-20 left-0 right-0 z-30 px-4 pointer-events-none">
        <div className={`max-w-3xl mx-auto rounded-2xl border-2 shadow-2xl backdrop-blur-xl transition-all ${
          selected.size > 0
            ? "pointer-events-auto bg-card/95 border-primary opacity-100 translate-y-0"
            : "pointer-events-none bg-card/60 border-border opacity-70 translate-y-2"
        }`}>
          <div className="p-3 grid grid-cols-2 gap-3">
            <button
              onClick={doCheckInSelected}
              disabled={selected.size === 0 || bulkBusy !== null}
              className="flex items-center justify-center gap-2 py-4 bg-success text-white font-bold rounded-xl shadow-lg shadow-success/20 hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <LogIn className="w-5 h-5" />
              {bulkBusy === "in" ? "A registar…" : `Entrada (${selected.size})`}
            </button>
            <button
              onClick={doCheckOutSelected}
              disabled={selected.size === 0 || bulkBusy !== null}
              className="flex items-center justify-center gap-2 py-4 bg-foreground text-background font-bold rounded-xl shadow-lg hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <LogOut className="w-5 h-5" />
              {bulkBusy === "out" ? "A registar…" : `Saída (${selected.size})`}
            </button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
