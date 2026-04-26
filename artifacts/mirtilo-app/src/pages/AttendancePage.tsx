import { useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import {
  useListAttendance,
  useCheckInWorker,
  useCheckOutWorker,
  useCheckInAll,
  useCheckOutAll,
} from "@workspace/api-client-react";
import {
  LogIn, LogOut, Users, Clock, CheckCircle2, Circle, Hourglass, RefreshCw,
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
  const [pendingId, setPendingId] = useState<string | null>(null);

  const { data: entries = [], refetch, isFetching } = useListAttendance(undefined, {
    query: { refetchInterval: 30_000 },
  });

  const checkIn = useCheckInWorker();
  const checkOut = useCheckOutWorker();
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

  const doCheckIn = async (workerId: string) => {
    setPendingId(workerId);
    try {
      await checkIn.mutateAsync({ data: { workerId } });
      beep("success");
      await refetch();
    } catch {
      beep("error");
      toast({ title: "Erro ao registar entrada", variant: "destructive" });
    } finally {
      setPendingId(null);
    }
  };

  const doCheckOut = async (workerId: string) => {
    setPendingId(workerId);
    try {
      await checkOut.mutateAsync({ data: { workerId } });
      beep("success");
      await refetch();
    } catch {
      beep("error");
      toast({ title: "Erro ao registar saída", variant: "destructive" });
    } finally {
      setPendingId(null);
    }
  };

  const doCheckInAll = async () => {
    if (!window.confirm("Registar entrada de TODOS os trabalhadores activos?")) return;
    try {
      await checkInAll.mutateAsync({ data: {} });
      beep("success");
      await refetch();
      toast({ title: "Entradas registadas", description: "Todos os trabalhadores activos deram entrada." });
    } catch {
      beep("error");
      toast({ title: "Erro", variant: "destructive" });
    }
  };

  const doCheckOutAll = async () => {
    if (!window.confirm("Registar saída de TODOS os trabalhadores ainda no terreno?")) return;
    try {
      await checkOutAll.mutateAsync({ data: {} });
      beep("success");
      await refetch();
      toast({ title: "Saídas registadas", description: "Todos deram saída." });
    } catch {
      beep("error");
      toast({ title: "Erro", variant: "destructive" });
    }
  };

  return (
    <Layout>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
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

        {/* Bulk actions */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={doCheckInAll}
            disabled={checkInAll.isPending}
            className="flex items-center justify-center gap-2 py-4 bg-success text-white font-bold rounded-2xl shadow-lg shadow-success/20 hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            <Users className="w-5 h-5" /> Entrada — Todos
          </button>
          <button
            onClick={doCheckOutAll}
            disabled={checkOutAll.isPending}
            className="flex items-center justify-center gap-2 py-4 bg-foreground text-background font-bold rounded-2xl shadow-lg hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            <Users className="w-5 h-5" /> Saída — Todos
          </button>
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
                const isWaiting = !e.checkInAt;
                const busy = pendingId === e.workerId;

                return (
                  <li key={e.workerId} className="p-4 flex items-center gap-3">
                    {/* Status dot */}
                    <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
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
                      <div className="flex gap-3 mt-1 text-[11px] text-muted-foreground">
                        <span>Entrada: <strong className="text-foreground">{fmtTime(e.checkInAt)}</strong></span>
                        <span>Saída: <strong className="text-foreground">{fmtTime(e.checkOutAt)}</strong></span>
                        {e.hoursWorked !== null && (
                          <span>Total: <strong className="text-primary">{fmtHours(e.hoursWorked)}</strong></span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="shrink-0 flex flex-col gap-1.5">
                      {(isWaiting || isDone) && (
                        <button
                          onClick={() => doCheckIn(e.workerId)}
                          disabled={busy}
                          className="flex items-center gap-1.5 px-3 py-2 bg-success text-white rounded-lg text-xs font-bold hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
                        >
                          <LogIn className="w-3.5 h-3.5" /> Entrada
                        </button>
                      )}
                      {isIn && (
                        <button
                          onClick={() => doCheckOut(e.workerId)}
                          disabled={busy}
                          className="flex items-center gap-1.5 px-3 py-2 bg-foreground text-background rounded-lg text-xs font-bold hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
                        >
                          <LogOut className="w-3.5 h-3.5" /> Saída
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Layout>
  );
}
