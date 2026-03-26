import { useState, useEffect, useRef, useCallback } from "react";
import { Layout } from "@/components/Layout";
import { useScale } from "@/hooks/use-scale";
import { useQRScanner } from "@/hooks/use-qr-scanner";
import { useBeep } from "@/hooks/use-beep";
import { useListWorkers, useCreateWeighRecord, useListWeighRecords } from "@workspace/api-client-react";
import {
  Camera, X, User, Scale, AlertCircle, Trash2, CheckCircle2,
  Keyboard, Sparkles, Usb, RefreshCw, ZapOff, ScanLine,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

type WeightMode = "scale" | "manual" | "photo";

/* ─────────────────────────────────────────────
   Helper: open camera with fallbacks
───────────────────────────────────────────── */
async function openCamera(
  videoEl: HTMLVideoElement,
  preferRear = true,
): Promise<MediaStream | null> {
  const tries: MediaStreamConstraints[] = preferRear
    ? [
        { video: { facingMode: { exact: "environment" }, width: { ideal: 1920 } } },
        { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } } },
        { video: { facingMode: "environment" } },
        { video: true },
      ]
    : [{ video: true }];

  for (const c of tries) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(c);
      videoEl.srcObject = stream;
      videoEl.setAttribute("playsinline", "true");
      videoEl.muted = true;
      await videoEl.play().catch(() => {});
      return stream;
    } catch {
      // try next
    }
  }
  return null;
}

