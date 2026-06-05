import { useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import {
  useListWorkers,
  useCreateWorker,
  useUpdateWorker,
  useDeleteWorker,
  useGetWorkerTimesheet,
} from "@workspace/api-client-react";
import { Users, Plus, QrCode, Search, UserCheck, Clock, Download, X, Calendar as CalendarIcon, Euro, Pencil, Trash2, AlertTriangle, Power, PowerOff } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { getListWorkersQueryKey, getListAttendanceQueryKey } from "@workspace/api-client-react";
import { format, subDays } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import {
  QUALITY_ISSUES,
  QUALITY_LABELS,
  QUALITY_SHORT,
  QUALITY_CHIP_CLASS,
} from "@/lib/quality-issues";

type WorkerRow = { id: string; name: string; active: boolean };

export default function WorkersPage() {
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(true);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [selectedQR, setSelectedQR] = useState<{id: string, name: string} | null>(null);
  const [selectedTimesheet, setSelectedTimesheet] = useState<{id: string, name: string} | null>(null);
  const [selectedEdit, setSelectedEdit] = useState<WorkerRow | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateWorker = useUpdateWorker();

  const { data: workers = [], isLoading } = useListWorkers();
  const filteredWorkers = workers.filter(w => {
    if (!showInactive && !w.active) return false;
    return (
      w.name.toLowerCase().includes(search.toLowerCase()) ||
      w.id.toLowerCase().includes(search.toLowerCase())
    );
  });

  const toggleActive = async (w: { id: string; name: string; active: boolean }) => {
    const willDeactivate = w.active;
    if (willDeactivate && !window.confirm(
      `Desativar "${w.name}"?\n\nDeixará de aparecer em Entradas/Saídas, mas o histórico de pesagens é mantido.`
    )) return;
    setTogglingId(w.id);
    try {
      await updateWorker.mutateAsync({ id: w.id, data: { active: !w.active } });
      await Promise.all([
        queryClient.refetchQueries({ queryKey: getListWorkersQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListAttendanceQueryKey() }),
      ]);
      toast({
        title: willDeactivate ? "Trabalhador desativado" : "Trabalhador ativado",
        description: w.name,
      });
    } catch {
      toast({ title: "Erro ao atualizar", variant: "destructive" });
    } finally {
      setTogglingId(null);
    }
  };

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

        {/* Search + filter */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
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
          <button
            type="button"
            onClick={() => setShowInactive(v => !v)}
            className={`flex items-center justify-center gap-2 px-4 py-4 rounded-xl border-2 font-bold text-sm transition-all shadow-sm ${
              showInactive
                ? "bg-card border-border text-foreground hover:bg-muted/50"
                : "bg-success/10 border-success/30 text-success hover:bg-success/20"
            }`}
            title={showInactive ? "A mostrar trabalhadores inativos" : "A esconder inativos"}
            data-testid="button-filter-inactive"
            aria-pressed={!showInactive}
          >
            {showInactive ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
            {showInactive ? "Mostrar todos" : "Só ativos"}
          </button>
        </div>

        {/* Grid */}
        {isLoading ? (
           <div className="flex justify-center p-12">
             <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div>
           </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredWorkers.map(worker => (
              <div
                key={worker.id}
                className={`bg-card border rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow group flex flex-col ${
                  worker.active ? "border-border" : "border-destructive/30 bg-muted/20 opacity-80"
                }`}
                data-testid={`worker-card-${worker.id}`}
              >
                <div className="flex justify-between items-start mb-4 gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className={`font-bold text-lg truncate ${worker.active ? "text-foreground" : "text-muted-foreground line-through"}`} data-testid={`text-worker-name-${worker.id}`}>
                        {worker.name}
                      </h3>
                      {!worker.active && (
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-destructive/10 text-destructive border border-destructive/30">
                          Inativo
                        </span>
                      )}
                    </div>
                    <span className="inline-flex mt-1 items-center gap-1 bg-muted px-2 py-1 rounded text-xs font-mono font-medium text-muted-foreground">
                      <UserCheck className="w-3 h-3" /> {worker.id}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => toggleActive({ id: worker.id, name: worker.name, active: worker.active })}
                      disabled={togglingId === worker.id}
                      className={`p-2 rounded-lg transition-colors ${
                        worker.active
                          ? "text-success hover:bg-success/10"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      } disabled:opacity-50`}
                      title={worker.active ? "Desativar trabalhador" : "Ativar trabalhador"}
                      data-testid={`button-toggle-active-${worker.id}`}
                      aria-pressed={worker.active}
                    >
                      {worker.active ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => setSelectedEdit({ id: worker.id, name: worker.name, active: worker.active })}
                      className="p-2 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      title="Editar trabalhador"
                      data-testid={`button-edit-worker-${worker.id}`}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  </div>
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
      {selectedEdit && (
        <EditWorkerModal
          worker={selectedEdit}
          onClose={() => setSelectedEdit(null)}
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

function EditWorkerModal({ worker, onClose }: { worker: WorkerRow; onClose: () => void }) {
  const [name, setName] = useState(worker.name);
  const [active, setActive] = useState(worker.active);
  const updateWorker = useUpdateWorker();
  const deleteWorker = useDeleteWorker();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const dirty = name.trim() !== worker.name || active !== worker.active;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (worker.active && !active && !window.confirm(
      `Desativar "${worker.name}"?\n\nDeixará de aparecer em Entradas/Saídas e não pode pesar. O histórico é mantido.`
    )) return;
    try {
      await updateWorker.mutateAsync({
        id: worker.id,
        data: { name: trimmed, active },
      });
      await Promise.all([
        queryClient.refetchQueries({ queryKey: getListWorkersQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListAttendanceQueryKey() }),
      ]);
      toast({ title: "Trabalhador atualizado", description: trimmed });
      onClose();
    } catch {
      toast({ title: "Erro ao guardar", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(
      `Apagar definitivamente "${worker.name}"?\n\nSe tem pesagens registadas, prefira DESATIVAR para preservar o histórico.`
    )) return;
    try {
      await deleteWorker.mutateAsync({ id: worker.id });
      await queryClient.invalidateQueries({ queryKey: getListWorkersQueryKey() });
      toast({ title: "Trabalhador apagado", description: worker.name });
      onClose();
    } catch {
      toast({
        title: "Erro ao apagar",
        description: "Tem pesagens associadas? Tente desativar em vez de apagar.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card w-full max-w-md rounded-2xl shadow-2xl p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-display font-bold">Editar Trabalhador</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted text-muted-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-muted-foreground mb-1">ID</label>
            <input
              value={worker.id}
              disabled
              className="w-full bg-muted/40 border-2 border-border rounded-xl px-4 py-3 font-mono uppercase text-muted-foreground cursor-not-allowed"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-muted-foreground mb-1">Nome Completo</label>
            <input
              required
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-background border-2 border-border rounded-xl px-4 py-3 focus:border-primary focus:outline-none"
              data-testid="input-edit-worker-name"
            />
          </div>

          <button
            type="button"
            onClick={() => setActive(v => !v)}
            className={`w-full flex items-center justify-between gap-3 p-4 rounded-xl border-2 transition-all ${
              active
                ? "bg-success/10 border-success/30 text-success"
                : "bg-destructive/10 border-destructive/30 text-destructive"
            }`}
            data-testid="button-modal-toggle-active"
            aria-pressed={active}
          >
            <div className="flex items-center gap-3 text-left">
              {active ? <Power className="w-5 h-5 shrink-0" /> : <PowerOff className="w-5 h-5 shrink-0" />}
              <div>
                <p className="font-bold">{active ? "Ativo" : "Inativo"}</p>
                <p className="text-xs opacity-80 font-medium">
                  {active
                    ? "Aparece em Entradas/Saídas e pode pesar."
                    : "Não aparece em Entradas/Saídas. Histórico mantido."}
                </p>
              </div>
            </div>
            <span className={`shrink-0 w-12 h-6 rounded-full p-0.5 transition-colors ${
              active ? "bg-success" : "bg-muted"
            }`}>
              <span className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${
                active ? "translate-x-6" : "translate-x-0"
              }`} />
            </span>
          </button>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleteWorker.isPending}
              className="px-4 py-3 bg-destructive/10 text-destructive font-bold rounded-xl hover:bg-destructive/20 disabled:opacity-50 flex items-center gap-2"
              data-testid="button-delete-worker"
              title="Apagar permanentemente"
            >
              <Trash2 className="w-4 h-4" />
              Apagar
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 bg-muted text-muted-foreground font-bold rounded-xl hover:bg-muted/80"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={updateWorker.isPending || !dirty || !name.trim()}
              className="flex-1 py-3 bg-primary text-primary-foreground font-bold rounded-xl shadow-lg shadow-primary/25 hover:shadow-primary/40 disabled:opacity-50"
              data-testid="button-save-worker"
            >
              {updateWorker.isPending ? "A guardar..." : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function QRModal({ data, onClose }) {
  const handleDownload = () => {
    const svg = document.getElementById("qr-svg");
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 200;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 200, 200);
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, 200, 200);
      const link = document.createElement("a");
      link.download = "qr-" + data.id + ".png";
      link.href = canvas.toDataURL("image/png");
      link.click();
    };
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md" onClick={onClose}>
      <div className="bg-white text-black w-full max-w-sm rounded-3xl p-8 text-center flex flex-col items-center" onClick={e => e.stopPropagation()}>
        <h2 className="text-3xl font-display font-black mb-1">{data.name}</h2>
        <p className="text-gray-500 font-mono text-lg mb-8 tracking-widest">{data.id}</p>
        <div className="bg-white p-4 border-4 border-gray-100 rounded-2xl mb-8">
          <QRCodeSVG id="qr-svg" value={data.id} size={200} level="H" />
        </div>
        <div className="flex gap-3 w-full">
          <button onClick={onClose} className="flex-1 py-4 bg-gray-100 text-gray-800 font-bold rounded-xl hover:bg-gray-200 transition-colors">
            Fechar
          </button>
          <button onClick={handleDownload} className="flex-1 py-4 bg-black text-white font-bold rounded-xl hover:bg-gray-800 transition-colors flex items-center justify-center gap-2">
            <Download className="w-4 h-4" /> Exportar
          </button>
        </div>
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
  // editingShift drives the entrada/saída modal. mode "edit" patches an existing
  // shift by id; mode "create" adds a new shift (turno) to a day.
  const [editingShift, setEditingShift] = useState<
    { mode: "edit" | "create"; id: number | null } | null
  >(null);
  const [editDate, setEditDate] = useState("");
  const [editCheckIn, setEditCheckIn] = useState("");
  const [editCheckOut, setEditCheckOut] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleEditShift = (date: string, shift: { id: number; checkInAt: string | null; checkOutAt: string | null }) => {
    setEditingShift({ mode: "edit", id: shift.id });
    setEditDate(date);
    setEditCheckIn(shift.checkInAt ? format(new Date(shift.checkInAt), "HH:mm") : "");
    setEditCheckOut(shift.checkOutAt ? format(new Date(shift.checkOutAt), "HH:mm") : "");
  };

  const handleAddShift = (date: string) => {
    setEditingShift({ mode: "create", id: null });
    setEditDate(date);
    setEditCheckIn("");
    setEditCheckOut("");
  };

  const handleEditSave = async () => {
    if (!editingShift) return;
    if (!editDate) { toast({ title: "Data inválida", variant: "destructive" }); return; }
    if (!editCheckIn) { toast({ title: "Entrada obrigatória", variant: "destructive" }); return; }
    try {
      // As horas são interpretadas na hora local do dispositivo (Europe/Lisbon no
      // tablet) e convertidas para o instante UTC correto. A exibição usa
      // format(new Date(iso)), reconvertendo para a hora local — round-trip sem desvio.
      const payload = {
        date: editDate,
        checkInAt: editCheckIn ? new Date(editDate + "T" + editCheckIn + ":00").toISOString() : null,
        checkOutAt: editCheckOut ? new Date(editDate + "T" + editCheckOut + ":00").toISOString() : null,
      };
      const url =
        editingShift.mode === "create"
          ? import.meta.env.VITE_API_URL + "/api/attendance/shift"
          : import.meta.env.VITE_API_URL + "/api/attendance/shift/" + editingShift.id;
      const res = await fetch(url, {
        method: editingShift.mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editingShift.mode === "create" ? { workerId: worker.id, ...payload } : payload,
        ),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({ title: body.error ?? "Erro ao guardar", variant: "destructive" });
        return;
      }
      await queryClient.invalidateQueries();
      toast({ title: editingShift.mode === "create" ? "Turno adicionado" : "Turno atualizado" });
      setEditingShift(null);
    } catch {
      toast({ title: "Erro ao guardar", variant: "destructive" });
    }
  };

  const handleDeleteShift = async (id: number) => {
    if (!window.confirm("Apagar este turno?")) return;
    try {
      await fetch(import.meta.env.VITE_API_URL + "/api/attendance/shift/" + id, { method: "DELETE" });
      await queryClient.invalidateQueries();
      toast({ title: "Turno apagado" });
    } catch {
      toast({ title: "Erro ao apagar", variant: "destructive" });
    }
  };

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


  if (editingShift) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-card w-full max-w-sm rounded-2xl shadow-2xl p-6 space-y-4">
        <h2 className="text-lg font-bold">{editingShift.mode === "create" ? "Adicionar Turno" : "Editar Turno"}</h2>
        <div>
          <label className="text-sm font-medium text-muted-foreground">Dia</label>
          <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
            className="w-full mt-1 border border-border rounded-lg px-4 py-2 font-mono focus:outline-none focus:border-primary" />
        </div>
        <div>
          <label className="text-sm font-medium text-muted-foreground">Entrada</label>
          <input type="time" value={editCheckIn} onChange={e => setEditCheckIn(e.target.value)}
            className="w-full mt-1 border border-border rounded-lg px-4 py-2 font-mono focus:outline-none focus:border-primary" />
        </div>
        <div>
          <label className="text-sm font-medium text-muted-foreground">Saída</label>
          <input type="time" value={editCheckOut} onChange={e => setEditCheckOut(e.target.value)}
            className="w-full mt-1 border border-border rounded-lg px-4 py-2 font-mono focus:outline-none focus:border-primary" />
        </div>
        <div className="flex gap-3">
          <button onClick={() => setEditingShift(null)} className="flex-1 py-2 rounded-lg border border-border font-bold hover:bg-muted/50">Cancelar</button>
          <button onClick={handleEditSave} className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground font-bold hover:opacity-90">Guardar</button>
        </div>
      </div>
    </div>
  );

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
              <button
                onClick={() => handleAddShift(to)}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary font-bold rounded-xl hover:bg-primary/20"
              >
                <Plus className="w-4 h-4" /> Adicionar turno
              </button>
            </div>
          ) : (
            <table className="w-full text-left">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="p-3 font-bold text-xs uppercase tracking-wider text-muted-foreground">Data</th>
                  <th className="p-3 font-bold text-xs uppercase tracking-wider text-muted-foreground text-center">Entrada</th>
                  <th className="p-3 font-bold text-xs uppercase tracking-wider text-muted-foreground text-center">Saída</th>
                  <th className="p-3 font-bold text-xs uppercase tracking-wider text-muted-foreground text-right">Horas</th>
                  <th className="p-3 font-bold text-xs uppercase tracking-wider text-amber-700 dark:text-amber-400 text-center" title="Ocorrências de qualidade">
                    <AlertTriangle className="w-3.5 h-3.5 inline" /> Ocor.
                  </th>
                  <th className="p-3 font-bold text-xs uppercase tracking-wider text-primary text-right">Valor (€)</th>
                  <th className="p-3 font-bold text-xs uppercase tracking-wider text-muted-foreground text-center">Ações</th>
                </tr>
              </thead>
              <tbody>
                {ts.days.map(d => {
                  // Cada dia pode ter vários turnos. A Data e as Ocorrências
                  // (que são por dia) ocupam todas as linhas via rowSpan; cada
                  // turno tem a sua própria linha de entrada/saída/horas/valor.
                  const shifts = d.shifts ?? [];
                  const rows = Math.max(shifts.length, 1);
                  return shifts.map((s, idx) => (
                    <tr key={s.id} className="border-b border-border/50 hover:bg-muted/20" data-testid={`timesheet-row-${s.id}`}>
                      {idx === 0 && (
                        <td className="p-3 font-medium text-foreground align-top" rowSpan={rows}>
                          <div>{fmtDate(d.date)}</div>
                          {rows > 1 && (
                            <div className="text-xs text-muted-foreground mt-1">{rows} turnos · {fmtHours(d.hoursWorked)}</div>
                          )}
                          <button
                            onClick={() => handleAddShift(d.date)}
                            className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
                            title="Adicionar turno neste dia"
                          >
                            <Plus className="w-3 h-3" /> turno
                          </button>
                        </td>
                      )}
                      <td className="p-3 text-center font-mono text-foreground">{fmtTime(s.checkInAt)}</td>
                      <td className="p-3 text-center font-mono text-foreground">{fmtTime(s.checkOutAt)}</td>
                      <td className="p-3 text-right font-bold text-foreground">{fmtHours(s.hoursWorked)}</td>
                      {idx === 0 && (
                        <td className="p-3 text-center align-top" rowSpan={rows}>
                          {d.totalIssues > 0 ? (
                            <div className="inline-flex items-center gap-1" title={
                              QUALITY_ISSUES
                                .filter(k => (d.issuesByType?.[k] ?? 0) > 0)
                                .map(k => `${QUALITY_LABELS[k]}: ${d.issuesByType[k]}`)
                                .join(" · ")
                            }>
                              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                {d.totalIssues}
                              </span>
                              <span className="hidden sm:inline-flex gap-0.5">
                                {QUALITY_ISSUES.map(k => {
                                  const n = d.issuesByType?.[k] ?? 0;
                                  if (!n) return null;
                                  return (
                                    <span
                                      key={k}
                                      className={`text-[9px] font-bold px-1 py-0.5 rounded border ${QUALITY_CHIP_CLASS[k]}`}
                                    >
                                      {QUALITY_SHORT[k]}
                                    </span>
                                  );
                                })}
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                      )}
                      <td className="p-3 text-right">
                        {s.pay !== null && s.pay !== undefined ? (
                          <span className="bg-success/10 text-success px-2.5 py-1 rounded-lg font-bold">
                            {s.pay.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => handleEditShift(d.date, s)} className="p-1.5 rounded-lg hover:bg-primary/10 text-primary transition-colors" title="Editar turno">
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleDeleteShift(s.id)} className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive transition-colors" title="Apagar turno">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ));
                })}
              </tbody>
              {ts.days.length > 0 && (
                <tfoot className="bg-muted/40 border-t-2 border-border sticky bottom-0">
                  <tr>
                    <td className="p-3 font-display font-bold uppercase text-foreground" colSpan={3}>Total</td>
                    <td className="p-3 text-right font-display font-black text-foreground text-lg">{ts.totalHours.toFixed(2)} h</td>
                    <td className="p-3 text-center font-display font-black text-amber-700 dark:text-amber-400 text-lg">
                      {ts.days.reduce((acc, d) => acc + (d.totalIssues ?? 0), 0)}
                    </td>
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

