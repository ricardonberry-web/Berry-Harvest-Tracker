import { useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import {
  useListAttendance,
  useListWorkers,
  useListAttendanceShifts,
  useCheckInAll,
  useCheckOutAll,
} from "@workspace/api-client-react";
import {
  LogIn, LogOut, Users, Clock, CheckCircle2, Circle, Hourglass, RefreshCw, CheckSquare, Square,
  Plus, Pencil, Trash2, X, Calendar as CalendarIcon,
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useBeep } from "@/hooks/use-beep";
import { useQueryClient } from "@tanstack/react-query";

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

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
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<"in" | "out" | null>(null);

  const [showShiftModal, setShowShiftModal] = useState(false);
  const [shiftDate, setShiftDate] = useState(todayISO());
  const [editingShift, setEditingShift] = useState<{
    mode: "edit" | "create";
    id?: number;
    workerId: string;
    date: string;
    checkIn: string;
    checkOut: string;
  } | null>(null);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkCheckIn, setBulkCheckIn] = useState("");
  const [bulkCheckOut, setBulkCheckOut] = useState("");
  const [bulkEditBusy, setBulkEditBusy] = useState(false);

  const { data: entries = [], refetch, isFetching } = useListAttendance(undefined, {
    query: { refetchInterval: 30_000 } as any,
  });

  const { data: shifts = [], refetch: refetchShifts } = useListAttendanceShifts(
    { date: shiftDate },
    { query: { enabled: showShiftModal, refetchInterval: 30_000 } as any },
  );

  const { data: workers = [] } = useListWorkers();

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

    const selectedArray = Array.from(selected);
    const alreadyIn = entries.filter(e => selectedArray.includes(e.workerId) && e.checkInAt && !e.checkOutAt);
    if (alreadyIn.length > 0) {
      const names = alreadyIn.map(e => e.workerName).join(", ");
      if (!window.confirm(
        `${alreadyIn.length} j\u00e1 no terreno\n${names}\n\nRegistar nova entrada?`
      )) return;
    }

    setBulkBusy("in");
    try {
      await checkInAll.mutateAsync({ data: { workerIds: selectedArray } });
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

    const selectedArray = Array.from(selected);
    const alreadyOut = entries.filter(e => selectedArray.includes(e.workerId) && e.checkInAt && e.checkOutAt);
    if (alreadyOut.length > 0) {
      const names = alreadyOut.map(e => e.workerName).join(", ");
      if (!window.confirm(
        `${alreadyOut.length} j\u00e1 sa\u00edu\n${names}\n\nRegistar nova sa\u00edda?`
      )) return;
    }

    setBulkBusy("out");
    try {
      await checkOutAll.mutateAsync({ data: { workerIds: selectedArray } });
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

  const handleEditShift = (shift: { id: number | null; workerId: string; date: string; checkInAt: string | null; checkOutAt: string | null }) => {
    setEditingShift({
      mode: "edit",
      id: shift.id ?? 0,
      workerId: shift.workerId,
      date: shift.date,
      checkIn: shift.checkInAt ? format(new Date(shift.checkInAt), "HH:mm") : "",
      checkOut: shift.checkOutAt ? format(new Date(shift.checkOutAt), "HH:mm") : "",
    });
  };

  const handleAddShift = () => {
    setEditingShift({
      mode: "create",
      workerId: workers[0]?.id ?? "",
      date: shiftDate,
      checkIn: "",
      checkOut: "",
    });
  };

  const handleShiftSave = async () => {
    if (!editingShift) return;
    if (!editingShift.date) {
      toast({ title: "Data inválida", variant: "destructive" });
      return;
    }
    if (!editingShift.checkIn) {
      toast({ title: "Entrada obrigatória", variant: "destructive" });
      return;
    }
    try {
      const payload = {
        date: editingShift.date,
        checkInAt: new Date(editingShift.date + "T" + editingShift.checkIn + ":00").toISOString(),
        checkOutAt: editingShift.checkOut ? new Date(editingShift.date + "T" + editingShift.checkOut + ":00").toISOString() : null,
      };
      const url =
        editingShift.mode === "create"
          ? import.meta.env.VITE_API_URL + "/api/attendance/shift"
          : import.meta.env.VITE_API_URL + "/api/attendance/shift/" + editingShift.id;
      const res = await fetch(url, {
        method: editingShift.mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editingShift.mode === "create" ? { workerId: editingShift.workerId, ...payload } : payload,
        ),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({ title: body.error ?? "Erro ao guardar", variant: "destructive" });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/attendance"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/attendance/shift"] });
      setEditingShift(null);
      toast({ title: editingShift.mode === "create" ? "Turno adicionado" : "Turno atualizado" });
      await refetch();
    } catch {
      toast({ title: "Erro ao guardar", variant: "destructive" });
    }
  };

  const handleDeleteShift = async (id: number) => {
    if (!window.confirm("Apagar este turno?")) return;
    try {
      await fetch(import.meta.env.VITE_API_URL + "/api/attendance/shift/" + id, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: ["/api/attendance"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/attendance/shift"] });
      toast({ title: "Turno apagado" });
      await refetch();
    } catch {
      toast({ title: "Erro ao apagar", variant: "destructive" });
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
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowShiftModal(true)}
                className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/50 transition-colors"
                title="Ver turnos"
              >
                <Users className="w-5 h-5" />
              </button>
              <button
                onClick={() => refetch()}
                className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/50 transition-colors"
                title="Actualizar"
              >
                <RefreshCw className={`w-5 h-5 ${isFetching ? "animate-spin" : ""}`} />
              </button>
            </div>
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

      {/* Shift Modal */}
      {showShiftModal && (
        <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-md overflow-y-auto">
          <div className="bg-card w-full max-w-4xl sm:rounded-2xl shadow-2xl flex flex-col max-h-screen sm:max-h-[90vh]">
            {/* Header */}
            <div className="flex items-start justify-between p-5 border-b border-border">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2.5 bg-primary/10 text-primary rounded-xl shrink-0">
                  <Clock className="w-6 h-6" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-xl font-display font-bold text-foreground truncate">Turnos do Dia</h2>
                  <p className="text-xs text-muted-foreground">Editar entrada/saída de toda a gente</p>
                </div>
              </div>
              <button onClick={() => { setShowShiftModal(false); setEditingShift(null); }} className="p-2 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground shrink-0">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Date picker */}
            <div className="p-5 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <input
                    type="date"
                    value={shiftDate}
                    onChange={e => setShiftDate(e.target.value)}
                    className="w-full bg-background border border-border rounded-xl pl-10 pr-3 py-2.5 font-medium focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <button
                  onClick={handleAddShift}
                  disabled={workers.length === 0}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-success text-white font-bold rounded-xl shadow-lg shadow-success/20 hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-40"
                >
                  <Plus className="w-4 h-4" /> Adicionar
                </button>
                <button
                  onClick={() => setBulkEditOpen(true)}
                  disabled={shifts.length === 0}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white font-bold rounded-xl shadow-lg shadow-primary/20 hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-40"
                >
                  <Pencil className="w-4 h-4" /> Horarios
                </button>
              </div>
            </div>

            {/* Shift list */}
            <div className="flex-1 overflow-auto">
              {shifts.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground">
                  <Clock className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p>Sem turnos neste dia.</p>
                  <button
                    onClick={handleAddShift}
                    className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary font-bold rounded-xl hover:bg-primary/20"
                  >
                    <Plus className="w-4 h-4" /> Adicionar turno
                  </button>
                </div>
              ) : (
                <table className="w-full text-left">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="p-3 font-bold text-xs uppercase tracking-wider text-muted-foreground">Trabalhador</th>
                      <th className="p-3 font-bold text-xs uppercase tracking-wider text-muted-foreground text-center">Entrada</th>
                      <th className="p-3 font-bold text-xs uppercase tracking-wider text-muted-foreground text-center">Saída</th>
                      <th className="p-3 font-bold text-xs uppercase tracking-wider text-muted-foreground text-right">Horas</th>
                      <th className="p-3 font-bold text-xs uppercase tracking-wider text-muted-foreground text-center">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shifts.map((s) => (
                      <tr key={s.id} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="p-3">
                          <p className="font-bold text-foreground">{s.workerName}</p>
                          <p className="text-xs text-muted-foreground font-mono">{s.workerId}</p>
                        </td>
                        <td className="p-3 text-center font-mono text-foreground">{fmtTime(s.checkInAt)}</td>
                        <td className="p-3 text-center font-mono text-foreground">{fmtTime(s.checkOutAt)}</td>
                        <td className="p-3 text-right font-bold text-foreground">{fmtHours(s.hoursWorked)}</td>
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button onClick={() => handleEditShift(s)} className="p-1.5 rounded-lg hover:bg-primary/10 text-primary transition-colors" title="Editar turno">
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleDeleteShift(s.id ?? 0)} className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive transition-colors" title="Apagar turno">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bulk Edit Modal */}
      {bulkEditOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-card w-full max-w-sm rounded-2xl shadow-2xl p-6 space-y-4">
            <h2 className="text-lg font-bold">Alterar Horários do Dia</h2>
            <p className="text-xs text-muted-foreground">Aplica a <strong>{shifts.length}</strong> turnos em {new Set(shifts.map(s => s.workerId)).size} trabalhadores.</p>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Nova Entrada</label>
              <input type="time" value={bulkCheckIn} onChange={e => setBulkCheckIn(e.target.value)}
                className="w-full mt-1 border border-border rounded-lg px-4 py-2 font-mono focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Nova Saída</label>
              <input type="time" value={bulkCheckOut} onChange={e => setBulkCheckOut(e.target.value)}
                className="w-full mt-1 border border-border rounded-lg px-4 py-2 font-mono focus:outline-none focus:border-primary" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setBulkEditOpen(false)} className="flex-1 py-2 rounded-lg border border-border font-bold hover:bg-muted/50">Cancelar</button>
              <button
                onClick={async () => {
                  if (!bulkCheckIn && !bulkCheckOut) {
                    toast({ title: "Nada a alterar", variant: "destructive" });
                    return;
                  }
                  if (!window.confirm(`Alterar horários de ${shifts.length} turnos?\n\nEntrada: ${bulkCheckIn || "—"}\nSaída: ${bulkCheckOut || "—"}`)) return;
                  setBulkEditBusy(true);
                  try {
                    const body: Record<string, unknown> = {
                      shiftIds: shifts.map(s => s.id),
                      date: shiftDate,
                    };
                    if (bulkCheckIn) body.checkInAt = new Date(shiftDate + "T" + bulkCheckIn + ":00").toISOString();
                    if (bulkCheckOut) body.checkOutAt = new Date(shiftDate + "T" + bulkCheckOut + ":00").toISOString();
                    const res = await fetch(import.meta.env.VITE_API_URL + "/api/attendance/shift/bulk-update", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(body),
                    });
                    if (!res.ok) {
                      const body = await res.json().catch(() => ({}));
                      toast({ title: body.error ?? "Erro ao alterar", variant: "destructive" });
                      return;
                    }
                    await queryClient.invalidateQueries({ queryKey: ["/api/attendance"] });
                    await queryClient.invalidateQueries({ queryKey: ["/api/attendance/shift"] });
                    setBulkEditOpen(false);
                    setBulkCheckIn("");
                    setBulkCheckOut("");
                    toast({ title: "Horários alterados", description: `${shifts.length} turnos actualizados.` });
                    await refetch();
                    await refetchShifts();
                  } catch {
                    toast({ title: "Erro ao alterar", variant: "destructive" });
                  } finally {
                    setBulkEditBusy(false);
                  }
                }}
                disabled={bulkEditBusy}
                className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground font-bold hover:opacity-90 disabled:opacity-40"
              >
                {bulkEditBusy ? "A gravar..." : "Alterar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shift Edit Modal */}
      {editingShift && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-card w-full max-w-sm rounded-2xl shadow-2xl p-6 space-y-4">
            <h2 className="text-lg font-bold">{editingShift.mode === "create" ? "Adicionar Turno" : "Editar Turno"}</h2>
            {editingShift.mode === "create" && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Trabalhador</label>
                <select
                  value={editingShift.workerId}
                  onChange={e => setEditingShift({ ...editingShift, workerId: e.target.value })}
                  className="w-full mt-1 border border-border rounded-lg px-4 py-2 font-medium focus:outline-none focus:border-primary bg-background"
                >
                  {workers.map(w => (
                    <option key={w.id} value={w.id}>{w.name} ({w.id})</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="text-sm font-medium text-muted-foreground">Dia</label>
              <input type="date" value={editingShift.date} onChange={e => setEditingShift({ ...editingShift, date: e.target.value })}
                className="w-full mt-1 border border-border rounded-lg px-4 py-2 font-mono focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Entrada</label>
              <input type="time" value={editingShift.checkIn} onChange={e => setEditingShift({ ...editingShift, checkIn: e.target.value })}
                className="w-full mt-1 border border-border rounded-lg px-4 py-2 font-mono focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Saída</label>
              <input type="time" value={editingShift.checkOut} onChange={e => setEditingShift({ ...editingShift, checkOut: e.target.value })}
                className="w-full mt-1 border border-border rounded-lg px-4 py-2 font-mono focus:outline-none focus:border-primary" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setEditingShift(null)} className="flex-1 py-2 rounded-lg border border-border font-bold hover:bg-muted/50">Cancelar</button>
              <button onClick={handleShiftSave} className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground font-bold hover:opacity-90">Guardar</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