export default function WeighingPage() {
  const { status: scaleStatus, reading } = useScale();
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

  // ── AI camera ──
  const [cameraActive, setCameraActive] = useState(false);
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null);
  const [aiGrams, setAiGrams] = useState<number | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const aiVideoRef = useRef<HTMLVideoElement>(null);
  const aiCanvasRef = useRef<HTMLCanvasElement>(null);
  const aiStreamRef = useRef<MediaStream | null>(null);

  const { data: workers = [] } = useListWorkers();
  const activeWorker = workers.find(w => w.id === activeWorkerId);

  const { data: todayRecords = [], refetch: refetchRecords } = useListWeighRecords(
    { workerId: activeWorkerId || undefined, limit: 10 },
    { query: { enabled: !!activeWorkerId } },
  );

  const createRecord = useCreateWeighRecord();

  // ── QR Scanner ──
  // Use a ref so handleQRScan can call startScanner without a circular hook dependency
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
      // restart loop — hook stopped after detection
      setTimeout(() => startScannerRef.current(), 1500);
    }
  }, [workers, beep, toast]);

  const { videoRef: qrVideoRef, canvasRef: qrCanvasRef, isScanning, error: scannerError, startScanner, stopScanner } =
    useQRScanner(handleQRScan);

  // Keep ref in sync
  useEffect(() => { startScannerRef.current = startScanner; }, [startScanner]);

  useEffect(() => {
    if (showScanner) {
      startScanner();
    } else {
      stopScanner();
    }
    return () => stopScanner();
  }, [showScanner]);

  // ── AI camera helpers ──
  const stopAiCamera = useCallback(() => {
    if (aiStreamRef.current) {
      aiStreamRef.current.getTracks().forEach(t => t.stop());
      aiStreamRef.current = null;
    }
    if (aiVideoRef.current) {
      aiVideoRef.current.srcObject = null;
      aiVideoRef.current.load();
    }
    setCameraActive(false);
  }, []);

  const startAiCamera = useCallback(async () => {
    // The <video> is always mounted (hidden), so ref is always available
    const video = aiVideoRef.current;
    if (!video) {
      toast({ title: "Câmara não disponível", description: "Elemento de vídeo não encontrado.", variant: "destructive" });
      return;
    }
    // Show the camera UI first
    setCameraActive(true);

    const tries: MediaStreamConstraints[] = [
      { video: { facingMode: { exact: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
      { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } },
      { video: { facingMode: "environment" } },
      { video: true },
    ];

    let stream: MediaStream | null = null;
    for (const c of tries) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(c);
        break;
      } catch {
        // try next constraint
      }
    }

    if (!stream) {
      setCameraActive(false);
      toast({
        title: "Câmara não disponível",
        description: "Verifique as permissões da câmara nas definições do browser.",
        variant: "destructive",
      });
      return;
    }

    aiStreamRef.current = stream;
    video.srcObject = stream;
    video.setAttribute("playsinline", "true");
    video.muted = true;
    try {
      await video.play();
    } catch {
      // Some browsers need a user gesture; video will play on next interaction
    }
  }, [toast]);

  // Stop AI camera when leaving photo mode or unmounting
  useEffect(() => {
    if (weightMode !== "photo") stopAiCamera();
  }, [weightMode, stopAiCamera]);
  useEffect(() => () => stopAiCamera(), [stopAiCamera]);

  const captureAndAnalyze = useCallback(async () => {
    const video = aiVideoRef.current;
    const canvas = aiCanvasRef.current;
    if (!video || !canvas) return;

    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const base64 = dataUrl.split(",")[1];
    setCapturedDataUrl(dataUrl);
    stopAiCamera();

    setIsAnalyzing(true);
    try {
      const res = await fetch("/api/scale/read-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mimeType: "image/jpeg" }),
      });
      const json = await res.json();
      if (json.grams !== null && json.grams !== undefined && !json.error) {
        setAiGrams(json.grams);
        beep("success");
        toast({ title: `IA leu ${json.grams}g`, description: "Confirme e carregue em REGISTAR." });
      } else {
        beep("warning");
        const msg =
          json.error === "OVERLOAD" ? "Overload — retire peso da balança." :
          json.error === "INVALID" ? "Valor inválido detectado." :
          "Não foi possível ler o visor — tente uma foto mais próxima e nítida.";
        toast({ title: "IA não conseguiu ler", description: msg, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erro de rede", description: "Falha ao contactar o servidor de IA.", variant: "destructive" });
    } finally {
      setIsAnalyzing(false);
    }
  }, [beep, toast, stopAiCamera]);

  const resetPhoto = useCallback(() => {
    setCapturedDataUrl(null);
    setAiGrams(null);
  }, []);

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
      if (reading?.status === "STABLE" && reading.weightGrams >= 50) return { grams: reading.weightGrams, source: "scale" };
      return null;
    }
    if (weightMode === "manual") {
      const g = parseInt(manualGrams, 10);
      if (!isNaN(g) && g >= 50 && g <= 5100) return { grams: g, source: "manual" };
      return null;
    }
    if (weightMode === "photo") {
      if (aiGrams !== null && aiGrams >= 50 && aiGrams <= 5100) return { grams: aiGrams, source: "photo" };
      return null;
    }
    return null;
  };

  const handleWeigh = async () => {
    if (!activeWorkerId || isProcessing) return;
    const weight = getWeightToRegister();
    if (!weight) return;

    const now = Date.now();
    if (now - lastRecordTimeRef.current < 15000) {
      if (!window.confirm("Pesagem muito rápida! Certeza que quer registar outra caixa?")) return;
    }

    setIsProcessing(true);
    try {
      const scaleId =
        weight.source === "scale" ? "BAXTRAN-XTA-01" :
        weight.source === "photo" ? "MANUAL-IA" :
        "MANUAL-MANUAL";
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

      if (weightMode === "manual") setManualGrams("");
      if (weightMode === "photo") resetPhoto();
    } catch {
      beep("error");
      toast({ title: "Erro ao registar", description: "Verifique a ligação e tente de novo.", variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  };

  const weight = getWeightToRegister();
  const canWeigh = !!activeWorkerId && !!weight && !isProcessing && !isAnalyzing;
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
                      placeholder="ID do Trabalhador (ex: W001)"
                      value={manualIdInput}
                      onChange={(e) => setManualIdInput(e.target.value)}
                      className="flex-1 bg-background border-2 border-border rounded-xl px-4 py-3 font-mono uppercase focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all text-lg"
                    />
                    <button type="submit" className="bg-primary text-primary-foreground px-6 font-bold rounded-xl hover:opacity-90 transition-opacity text-lg">
                      OK
                    </button>
                  </form>
                </div>
              ) : (
                /* QR Scanner View */
                <div className="space-y-3">
                  <div className="relative rounded-2xl overflow-hidden bg-black aspect-[4/3]">
                    <video
                      ref={qrVideoRef}
                      className="absolute inset-0 w-full h-full object-cover"
                      playsInline
                      muted
                    />
                    <canvas ref={qrCanvasRef} className="hidden" />

                    {/* Scanning overlay */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="relative w-56 h-56">
                        {/* Corner brackets */}
                        <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-lg" />
                        <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-lg" />
                        <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-lg" />
                        <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-lg" />
                        {/* Scanning line */}
                        {isScanning && (
                          <motion.div
                            className="absolute left-2 right-2 h-0.5 bg-primary shadow-[0_0_8px_2px_rgba(var(--primary)/0.8)]"
                            animate={{ top: ["8%", "92%", "8%"] }}
                            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                          />
                        )}
                      </div>
                    </div>

                    {/* Status */}
                    <div className="absolute top-4 left-0 right-0 flex justify-center">
                      <span className={`px-4 py-1.5 rounded-full text-xs font-bold backdrop-blur-sm ${
                        isScanning
                          ? "bg-success/80 text-white"
                          : "bg-black/60 text-white"
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

        {/* ══════ WEIGHT MODE TABS ══════ */}
        <div className="bg-card rounded-2xl shadow-sm border border-border overflow-hidden">
          <div className="flex border-b border-border">
            {([
              { mode: "scale" as WeightMode, icon: <Usb className="w-4 h-4" />, label: "Balança" },
              { mode: "manual" as WeightMode, icon: <Keyboard className="w-4 h-4" />, label: "Manual" },
              { mode: "photo" as WeightMode, icon: <Sparkles className="w-4 h-4" />, label: "IA / Foto" },
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
                    <p className="text-xs max-w-xs">Ligue a balança pelo botão de ligação no topo da página</p>
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
                    min={50}
                    max={5100}
                    value={manualGrams}
                    onChange={(e) => setManualGrams(e.target.value)}
                    className="flex-1 text-center text-5xl font-display font-black bg-background border-2 border-border rounded-2xl px-4 py-6 focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all"
                  />
                  <span className="text-2xl font-bold text-muted-foreground">g</span>
                </div>
                {manualGrams && (
                  <div className={`text-center text-sm font-medium px-4 py-2 rounded-xl ${
                    parseInt(manualGrams) >= 50 && parseInt(manualGrams) <= 5100
                      ? "bg-success/10 text-success"
                      : "bg-destructive/10 text-destructive"
                  }`}>
                    {parseInt(manualGrams) < 50 ? "Peso muito baixo (mín. 50g)" :
                     parseInt(manualGrams) > 5100 ? "Peso muito alto (máx. 5100g)" :
                     `✓ ${(parseInt(manualGrams) / 1000).toFixed(3)} kg`}
                  </div>
                )}
              </div>
            )}

            {/* ── AI / PHOTO ── */}
            {weightMode === "photo" && (
              <div className="space-y-4">

                {/*
                  The video + canvas are ALWAYS in the DOM while in photo mode,
                  so aiVideoRef / aiCanvasRef are never null when startAiCamera() runs.
                  Visibility is toggled purely with CSS (no conditional unmount).
                */}

                {/* Live camera view — visible only when active and no photo taken yet */}
                <div className={cameraActive && !capturedDataUrl ? "space-y-3" : "hidden"}>
                  <div className="relative rounded-2xl overflow-hidden bg-black aspect-video">
                    <video
                      ref={aiVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="border-2 border-white/50 rounded-xl w-3/4 h-2/3 flex items-end justify-center pb-2">
                        <span className="text-white/60 text-xs font-medium">Centre o visor aqui</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={captureAndAnalyze}
                      className="flex-1 py-5 bg-violet-600 text-white font-bold rounded-2xl text-xl hover:bg-violet-700 active:scale-[0.97] transition-all shadow-lg shadow-violet-600/30 flex items-center justify-center gap-2"
                    >
                      <Camera className="w-6 h-6" /> Capturar e Analisar
                    </button>
                    <button
                      onClick={stopAiCamera}
                      className="p-5 bg-muted text-muted-foreground rounded-2xl hover:bg-muted/80 transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Canvas always hidden — used only for capturing frames */}
                <canvas ref={aiCanvasRef} className="hidden" />

                {/* "Open camera" button — visible when camera not yet active and no photo */}
                {!cameraActive && !capturedDataUrl && (
                  <button
                    onClick={startAiCamera}
                    className="w-full flex flex-col items-center justify-center gap-4 p-10 border-2 border-dashed border-violet-400 rounded-2xl bg-violet-50 text-violet-700 hover:bg-violet-100 active:scale-[0.98] transition-all dark:bg-violet-950/20 dark:border-violet-700 dark:text-violet-300"
                  >
                    <Sparkles className="w-14 h-14" />
                    <div className="text-center">
                      <p className="font-bold text-xl">Abrir Câmara</p>
                      <p className="text-sm opacity-60 mt-1">Aponte para o visor da balança e capture</p>
                    </div>
                  </button>
                )}

                {/* Captured photo + AI result */}
                {capturedDataUrl && (
                  <div className="space-y-3">
                    <div className="relative rounded-2xl overflow-hidden bg-black aspect-video">
                      <img src={capturedDataUrl} alt="Foto da balança" className="w-full h-full object-contain" />
                      {isAnalyzing && (
                        <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-3">
                          <RefreshCw className="w-10 h-10 text-violet-300 animate-spin" />
                          <p className="text-white font-bold text-lg">A analisar com IA…</p>
                        </div>
                      )}
                    </div>

                    {aiGrams !== null && !isAnalyzing && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-center justify-between bg-success/10 border border-success/20 rounded-xl px-5 py-4"
                      >
                        <div>
                          <p className="text-xs font-bold text-success/70 uppercase tracking-wider">IA detectou</p>
                          <p className="text-5xl font-display font-black text-success leading-none mt-1">
                            {aiGrams}<span className="text-xl ml-1">g</span>
                          </p>
                        </div>
                        <CheckCircle2 className="w-10 h-10 text-success" />
                      </motion.div>
                    )}

                    {!isAnalyzing && (
                      <button
                        onClick={() => { resetPhoto(); startAiCamera(); }}
                        className="w-full flex items-center justify-center gap-2 py-3 bg-muted text-muted-foreground font-bold rounded-xl hover:bg-muted/80 transition-colors"
                      >
                        <Camera className="w-4 h-4" /> Tirar nova foto
                      </button>
                    )}
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
           isAnalyzing ? "A LER COM IA…" :
           !activeWorkerId ? "IDENTIFICAR TRABALHADOR" :
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
                          record.scaleId?.includes("IA")
                            ? "text-violet-700 bg-violet-100 dark:bg-violet-900/40 dark:text-violet-300"
                            : record.scaleId?.includes("MANUAL")
                            ? "text-orange-700 bg-orange-100 dark:bg-orange-900/40 dark:text-orange-300"
                            : "text-green-700 bg-green-100 dark:bg-green-900/40 dark:text-green-300"
                        }`}>
                          {record.scaleId?.includes("IA") ? "✨ IA" :
                           record.scaleId?.includes("MANUAL") ? "✍ manual" :
                           "⚖ balança"}
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
