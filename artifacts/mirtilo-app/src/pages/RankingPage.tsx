import { useMemo, useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import { useGetDailyReport, useListWeighRecords, useUpdateWeighRecord, useDeleteWeighRecord } from "@workspace/api-client-react";
import { Trophy, Download, Calendar as CalendarIcon, Medal, Filter, ListOrdered, Clock, AlertTriangle, Pencil, Trash2, Camera, FileText, Eye, EyeOff, X } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { QUALITY_ISSUES, QUALITY_LABELS, QUALITY_SHORT, QUALITY_CHIP_CLASS, type QualityIssue } from "@/lib/quality-issues";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";

type SortKey = "kg" | "kgPorHora" | "caixas" | "horas";
type Tab = "ranking" | "weighings";

function fmtHours(h: number | null | undefined) {
  if (h === null || h === undefined) return "—";
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh}h${String(mm).padStart(2, "0")}`;
}

export default function RankingPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dateFrom, setDateFrom] = useState(format(new Date(), "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState(format(new Date(), "yyyy-MM-dd"));
  
  const [sortKey, setSortKey] = useState<SortKey>("kg");
  const [onlyWithHours, setOnlyWithHours] = useState(false);
  const [tab, setTab] = useState<Tab>("ranking");
  const [hourFrom, setHourFrom] = useState("00:00");
  const [hourTo, setHourTo] = useState("23:59");
  const [workerFilter, setWorkerFilter] = useState("");
  const [editingRecord, setEditingRecord] = useState<{ id: number; weightGrams: number; timestamp: string } | null>(null);
  const [editWeight, setEditWeight] = useState("");
  const [editTimestamp, setEditTimestamp] = useState("");

  const updateRecord = useUpdateWeighRecord();
  const deleteRecord = useDeleteWeighRecord();

  const [report, setReport] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [period, setPeriod] = useState("all");

  useEffect(() => {
    setIsLoading(true);
    fetch(import.meta.env.VITE_API_URL + "/api/reports/range?from=" + dateFrom + "&to=" + dateTo + (period === 'morning' ? '&fromHour=00&toHour=13' : period === 'afternoon' ? '&fromHour=14&toHour=23' : ''))
      .then(r => r.json())
      .then(data => { setReport(data); setIsLoading(false); })
      .catch(() => setIsLoading(false));
  }, [dateFrom, dateTo, period]);
  const { data: allRecords = [], isLoading: recordsLoading } = useListWeighRecords({ date: dateFrom }, { query: { keepPreviousData: true } as any });

  const hourRangeInverted = useMemo(() => {
    const [fh, fm] = hourFrom.split(":").map(Number);
    const [th, tm] = hourTo.split(":").map(Number);
    return ((fh ?? 0) * 60 + (fm ?? 0)) > ((th ?? 23) * 60 + (tm ?? 59));
  }, [hourFrom, hourTo]);

  const filteredRecords = useMemo(() => {
    const [fh, fm] = hourFrom.split(":").map(Number);
    const [th, tm] = hourTo.split(":").map(Number);
    const fromRaw = (fh ?? 0) * 60 + (fm ?? 0);
    const toRaw = (th ?? 23) * 60 + (tm ?? 59);
    const fromMin = Math.min(fromRaw, toRaw);
    const toMin = Math.max(fromRaw, toRaw);
    const wf = workerFilter.trim().toLowerCase();
    return allRecords.filter(r => {
      const d = new Date(r.timestamp);
      const min = d.getHours() * 60 + d.getMinutes();
      if (min < fromMin || min > toMin) return false;
      if (wf && !r.workerId.toLowerCase().includes(wf) && !r.workerName.toLowerCase().includes(wf)) return false;
      return true;
    });
  }, [allRecords, hourFrom, hourTo, workerFilter]);

  const filteredTotalKg = useMemo(() => filteredRecords.reduce((acc, r) => acc + r.weightGrams, 0) / 1000, [filteredRecords]);

  const sortedWorkers = useMemo(() => {
    if (!report?.workers) return [];
    const filtered = onlyWithHours ? report.workers.filter((w: any) => w.hoursWorked !== null && w.hoursWorked > 0) : report.workers;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "kgPorHora": return ((b.kgPorHora ?? b.totalKg) ?? -1) - ((a.kgPorHora ?? a.totalKg) ?? -1);
        case "caixas": return b.totalCaixas - a.totalCaixas;
        case "horas": return (b.hoursWorked ?? -1) - (a.hoursWorked ?? -1);
        default: return b.totalKg - a.totalKg;
      }
    });
  }, [report, sortKey, onlyWithHours]);

  const teamHours = useMemo(() => (report?.workers ?? []).reduce((acc: number, w: any) => acc + (w.hoursWorked ?? 0), 0), [report]);
  const teamKgPorHora = teamHours > 0 ? (report?.totalKg ?? 0) / teamHours : null;

  const handleExport = () => { window.location.href = `/api/reports/export?date=${dateFrom}`; };

  const [showExportModal, setShowExportModal] = useState(false);
  const [showNames, setShowNames] = useState(true);

  const buildCaptureElement = (): HTMLDivElement => {
    const dateLabel = dateFrom === dateTo
      ? format(new Date(dateFrom), "dd/MM/yyyy")
      : `${format(new Date(dateFrom), "dd/MM/yyyy")} \u2014 ${format(new Date(dateTo), "dd/MM/yyyy")}`;
    const periodLabel = period === "morning" ? "Manh\u00e3 (00-13h)" : period === "afternoon" ? "Tarde (14-23h)" : "";

    const el = document.createElement("div");
    el.style.width = "960px";
    el.style.padding = "24px";
    el.style.background = "#ffffff";
    el.style.fontFamily = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';

    const mk = (tag: string, styles: Partial<CSSStyleDeclaration> = {}, text?: string): HTMLElement => {
      const node = document.createElement(tag);
      Object.assign(node.style, styles);
      if (text !== undefined) node.textContent = text;
      return node;
    };

    const header = mk("div", { textAlign: "center", marginBottom: "24px" });
    const h3 = mk("h3", { margin: "0 0 4px", fontSize: "28px", fontWeight: "900", color: "#2563eb" }, "MirtiloTrack");
    const p1 = mk("p", { margin: "0", fontSize: "14px", color: "#6b7280" }, "Ranking de Produtividade");
    const p2 = mk("p", { margin: "4px 0 0", fontSize: "12px", color: "#6b7280" }, dateLabel);
    header.appendChild(h3);
    header.appendChild(p1);
    header.appendChild(p2);
    if (periodLabel) {
      const p3 = mk("p", { margin: "4px 0 0", fontSize: "12px", fontWeight: "700", color: "#2563eb" }, periodLabel);
      header.appendChild(p3);
    }
    el.appendChild(header);

    const stats = mk("div", { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "12px", marginBottom: "24px" });
    const mkStat = (label: string, value: string) => {
      const box = mk("div", { textAlign: "center", padding: "12px", background: "#eff6ff", borderRadius: "8px" });
      const lbl = mk("p", { margin: "0 0 4px", fontSize: "11px", fontWeight: "700", color: "#6b7280", textTransform: "uppercase" }, label);
      const val = mk("p", { margin: "0", fontSize: "20px", fontWeight: "900", color: "#2563eb" }, value);
      box.appendChild(lbl);
      box.appendChild(val);
      return box;
    };
    stats.appendChild(mkStat("Total", `${(report?.totalKg ?? 0).toFixed(1)} kg`));
    stats.appendChild(mkStat("Caixas", String(report?.totalRecords ?? 0)));
    stats.appendChild(mkStat("Equipa", String(report?.workers?.length ?? 0)));
    el.appendChild(stats);

    const grid = mk("div", { display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "14px" });
    sortedWorkers.forEach((w: any, i: number) => {
      const isMedal = i < 3;
      const bg = "#ffffff";
      const border = "#e5e7eb";
      const rankColor = i === 0 ? "#eab308" : i === 1 ? "#94a3b8" : i === 2 ? "#b45309" : "#6b7280";
      const medalEmoji = i === 0 ? "\uD83E\uDD47" : i === 1 ? "\uD83E\uDD48" : i === 2 ? "\uD83E\uDD49" : "";

      const card = mk("div", { display: "flex", alignItems: "center", gap: "12px", padding: "14px", borderRadius: "10px", background: bg, border: `2px solid ${border}` });

      // Rank badge — medal for top 3, circle for others
      const rankWrapper = mk("div", { width: "44px", height: "44px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: "0" });
      if (isMedal) {
        const medalCircle = mk("div", { width: "44px", height: "44px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: rankColor, fontSize: "24px", lineHeight: "1" }, medalEmoji);
        rankWrapper.appendChild(medalCircle);
      } else {
        const numCircle = mk("div", { width: "36px", height: "36px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: "#f3f4f6", border: "2px solid #e5e7eb", fontWeight: "900", fontSize: "16px", color: "#6b7280" }, String(i + 1));
        rankWrapper.appendChild(numCircle);
      }
      card.appendChild(rankWrapper);

      const info = mk("div", { flex: "1", minWidth: "0" });
      if (showNames) {
        const nameP = mk("p", { margin: "0", fontWeight: "800", fontSize: "15px", color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, w.workerName);
        const idP = mk("p", { margin: "3px 0 0", fontSize: "12px", color: "#6b7280", fontFamily: "monospace", fontWeight: "600" }, w.workerId);
        info.appendChild(nameP);
        info.appendChild(idP);
      } else {
        const anonP = mk("p", { margin: "0", fontWeight: "800", fontSize: "15px", color: "#111827" }, w.workerId);
        info.appendChild(anonP);
      }
      if (w.totalIssues > 0) {
        const badge = mk("span", { display: "inline-block", marginTop: "4px", fontSize: "10px", fontWeight: "800", padding: "2px 8px", borderRadius: "999px", background: "#fef3c7", color: "#92400e" }, `${w.totalIssues} ocor.`);
        info.appendChild(badge);
      }
      card.appendChild(info);

      const right = mk("div", { textAlign: "right", flexShrink: "0" });
      const kgP = mk("p", { margin: "0", fontWeight: "900", fontSize: "22px", color: "#2563eb" });
      kgP.textContent = `${(w.totalKg ?? 0).toFixed(2)} `;
      const kgSpan = mk("span", { fontSize: "13px", fontWeight: "600", color: "#6b7280" }, "kg");
      kgP.appendChild(kgSpan);
      right.appendChild(kgP);
      const cxMeta = mk("p", { margin: "3px 0 0", fontSize: "12px", color: "#6b7280", fontWeight: "600" }, `${w.totalCaixas} cx`);
      right.appendChild(cxMeta);

      const kgh = w.kgPorHora ?? 0;
      const kghBadge = mk("span", { display: "inline-block", marginTop: "4px", fontSize: "12px", fontWeight: "900", padding: "3px 10px", borderRadius: "6px", background: "#1e3a8a", color: "#ffffff" }, `${kgh.toFixed(2)} kg/h`);
      right.appendChild(kghBadge);
      card.appendChild(right);

      grid.appendChild(card);
    });
    el.appendChild(grid);

    const footer = mk("div", { marginTop: "24px", paddingTop: "16px", borderTop: "1px solid #e5e7eb", textAlign: "center" });
    footer.appendChild(mk("p", { margin: "0", fontSize: "11px", color: "#6b7280" }, "MirtiloTrack \u2014 Sistema de Gest\u00e3o de Colheita"));
    el.appendChild(footer);

    return el;
  };

  const handleExportImage = async () => {
    let container: HTMLDivElement | null = null;
    try {
      container = document.createElement("div");
      container.style.position = "fixed";
      container.style.top = "0";
      container.style.left = "0";
      container.style.zIndex = "-9999";
      container.style.pointerEvents = "none";
      container.style.opacity = "0";
      document.body.appendChild(container);

      const content = buildCaptureElement();
      container.appendChild(content);

      // Aguarda renderização
      await new Promise(resolve => setTimeout(resolve, 100));

      console.log("[Export] Elemento pronto, capturando...", content.offsetWidth, content.offsetHeight);
      const dataUrl = await toPng(content, {
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      });
      console.log("[Export] toPng OK, dataUrl length:", dataUrl.length);
      const link = document.createElement("a");
      link.download = `ranking-${dateFrom}${dateFrom !== dateTo ? `-${dateTo}` : ""}.png`;
      link.href = dataUrl;
      link.click();
      toast({ title: "Imagem exportada!" });
    } catch (err) {
      console.error("[Export] Erro ao exportar imagem:", err);
      toast({ title: "Erro ao exportar imagem", variant: "destructive" });
    } finally {
      if (container && container.parentNode) {
        document.body.removeChild(container);
      }
    }
  };

  const handleExportPDF = async () => {
    let container: HTMLDivElement | null = null;
    try {
      container = document.createElement("div");
      container.style.position = "fixed";
      container.style.top = "0";
      container.style.left = "0";
      container.style.zIndex = "-9999";
      container.style.pointerEvents = "none";
      container.style.opacity = "0";
      document.body.appendChild(container);

      const content = buildCaptureElement();
      container.appendChild(content);

      await new Promise(resolve => setTimeout(resolve, 100));

      const dataUrl = await toPng(content, {
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      });
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const img = new Image();
      img.onload = () => {
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const imgWidth = img.width;
        const imgHeight = img.height;
        const ratio = Math.min(pageWidth / imgWidth, pageHeight / imgHeight) * 0.95;
        const finalWidth = imgWidth * ratio;
        const finalHeight = imgHeight * ratio;
        const x = (pageWidth - finalWidth) / 2;
        const y = (pageHeight - finalHeight) / 2;
        pdf.addImage(dataUrl, "PNG", x, y, finalWidth, finalHeight);
        pdf.save(`ranking-${dateFrom}${dateFrom !== dateTo ? `-${dateTo}` : ""}.pdf`);
        toast({ title: "PDF exportado!" });
      };
      img.onerror = () => {
        toast({ title: "Erro ao gerar PDF", variant: "destructive" });
      };
      img.src = dataUrl;
    } catch (err) {
      console.error("Erro ao exportar PDF:", err);
      toast({ title: "Erro ao exportar PDF", variant: "destructive" });
    } finally {
      if (container && container.parentNode) {
        document.body.removeChild(container);
      }
    }
  };

  const handleEdit = (id: number, weightGrams: number, timestamp: string) => {
    setEditingRecord({ id, weightGrams, timestamp });
    setEditWeight(String(weightGrams));
    setEditTimestamp(format(new Date(timestamp), "yyyy-MM-dd'T'HH:mm"));
  };

  const handleEditSave = async () => {
    if (!editingRecord) return;
    const newWeight = parseInt(editWeight, 10);
    if (isNaN(newWeight) || newWeight <= 0) { toast({ title: "Peso inválido", variant: "destructive" }); return; }
    try {
      const updateData: any = { weightGrams: newWeight };
      if (editTimestamp) { updateData.timestamp = new Date(editTimestamp).toISOString(); }
      await updateRecord.mutateAsync({ id: editingRecord.id, data: updateData });
      await queryClient.invalidateQueries();
      toast({ title: "Pesagem atualizada" });
      setEditingRecord(null);
    } catch { toast({ title: "Erro ao atualizar", variant: "destructive" }); }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("Apagar esta pesagem?")) return;
    try {
      await deleteRecord.mutateAsync({ id });
      await queryClient.invalidateQueries();
      toast({ title: "Pesagem apagada" });
    } catch { toast({ title: "Erro ao apagar", variant: "destructive" }); }
  };

  return (
    <Layout>
      {editingRecord && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl p-6 w-full max-w-sm shadow-xl space-y-4">
            <h2 className="text-lg font-bold">Editar Pesagem</h2>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Peso (gramas)</label>
              <input type="number" value={editWeight} onChange={e => setEditWeight(e.target.value)}
                className="w-full mt-1 border border-border rounded-lg px-4 py-2 text-lg font-mono focus:outline-none focus:border-primary" autoFocus />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Data e Hora</label>
              <input type="datetime-local" value={editTimestamp} onChange={e => setEditTimestamp(e.target.value)}
                className="w-full mt-1 border border-border rounded-lg px-4 py-2 font-mono focus:outline-none focus:border-primary" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setEditingRecord(null)} className="flex-1 py-2 rounded-lg border border-border font-bold hover:bg-muted/50">Cancelar</button>
              <button onClick={handleEditSave} disabled={updateRecord.isPending} className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground font-bold hover:opacity-90 disabled:opacity-50">
                {updateRecord.isPending ? "A guardar…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-card p-6 rounded-2xl border border-border shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-primary/10 text-primary rounded-xl"><Trophy className="w-6 h-6" /></div>
            <div><h1 className="text-2xl font-display font-bold">Ranking Diário</h1><p className="text-muted-foreground text-sm">Produtividade da colheita</p></div>
          </div>
          <div className="flex gap-2 w-full sm:w-auto flex-wrap">
            <div className="relative">
              <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none"><CalendarIcon className="w-4 h-4 text-muted-foreground" /></div>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="bg-background border border-border rounded-xl pl-10 pr-4 py-2 font-medium text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
            </div>
            <div className="relative">
              <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none"><CalendarIcon className="w-4 h-4 text-muted-foreground" /></div>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="bg-background border border-border rounded-xl pl-10 pr-4 py-2 font-medium text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
            </div>
            <button onClick={handleExport} className="flex items-center justify-center gap-2 bg-secondary text-secondary-foreground px-4 py-2 rounded-xl font-bold hover:bg-secondary/80 transition-colors">
              <Download className="w-4 h-4" /><span className="hidden sm:inline">CSV</span>
            </button>
            <button onClick={() => setShowExportModal(true)} disabled={isLoading || !sortedWorkers.length} className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-xl font-bold hover:bg-primary/90 transition-colors shadow-md disabled:opacity-50 disabled:cursor-not-allowed">
              <Camera className="w-4 h-4" /><span className="hidden sm:inline">Partilhar</span>
            </button>
          </div>
            <div className="flex gap-2 flex-wrap mt-1">
              <button onClick={() => { const t = format(new Date(), "yyyy-MM-dd"); setDateFrom(t); setDateTo(t); }} className="px-3 py-1 text-xs font-bold bg-primary/10 text-primary rounded-lg hover:bg-primary/20">Hoje</button>
              <button onClick={() => { const t = format(new Date(Date.now() - 86400000), "yyyy-MM-dd"); setDateFrom(t); setDateTo(t); }} className="px-3 py-1 text-xs font-bold bg-muted text-muted-foreground rounded-lg hover:bg-muted/70">Ontem</button>
              <button onClick={() => { setDateFrom(format(new Date(Date.now() - 6*86400000), "yyyy-MM-dd")); setDateTo(format(new Date(), "yyyy-MM-dd")); }} className="px-3 py-1 text-xs font-bold bg-muted text-muted-foreground rounded-lg hover:bg-muted/70">7 dias</button>
              <button onClick={() => { setDateFrom(format(new Date(Date.now() - 29*86400000), "yyyy-MM-dd")); setDateTo(format(new Date(), "yyyy-MM-dd")); }} className="px-3 py-1 text-xs font-bold bg-muted text-muted-foreground rounded-lg hover:bg-muted/70">30 dias</button>
            </div>
            <div className="flex gap-2 flex-wrap mt-1">
              <span className="text-xs font-bold text-muted-foreground self-center">Período:</span>
              <button onClick={() => setPeriod("all")} className={"px-3 py-1 text-xs font-bold rounded-lg " + (period === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70")}>Dia todo</button>
              <button onClick={() => setPeriod("morning")} className={"px-3 py-1 text-xs font-bold rounded-lg " + (period === "morning" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70")}>Manhã (00-13h)</button>
              <button onClick={() => setPeriod("afternoon")} className={"px-3 py-1 text-xs font-bold rounded-lg " + (period === "afternoon" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70")}>Tarde (14-23h)</button>
            </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          <StatCard label="Total Colhido" value={`${(report?.totalKg ?? 0).toFixed(1) || 0} kg`} />
          <StatCard label="Total Caixas" value={report?.totalRecords.toString() || "0"} />
          <StatCard label="Trabalhadores" value={report?.workers.length.toString() || "0"} />
          <StatCard label="Custo equipa" value={`${(teamHours * 7.5).toFixed(2)} €`} />
          <StatCard label="Kg / hora (equipa)" value={teamKgPorHora !== null ? `${(teamKgPorHora ?? 0).toFixed(2)} kg/h` : "—"} highlight />
        </div>

        <div className="bg-card border border-border rounded-2xl p-1 flex gap-1">
          <button onClick={() => setTab("ranking")} className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-bold text-sm transition-colors ${tab === "ranking" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:bg-muted/50"}`}>
            <Trophy className="w-4 h-4" /> Ranking por trabalhador
          </button>
          <button onClick={() => setTab("weighings")} className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-bold text-sm transition-colors ${tab === "weighings" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:bg-muted/50"}`}>
            <ListOrdered className="w-4 h-4" /> Pesagens do dia
          </button>

        </div>

        {tab === "ranking" && (
          <>
            <div className="bg-card border border-border rounded-2xl p-4 flex flex-col md:flex-row md:items-center gap-3">
              <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground uppercase tracking-wider"><Filter className="w-4 h-4" /> Ordenar por</div>
              <div className="flex flex-wrap gap-2">
                {([{ k: "kg" as SortKey, label: "Total kg" }, { k: "kgPorHora" as SortKey, label: "Kg / hora" }, { k: "caixas" as SortKey, label: "Caixas" }]).map(({ k, label }) => (
                  <button key={k} onClick={() => setSortKey(k)} className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-colors ${sortKey === k ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}>{label}</button>
                ))}
              </div>
            </div>
            <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
              {isLoading ? <div className="p-12 flex justify-center"><div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div></div>
              : !sortedWorkers.length ? <div className="p-12 text-center text-muted-foreground"><Trophy className="w-12 h-12 mx-auto mb-3 opacity-20" /><p>Sem dados para este dia/filtro.</p></div>
              : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border">
                        <th className="p-4 font-bold text-xs uppercase tracking-wider text-muted-foreground w-16 text-center">Rank</th>
                        <th className="p-4 font-bold text-xs uppercase tracking-wider text-muted-foreground">Trabalhador</th>
                        <th className="p-4 font-bold text-xs uppercase tracking-wider text-muted-foreground text-right">Caixas</th>
                        <th className="p-4 font-bold text-xs uppercase tracking-wider text-muted-foreground text-right">Total (kg)</th>
                        <th className="p-4 font-bold text-xs uppercase tracking-wider text-primary text-right">Kg / h</th>
                        <th className="p-4 font-bold text-xs uppercase tracking-wider text-muted-foreground text-right hidden sm:table-cell">Méd/Cx</th>
                        <th className="p-4 font-bold text-xs uppercase tracking-wider text-muted-foreground text-right hidden md:table-cell">Cx/h</th>
                        <th className="p-4 font-bold text-xs uppercase tracking-wider text-amber-700 text-center hidden sm:table-cell"><AlertTriangle className="w-3.5 h-3.5 inline" /> Ocor.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedWorkers.map((w, i) => (
                        <tr key={w.workerId} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                          <td className="p-4 text-center">
                            {i === 0 ? <Medal className="w-6 h-6 text-yellow-500 mx-auto" /> : i === 1 ? <Medal className="w-6 h-6 text-slate-400 mx-auto" /> : i === 2 ? <Medal className="w-6 h-6 text-amber-700 mx-auto" /> : <span className="font-bold text-muted-foreground">{i + 1}</span>}
                          </td>
                          <td className="p-4"><p className="font-bold">{w.workerName}</p><p className="text-xs text-muted-foreground font-mono">{w.workerId}</p></td>
                          <td className="p-4 text-right font-medium">{w.totalCaixas}</td>
                          <td className="p-4 text-right"><span className="bg-primary/10 text-primary px-3 py-1 rounded-lg font-bold text-lg">{(w.totalKg ?? 0).toFixed(2)}</span></td>
                          <td className="p-4 text-right">{w.kgPorHora !== null ? <span className="bg-success/10 text-success px-2.5 py-1 rounded-lg font-bold">{(w.kgPorHora ?? 0).toFixed(2)}</span> : <span className="text-muted-foreground">—</span>}</td>
                          <td className="p-4 text-right text-muted-foreground hidden sm:table-cell">{(w.mediaGrPorCaixa ?? 0).toFixed(0)}g</td>
                          <td className="p-4 text-right text-muted-foreground hidden md:table-cell">{(w.caixasPorHora ?? 0).toFixed(1)}</td>
                          <td className="p-4 text-center hidden sm:table-cell">
                            {w.totalIssues > 0 ? <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">{w.totalIssues}</span> : <span className="text-muted-foreground text-xs">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {tab === "weighings" && (
          <>
            <div className="bg-card border border-border rounded-2xl p-4 flex flex-col md:flex-row md:items-end gap-4">
              <div className="flex items-end gap-2">
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-1.5"><Clock className="w-3.5 h-3.5" /> Desde</span>
                  <input type="time" value={hourFrom} onChange={(e) => setHourFrom(e.target.value)} className="bg-background border border-border rounded-lg px-3 py-2 font-mono text-sm focus:outline-none focus:border-primary" />
                </label>
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-1.5"><Clock className="w-3.5 h-3.5" /> Até</span>
                  <input type="time" value={hourTo} onChange={(e) => setHourTo(e.target.value)} className="bg-background border border-border rounded-lg px-3 py-2 font-mono text-sm focus:outline-none focus:border-primary" />
                </label>
              </div>
              <label className="block flex-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-1.5"><Filter className="w-3.5 h-3.5" /> Filtrar trabalhador</span>
                <input type="text" value={workerFilter} onChange={(e) => setWorkerFilter(e.target.value)} placeholder="ID ou nome…" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary" />
              </label>
              <div className="md:ml-auto text-right shrink-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">No filtro</p>
                <p className="text-2xl font-display font-bold text-primary">{filteredRecords.length} <span className="text-sm font-medium text-muted-foreground">caixas · </span>{(filteredTotalKg ?? 0).toFixed(2)} <span className="text-sm font-medium text-muted-foreground">kg</span></p>
              </div>
            </div>
            {hourRangeInverted && <div className="bg-amber-50 border border-amber-300/60 text-amber-800 rounded-xl px-4 py-2 text-sm">Intervalo invertido — a mostrar entre {hourTo} e {hourFrom}.</div>}
            <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
              {recordsLoading ? <div className="p-12 flex justify-center"><div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div></div>
              : !filteredRecords.length ? <div className="p-12 text-center text-muted-foreground"><ListOrdered className="w-12 h-12 mx-auto mb-3 opacity-20" /><p>Sem pesagens no intervalo.</p></div>
              : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border">
                        <th className="p-3 font-bold text-xs uppercase tracking-wider text-muted-foreground">Hora</th>
                        <th className="p-3 font-bold text-xs uppercase tracking-wider text-muted-foreground">Trabalhador</th>
                        <th className="p-3 font-bold text-xs uppercase tracking-wider text-muted-foreground text-right">Peso</th>
                        <th className="p-3 font-bold text-xs uppercase tracking-wider text-muted-foreground hidden sm:table-cell">Origem</th>
                        <th className="p-3 font-bold text-xs uppercase tracking-wider text-muted-foreground text-center">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRecords.map((r) => {
                        const wasEdited = !!r.editedAt;
                        return (
                          <tr key={r.id} className={`border-b border-border/50 transition-colors ${wasEdited ? "bg-amber-50/60 hover:bg-amber-100/60" : "hover:bg-muted/20"}`}>
                            <td className="p-3 font-mono text-sm">{format(new Date(r.timestamp), "HH:mm:ss")}</td>
                            <td className="p-3"><p className="font-bold text-sm">{r.workerName}</p><p className="text-xs text-muted-foreground font-mono">{r.workerId}</p></td>
                            <td className="p-3 text-right">
                              <span className="font-mono font-bold text-lg">{r.weightGrams}</span>
                              <span className="text-muted-foreground text-xs ml-1">g</span>
                              {wasEdited && <span className="ml-2 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full text-amber-800 bg-amber-100">✎ editado</span>}
                              {r.qualityIssues && r.qualityIssues.length > 0 && (
                                <div className="inline-flex flex-wrap gap-0.5 ml-2 align-middle">
                                  {r.qualityIssues.map(issue => {
                                    if (!(QUALITY_ISSUES as readonly string[]).includes(issue)) return null;
                                    const k = issue as QualityIssue;
                                    return <span key={k} title={QUALITY_LABELS[k]} className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${QUALITY_CHIP_CLASS[k]}`}>{QUALITY_SHORT[k]}</span>;
                                  })}
                                </div>
                              )}
                            </td>
                            <td className="p-3 hidden sm:table-cell">
                              <span className={`text-xs font-bold px-2 py-1 rounded-full ${r.scaleId?.includes("MANUAL") ? "text-orange-700 bg-orange-100" : "text-green-700 bg-green-100"}`}>
                                {r.scaleId?.includes("MANUAL") ? "✍ manual" : "⚖ balança"}
                              </span>
                            </td>
                            <td className="p-3 text-center">
                              <div className="flex items-center justify-center gap-2">
                                <button onClick={() => handleEdit(r.id, r.weightGrams, r.timestamp)} className="p-1.5 rounded-lg hover:bg-primary/10 text-primary transition-colors" title="Editar"><Pencil className="w-4 h-4" /></button>
                                <button onClick={() => handleDelete(r.id)} className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive transition-colors" title="Apagar"><Trash2 className="w-4 h-4" /></button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

      </div>

      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md" onClick={() => setShowExportModal(false)}>
          <div className="bg-card w-full max-w-lg rounded-2xl shadow-2xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-primary/10 text-primary rounded-xl">
                  <Camera className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">Exportar Resultados</h2>
                  <p className="text-xs text-muted-foreground">{dateFrom === dateTo ? dateFrom : `${dateFrom} → ${dateTo}`}</p>
                </div>
              </div>
              <button onClick={() => setShowExportModal(false)} className="p-2 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Toggle names */}
            <div className="p-4 border-b border-border flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Mostrar nomes dos trabalhadores</span>
              <button
                onClick={() => setShowNames(v => !v)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors ${showNames ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
              >
                {showNames ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                {showNames ? "Visível" : "Anonimizado"}
              </button>
            </div>

            {/* Preview */}
            <div className="flex-1 overflow-auto p-4 bg-muted/30">
              <div className="bg-white rounded-xl p-6 shadow-sm">
                {/* Header do preview */}
                <div className="text-center mb-6">
                  <h3 className="text-2xl font-black text-primary mb-1">MirtiloTrack</h3>
                  <p className="text-sm text-muted-foreground">Ranking de Produtividade</p>
                  <p className="text-xs text-muted-foreground mt-1">{dateFrom === dateTo ? format(new Date(dateFrom), "dd/MM/yyyy") : `${format(new Date(dateFrom), "dd/MM/yyyy")} — ${format(new Date(dateTo), "dd/MM/yyyy")}`}</p>
                  {period !== "all" && (
                    <p className="text-xs text-primary font-bold mt-1">{period === "morning" ? "Manhã (00-13h)" : "Tarde (14-23h)"}</p>
                  )}
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-3 mb-6">
                  <div className="text-center p-3 bg-primary/5 rounded-lg">
                    <p className="text-xs text-muted-foreground font-bold uppercase">Total</p>
                    <p className="text-lg font-black text-primary">{(report?.totalKg ?? 0).toFixed(1)} kg</p>
                  </div>
                  <div className="text-center p-3 bg-primary/5 rounded-lg">
                    <p className="text-xs text-muted-foreground font-bold uppercase">Caixas</p>
                    <p className="text-lg font-black text-primary">{report?.totalRecords ?? 0}</p>
                  </div>
                  <div className="text-center p-3 bg-primary/5 rounded-lg">
                    <p className="text-xs text-muted-foreground font-bold uppercase">Equipa</p>
                    <p className="text-lg font-black text-primary">{report?.workers?.length ?? 0}</p>
                  </div>
                </div>

                {/* Ranking list — 2 columns to match export */}
                <div className="grid grid-cols-2 gap-3">
                  {sortedWorkers.map((w, i) => (
                    <div key={w.workerId} className="flex items-center gap-3 p-3 rounded-xl bg-white border-2 border-gray-200">
                      <div className="w-10 h-10 flex items-center justify-center shrink-0">
                        {i === 0 ? (
                          <div className="w-10 h-10 rounded-full bg-yellow-500 flex items-center justify-center text-white text-xl">
                            <Medal className="w-5 h-5" />
                          </div>
                        ) : i === 1 ? (
                          <div className="w-10 h-10 rounded-full bg-slate-400 flex items-center justify-center text-white text-xl">
                            <Medal className="w-5 h-5" />
                          </div>
                        ) : i === 2 ? (
                          <div className="w-10 h-10 rounded-full bg-amber-600 flex items-center justify-center text-white text-xl">
                            <Medal className="w-5 h-5" />
                          </div>
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-gray-100 border-2 border-gray-200 flex items-center justify-center text-gray-500 font-black text-sm">
                            {i + 1}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        {showNames ? (
                          <>
                            <p className="font-bold text-sm text-foreground truncate">{w.workerName}</p>
                            <p className="text-xs text-muted-foreground font-mono font-semibold">{w.workerId}</p>
                          </>
                        ) : (
                          <p className="font-bold text-sm text-foreground">{w.workerId}</p>
                        )}
                        {w.totalIssues > 0 && (
                          <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 mt-1">
                            {w.totalIssues} ocor.
                          </span>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-black text-primary text-lg">{(w.totalKg ?? 0).toFixed(2)} <span className="text-xs font-medium text-muted-foreground">kg</span></p>
                        <p className="text-xs text-muted-foreground font-medium">{w.totalCaixas} cx</p>
                        <span className="inline-block text-xs font-bold px-2 py-1 rounded-md bg-blue-900 text-white mt-1">
                          {(w.kgPorHora ?? 0).toFixed(2)} kg/h
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Footer */}
                <div className="mt-6 pt-4 border-t border-gray-100 text-center">
                  <p className="text-xs text-muted-foreground">MirtiloTrack — Sistema de Gestão de Colheita</p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="p-4 border-t border-border flex gap-3">
              <button onClick={() => setShowExportModal(false)} className="flex-1 py-3 bg-muted text-foreground font-bold rounded-xl hover:bg-muted/80">
                Cancelar
              </button>
              <button onClick={handleExportImage} className="flex-1 flex items-center justify-center gap-2 py-3 bg-primary text-primary-foreground font-bold rounded-xl shadow-lg shadow-primary/25 hover:shadow-primary/40">
                <Camera className="w-5 h-5" /> Imagem
              </button>
              <button onClick={handleExportPDF} className="flex-1 flex items-center justify-center gap-2 py-3 bg-secondary text-secondary-foreground font-bold rounded-xl hover:bg-secondary/80">
                <FileText className="w-5 h-5" /> PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

function StatCard({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`border rounded-2xl p-4 shadow-sm ${highlight ? "bg-primary/5 border-primary/30" : "bg-card border-border"}`}>
      <p className={`text-xs font-bold uppercase tracking-wider mb-1 ${highlight ? "text-primary/80" : "text-muted-foreground"}`}>{label}</p>
      <p className={`text-2xl font-display font-bold ${highlight ? "text-primary" : "text-foreground"}`}>{value}</p>
    </div>
  );
}