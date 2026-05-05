import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Layout } from "@/components/Layout";
import { useScale } from "@/hooks/use-scale";
import { useQRScanner } from "@/hooks/use-qr-scanner";
import { useBeep } from "@/hooks/use-beep";
import {
  useListWorkers,
  useCreateWeighRecord,
  useListWeighRecords,
  useListAttendance,
} from "@workspace/api-client-react";
import {
  X, User, Scale, AlertCircle, Trash2, CheckCircle2,
  Keyboard, Usb, ZapOff, ScanLine, LogIn,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

type WeightMode = "scale" | "manual";

const MIN_GRAMS = 50;
const MAX_GRAMS = 10000;
const SCALE_ID = "FFN-BAXTRAN-01";

export default function WeighingPage() {
  const { status: scaleStatus, reading, lastRaw, bytesReceived, lastByteAt } = useScale();
  const beep = useBeep();
  const { toast } = useToast();

  // ── Worker identification ──
  const [activeWorkerId, setActiveWorkerId] = useState<string | null>(null);
  const [manualIdInput, setManualIdInput] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const lastRecordTimeRef = useRef<number>(0);

  // ── Weight mode ──
  const [weightMode, setWeightMode] = useState<WeightMode>("scale");
  const [manualGrams, setManualGrams] = useState("");

  const { data: workers = [] } = useListWorkers();
  const { data: attendance = [] } = useListAttendance(undefined, {
    query: { refetchInterval: 30_000 },
  });

  const checkedInIds = useMemo(
    () => new Set(attendance.filter(a => a.checkInAt && !a.checkOutAt).map(a => a.workerId)),
    [attendance],
  );

  const activeWorker = workers.find(w => w.id === activeWorkerId);
  const activeWorkerCheckedIn = activeWorkerId ? checkedInIds.has(activeWorkerId) : false;

  const { data: todayRecords = [], refetch: refetchRecords } = useListWeighRecords(
    { workerId: activeWorkerId || undefined, limit: 10 },
    { query: { enabled: !!activeWorkerId } },
  );

  const createRecord = useCreateWeighRecord();

  // ── QR Scanner ──
  const startScannerRef = useRef<() => void>(() => {});

  const handleQRScan = useCallback((code: string) => {
    const worker = workers.find(w => w.id === code.trim().toUpperCase());
    if (worker) {
      beep("success");
      setActiveWorkerId(worker.id);
      setShowScanner(false);
      toast({ title: "Trabalhador Identificado", description: `${worker.name} (${worker.id})` });
    } else {
      beep("error");
      toast({
        title: "QR não reconhecido",
        description: `"${code}" não corresponde a nenhum trabalhador. A continuar a leitura…`,
        variant: "destructive",
      });
      setTimeout(() => startScannerRef.current(), 1500);
    }
  }, [workers, beep, toast]);

  const { videoRef: qrVideoRef, canvasRef: qrCanvasRef, isScanning, error: scannerError, startScanner, stopScanner } =
    useQRScanner(handleQRScan);

  useEffect(() => { startScannerRef.current = startScanner; }, [startScanner]);

  useEffect(() => {
    if (showScanner) {
      startScanner();
    } else {
      stopScanner();
    }
    return () => stopScanner();
  }, [showScanner]);

  // ── Manual ID submit ──
  const handleManualIdSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = manualIdInput.trim().toUpperCase();
    if (!id) return;
    const worker = workers.find(w => w.id === id);
    if (worker) {
      beep("success");
      setActiveWorkerId(worker.id);
      setManualIdInput("");
      toast({ title: "Trabalhador Identificado", description: `${worker.name} (${worker.id})` });
    } else {
      beep("error");
      toast({ title: "ID não encontrado", description: `"${id}" não existe.`, variant: "destructive" });
    }
  };

  // ── Weight resolution ──
  const getWeightToRegister = (): { grams: number; source: WeightMode } | null => {
    if (weightMode === "scale") {
      if (reading?.status === "STABLE" && reading.weightGrams >= MIN_GRAMS && reading.weightGrams <= MAX_GRAMS)
        return { grams: reading.weightGrams, source: "scale" };
      return null;
    }
    if (weightMode === "manual") {
      const g = parseInt(manualGrams, 10);
      if (!isNaN(g) && g >= MIN_GRAMS && g <= MAX_GRAMS) return { grams: g, source: "manual" };
      return null;
    }
    return null;
  };

  const handleWeigh = async () => {
    if (!activeWorkerId || isProcessing) return;
    if (!activeWorkerCheckedIn) {
      beep("error");
      toast({
        title: "Sem entrada para hoje",
        description: "Registe a entrada do trabalhador no separador Entradas/Saídas antes de pesar.",
        variant: "destructive",
      });
      return;
    }
    const weight = getWeightToRegister();
    if (!weight) return;

    const now = Date.now();
    if (now - lastRecordTimeRef.current < 15000) {
      if (!window.confirm("Pesagem muito rápida! Certeza que quer registar outra caixa?")) return;
    }

    setIsProcessing(true);
    try {
      const scaleId = weight.source === "scale" ? SCALE_ID : "MANUAL-MANUAL";
      const rawLine =
        weight.source === "scale" ? (reading?.rawLine ?? "") : `${scaleId}:${weight.grams}g`;

      await createRecord.mutateAsync({
        data: {
          workerId: activeWorkerId,
          weightGrams: weight.grams,
          unit: "g",
          scaleId,
          rawLine,
          timestamp: new Date().toISOString(),
        },
      });
      beep("success");
      lastRecordTimeRef.current = Date.now();
      await refetchRecords();

      // Reset workflow for the next worker / next box
      setManualGrams("");
      setActiveWorkerId(null);
      toast({
        title: "Caixa registada",
        description: `${weight.grams} g — pronto para o próximo trabalhador.`,
      });
    } catch (err: unknown) {
      beep("error");
      const e = err as { response?: { status?: number; data?: { error?: string } } };
      const msg =
        e?.response?.status === 403
          ? (e.response?.data?.error ?? "Trabalhador sem entrada para hoje.")
          : "Verifique a ligação e tente de novo.";
      toast({ title: "Erro ao registar", description: msg, variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  };

  const weight = getWeightToRegister();
  const canWeigh = !!activeWorkerId && activeWorkerCheckedIn && !!weight && !isProcessing;
  const isOverload = reading?.status === "OVERLOAD";

  return (
    <Layout>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">

        {/* ══════ WORKER IDENTIFICATION ══════ */}
        <div className="bg-card rounded-2xl shadow-sm border border-border overflow-hidden">
          {!activeWorkerId ? (
            <div className="p-6">
              <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
                <User className="text-primary w-5 h-5" /> Identificar Trabalhador
              </h2>

              {!showScanner ? (
                <div className="space-y-4">
                  <button
                    onClick={() => setShowScanner(true)}
                    className="w-full flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed border-primary/40 rounded-2xl bg-primary/5 text-primary hover:bg-primary/10 active:scale-[0.98] transition-all"
                  >
                    <ScanLine className="w-12 h-12" />
                    <span className="font-bold text-xl">Ler QR Code</span>
                    <span className="text-sm opacity-60">Aponte a câmara para o cartão do trabalhador</span>
                  </button>

                  <div className="relative flex items-center gap-3">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">ou</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>

                  <form onSubmit={handleManualIdSubmit} className="flex gap-2">
                    <input
                      type="text"
                      list="worker-ids-datalist"
                      placeholder="ID do Trabalhador (ex: W001)"
                      value={manualIdInput}
                      onChange={(e) => setManualIdInput(e.target.value)}
                      className="flex-1 bg-background border-2 border-border rounded-xl px-4 py-3 font-mono uppercase focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all text-lg"
                      data-testid="input-worker-id"
                    />
                    <datalist id="worker-ids-datalist">
                      {workers
                        .filter(w => w.active !== false)
                        .map(w => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                    </datalist>
                    <button type="submit" className="bg-primary text-primary-foreground px-6 font-bold rounded-xl hover:opacity-90 transition-opacity text-lg">
                      OK
                    </button>
                  </form>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="relative rounded-2xl overflow-hidden bg-black aspect-[4/3]">
                    <video
                      ref={qrVideoRef}
                      className="absolute inset-0 w-full h-full object-cover"
                      playsInline
                      muted
                    />
                    <canvas ref={qrCanvasRef} className="hidden" />

                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="relative w-56 h-56">
                        <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-lg" />
                        <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-lg" />
                        <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-lg" />
                        <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-lg" />
                        {isScanning && (
                          <motion.div
                            className="absolute left-2 right-2 h-0.5 bg-primary shadow-[0_0_8px_2px_rgba(var(--primary)/0.8)]"
                            animate={{ top: ["8%", "92%", "8%"] }}
                            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                          />
                        )}
                      </div>
                    </div>

                    <div className="absolute top-4 left-0 right-0 flex justify-center">
                      <span className={`px-4 py-1.5 rounded-full text-xs font-bold backdrop-blur-sm ${
                        isScanning ? "bg-success/80 text-white" : "bg-black/60 text-white"
                      }`}>
                        {isScanning ? "A procurar QR Code…" : "A iniciar câmara…"}
                      </span>
                    </div>

                    <button
                      onClick={() => setShowScanner(false)}
                      className="absolute top-4 right-4 bg-black/50 text-white p-2.5 rounded-full backdrop-blur-sm z-10"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {scannerError && (
                    <p className="text-center text-sm text-destructive font-medium">{scannerError}</p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-primary p-6 text-primary-foreground flex justify-between items-center">
              <div>
                <p className="text-primary-foreground/70 text-sm font-medium mb-1">Trabalhador Activo</p>
                <h2 className="text-2xl font-display font-bold">{activeWorker?.name || activeWorkerId}</h2>
                <span className="inline-block mt-2 bg-black/20 px-3 py-1 rounded-full text-sm font-mono font-bold border border-white/10">
                  {activeWorkerId}
                </span>
              </div>
              <button
                onClick={() => setActiveWorkerId(null)}
                className="bg-white/10 hover:bg-white/20 p-3 rounded-full transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          )}
        </div>

        {/* ══════ ATTENDANCE WARNING ══════ */}
        {activeWorkerId && !activeWorkerCheckedIn && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-2xl p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-bold text-destructive">Sem entrada registada para hoje</p>
              <p className="text-sm text-destructive/80 mt-1">
                Este trabalhador ainda não deu entrada hoje (ou já deu saída). Registe a entrada para poder pesar.
              </p>
              <Link
                href="/attendance"
                className="inline-flex items-center gap-1.5 mt-3 bg-destructive text-destructive-foreground px-4 py-2 rounded-lg text-sm font-bold hover:opacity-90 transition-opacity"
              >
                <LogIn className="w-4 h-4" /> Ir para Entradas/Saídas
              </Link>
            </div>
          </div>
        )}

        {/* ══════ WEIGHT MODE TABS ══════ */}
        <div className="bg-card rounded-2xl shadow-sm border border-border overflow-hidden">
          <div className="flex border-b border-border">
            {([
              { mode: "scale" as WeightMode, icon: <Usb className="w-4 h-4" />, label: "Balança" },
              { mode: "manual" as WeightMode, icon: <Keyboard className="w-4 h-4" />, label: "Manual" },
            ]).map(({ mode, icon, label }) => (
              <button
                key={mode}
                onClick={() => setWeightMode(mode)}
                className={`flex-1 flex items-center justify-center gap-2 py-4 text-sm font-bold transition-all ${
                  weightMode === mode
                    ? "text-primary border-b-2 border-primary bg-primary/5"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                }`}
              >
                {icon} {label}
              </button>
            ))}
          </div>

          <div className="p-6">
            {/* ── SCALE ── */}
            {weightMode === "scale" && (
              <div className="text-center">
                {scaleStatus === "DISCONNECTED" && (
                  <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
                    <ZapOff className="w-14 h-14 opacity-30" />
                    <p className="font-semibold">Balança desconectada</p>
                    <p className="text-xs max-w-xs">Ligue a balança FFN Baxtran pelo botão no topo da página</p>
                  </div>
                )}
                {scaleStatus !== "DISCONNECTED" && (
                  <>
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-sm font-bold tracking-wider text-muted-foreground uppercase flex items-center gap-2">
                        <Scale className="w-4 h-4" /> Leitura Actual
                      </h3>
                      {reading?.status === "STABLE" && (
                        <span className="bg-success/15 text-success px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> ESTÁVEL
                        </span>
                      )}
                    </div>
                    {isOverload ? (
                      <div className="py-8 flex flex-col items-center text-destructive animate-pulse">
                        <AlertCircle className="w-16 h-16 mb-4" />
                        <div className="text-5xl font-display font-black tracking-tight">OVERLOAD</div>
                        <p className="mt-2 font-medium">Retire peso da balança!</p>
                      </div>
                    ) : (
                      <div className="py-4">
                        <div className={`text-7xl sm:text-8xl font-display font-black tracking-tighter transition-colors duration-300 ${
                          reading?.status === "STABLE" ? "text-foreground" : "text-muted-foreground"
                        }`}>
                          {reading ? reading.weightGrams : "0"}
                          <span className="text-3xl text-muted-foreground ml-1">g</span>
                        </div>
                      </div>
                    )}
                    <ScaleDiagnostics
                      bytesReceived={bytesReceived}
                      lastByteAt={lastByteAt}
                      lastRaw={lastRaw}
                    />

                  </>
                )}
              </div>
            )}

            {/* ── MANUAL ── */}
            {weightMode === "manual" && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground text-center">Introduza o peso directamente em gramas</p>
                <div className="flex gap-3 items-center">
                  <input
                    type="number"
                    inputMode="numeric"
                    placeholder="0"
                    min={MIN_GRAMS}
                    max={MAX_GRAMS}
                    value={manualGrams}
                    onChange={(e) => setManualGrams(e.target.value)}
                    className="flex-1 text-center text-5xl font-display font-black bg-background border-2 border-border rounded-2xl px-4 py-6 focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all"
                  />
                  <span className="text-2xl font-bold text-muted-foreground">g</span>
                </div>
                {manualGrams && (
                  <div className={`text-center text-sm font-medium px-4 py-2 rounded-xl ${
                    parseInt(manualGrams) >= MIN_GRAMS && parseInt(manualGrams) <= MAX_GRAMS
                      ? "bg-success/10 text-success"
                      : "bg-destructive/10 text-destructive"
                  }`}>
                    {parseInt(manualGrams) < MIN_GRAMS ? `Peso muito baixo (mín. ${MIN_GRAMS}g)` :
                     parseInt(manualGrams) > MAX_GRAMS ? `Peso muito alto (máx. ${MAX_GRAMS}g)` :
                     `✓ ${(parseInt(manualGrams) / 1000).toFixed(3)} kg`}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ══════ REGISTER BUTTON ══════ */}
        <button
          onClick={handleWeigh}
          disabled={!canWeigh}
          className={`w-full py-7 rounded-2xl font-display font-black text-2xl sm:text-3xl transition-all duration-300 shadow-xl ${
            canWeigh
              ? "bg-gradient-to-b from-success to-emerald-600 text-white shadow-success/30 hover:shadow-success/50 hover:-translate-y-1 active:translate-y-0 active:shadow-md"
              : "bg-muted text-muted-foreground cursor-not-allowed shadow-none"
          }`}
        >
          {isProcessing ? "A REGISTAR…" :
           !activeWorkerId ? "IDENTIFICAR TRABALHADOR" :
           !activeWorkerCheckedIn ? "SEM ENTRADA PARA HOJE" :
           !weight ? "AGUARDAR LEITURA" :
           `REGISTAR  ${weight.grams} g`}
        </button>

        {/* ══════ TODAY'S HISTORY ══════ */}
        {activeWorkerId && (
          <div className="bg-card rounded-2xl shadow-sm border border-border p-6">
            <div className="flex justify-between items-end mb-4">
              <h3 className="font-bold text-foreground">Registos de Hoje</h3>
              <div className="text-right">
                <p className="text-xs text-muted-foreground font-medium uppercase">Total Acumulado</p>
                <p className="text-lg font-bold text-primary">
                  {(todayRecords.reduce((acc, r) => acc + r.weightGrams, 0) / 1000).toFixed(2)} kg
                </p>
              </div>
            </div>

            {todayRecords.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground border-2 border-dashed border-border rounded-xl">
                Nenhum registo ainda hoje.
              </div>
            ) : (
              <div className="space-y-3">
                <AnimatePresence>
                  {todayRecords.map((record) => (
                    <motion.div
                      key={record.id}
                      initial={{ opacity: 0, y: -16 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center justify-between p-4 bg-background border border-border rounded-xl"
                    >
                      <div>
                        <p className="font-mono text-2xl font-bold text-foreground leading-none">{record.weightGrams} g</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {format(new Date(record.timestamp), "HH:mm:ss")}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                          record.scaleId?.includes("MANUAL")
                            ? "text-orange-700 bg-orange-100 dark:bg-orange-900/40 dark:text-orange-300"
                            : "text-green-700 bg-green-100 dark:bg-green-900/40 dark:text-green-300"
                        }`}>
                          {record.scaleId?.includes("MANUAL") ? "✍ manual" : "⚖ balança"}
                        </span>
                        <button className="p-2 text-muted-foreground hover:text-destructive transition-colors rounded-lg hover:bg-destructive/10">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}

function ScaleDiagnostics({
  bytesReceived,
  lastByteAt,
  lastRaw,
}: {
  bytesReceived: number;
  lastByteAt: number;
  lastRaw: string;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const silentForMs = lastByteAt > 0 ? now - lastByteAt : -1;
  const dotColour =
    bytesReceived === 0
      ? "bg-destructive animate-pulse"
      : silentForMs > 3000
        ? "bg-orange-500"
        : "bg-success animate-pulse";

  return (
    <div className="mt-4 px-3 py-2.5 bg-muted/40 rounded-md text-left space-y-1.5" data-testid="scale-diagnostics">
      <div className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${dotColour}`} />
          Diagnóstico cabo
        </span>
        <span className="font-mono normal-case font-medium" data-testid="text-bytes-counter">
          {bytesReceived} bytes
        </span>
      </div>

      {bytesReceived === 0 ? (
        <p className="text-[11px] text-destructive font-medium leading-snug">
          Sem dados a chegar do adaptador. Verifique:
          <br />• A balança está em modo "stream contínuo"
          <br />• Baudrate do SH-B30 = 9600, 8N1 (DIP-switches)
          <br />• Cabo RS-232 entre balança e adaptador (TX/RX)
          <br />• Tente a outra porta COM se o Windows criou duas
        </p>
      ) : (
        <div className="text-[10px] font-mono text-muted-foreground break-all" data-testid="text-scale-raw">
          <span className="opacity-60 mr-1">RX:</span>
          {lastRaw || <span className="italic opacity-50">a aguardar fim de linha…</span>}
        </div>
      )}
    </div>
  );
}
