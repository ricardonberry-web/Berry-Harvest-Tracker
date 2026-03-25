import { useState, useEffect, useRef } from "react";
import { Layout } from "@/components/Layout";
import { useScale } from "@/hooks/use-scale";
import { useQRScanner } from "@/hooks/use-qr-scanner";
import { useBeep } from "@/hooks/use-beep";
import { useListWorkers, useCreateWeighRecord, useListWeighRecords } from "@workspace/api-client-react";
import {
  Camera, X, User, Scale, AlertCircle, Trash2, CheckCircle2,
  Keyboard, Sparkles, Usb, RefreshCw,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

type WeightMode = "scale" | "manual" | "photo";

export default function WeighingPage() {
  const { status: scaleStatus, reading } = useScale();
  const beep = useBeep();
  const { toast } = useToast();

  const [activeWorkerId, setActiveWorkerId] = useState<string | null>(null);
  const [manualIdInput, setManualIdInput] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const lastRecordTimeRef = useRef<number>(0);

  const [weightMode, setWeightMode] = useState<WeightMode>("scale");
  const [manualGrams, setManualGrams] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [photoMimeType, setPhotoMimeType] = useState("image/jpeg");
  const [aiGrams, setAiGrams] = useState<number | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const { data: workers = [] } = useListWorkers();
  const activeWorker = workers.find(w => w.id === activeWorkerId);

  const { data: todayRecords = [], refetch: refetchRecords } = useListWeighRecords(
    { workerId: activeWorkerId || undefined, limit: 10 },
    { query: { enabled: !!activeWorkerId } }
  );

  const createRecord = useCreateWeighRecord();
  const { videoRef, canvasRef, startScanner, stopScanner, scanFrame } = useQRScanner();

  useEffect(() => {
    if (showScanner) {
      startScanner();
      const interval = setInterval(() => {
        const code = scanFrame();
        if (code) handleWorkerIdentified(code);
      }, 500);
      return () => { clearInterval(interval); stopScanner(); };
    }
  }, [showScanner]);

  const handleWorkerIdentified = (id: string) => {
    const worker = workers.find(w => w.id === id);
    if (worker) {
      beep("success");
      setActiveWorkerId(id);
      setShowScanner(false);
      toast({ title: "Trabalhador Identificado", description: `${worker.name} (${worker.id})` });
    } else {
      beep("error");
      toast({ title: "Trabalhador não encontrado", description: `O ID ${id} não existe no sistema.`, variant: "destructive" });
      stopScanner();
      setTimeout(startScanner, 2000);
    }
  };

  const handleManualIdSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualIdInput.trim()) {
      handleWorkerIdentified(manualIdInput.trim().toUpperCase());
      setManualIdInput("");
    }
  };

  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const mimeType = file.type || "image/jpeg";
    setPhotoMimeType(mimeType);
    setAiGrams(null);

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      setPhotoDataUrl(dataUrl);
      const base64 = dataUrl.split(",")[1];
      setPhotoBase64(base64);

      setIsAnalyzing(true);
      try {
        const res = await fetch("/api/scale/read-photo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: base64, mimeType }),
        });
        const json = await res.json();
        if (json.grams !== null && json.grams !== undefined) {
          setAiGrams(json.grams);
          beep("success");
          toast({ title: "IA leu o peso", description: `${json.grams} gramas detectados na balança.` });
        } else {
          beep("warning");
          toast({
            title: "IA não conseguiu ler",
            description: json.error === "OVERLOAD" ? "Overload detectado na balança." :
                          json.error === "UNREADABLE" ? "Imagem não suficientemente nítida." :
                          "Não foi possível ler o valor.",
            variant: "destructive",
          });
        }
      } catch {
        toast({ title: "Erro de comunicação", description: "Falha ao contactar o servidor de IA.", variant: "destructive" });
      } finally {
        setIsAnalyzing(false);
        if (e.target) e.target.value = "";
      }
    };
    reader.readAsDataURL(file);
  };

  const getWeightToRegister = (): { grams: number; source: string } | null => {
    if (weightMode === "scale") {
      if (reading?.status === "STABLE" && reading.weightGrams > 0) {
        return { grams: reading.weightGrams, source: "balança" };
      }
      return null;
    }
    if (weightMode === "manual") {
      const g = parseInt(manualGrams, 10);
      if (!isNaN(g) && g > 0) return { grams: g, source: "manual" };
      return null;
    }
    if (weightMode === "photo") {
      if (aiGrams !== null && aiGrams > 0) return { grams: aiGrams, source: "IA/foto" };
      return null;
    }
    return null;
  };

  const handleWeigh = async () => {
    if (!activeWorkerId || isProcessing) return;
    const weight = getWeightToRegister();
    if (!weight) return;

    if (weight.grams < 50 || weight.grams > 5100) {
      beep("warning");
      toast({ title: "Peso Inválido", description: "O peso deve estar entre 50g e 5100g.", variant: "destructive" });
      return;
    }

    const now = Date.now();
    if (now - lastRecordTimeRef.current < 15000) {
      if (!window.confirm("Pesagem muito rápida! Certeza que quer registar outra caixa?")) return;
    }

    setIsProcessing(true);
    try {
      await createRecord.mutateAsync({
        data: {
          workerId: activeWorkerId,
          weightGrams: weight.grams,
          unit: "g",
          scaleId: weight.source === "balança" ? "BAXTRAN-XTA-01" : `MANUAL-${weight.source.toUpperCase()}`,
          rawLine: weight.source === "balança" ? (reading?.rawLine ?? "") : `manual:${weight.grams}g`,
          timestamp: new Date().toISOString(),
        },
      });
      beep("success");
      lastRecordTimeRef.current = Date.now();
      refetchRecords();

      if (weightMode === "manual") setManualGrams("");
      if (weightMode === "photo") { setPhotoDataUrl(null); setPhotoBase64(null); setAiGrams(null); }

      toast({ title: "Pesagem registada", description: `${weight.grams}g via ${weight.source}` });
    } catch {
      beep("error");
      toast({ title: "Erro ao registar", description: "Verifique a ligação e tente novamente.", variant: "destructive" });
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

        {/* Worker Identification */}
        <div className="bg-card rounded-2xl shadow-sm border border-border overflow-hidden">
          {!activeWorkerId ? (
            <div className="p-6">
              <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
                <User className="text-primary" /> Identificar Trabalhador
              </h2>
              {!showScanner ? (
                <div className="space-y-4">
                  <button
                    onClick={() => setShowScanner(true)}
                    className="w-full flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed border-primary/30 rounded-xl bg-primary/5 text-primary hover:bg-primary/10 transition-colors"
                  >
                    <Camera className="w-10 h-10" />
                    <span className="font-bold text-lg">Ler QR Code</span>
                  </button>
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
                    <div className="relative flex justify-center"><span className="bg-card px-4 text-xs text-muted-foreground font-medium uppercase">OU</span></div>
                  </div>
                  <form onSubmit={handleManualIdSubmit} className="flex gap-2">
                    <input
                      type="text"
                      placeholder="ID do Trabalhador (ex: W001)"
                      value={manualIdInput}
                      onChange={(e) => setManualIdInput(e.target.value)}
                      className="flex-1 bg-background border-2 border-border rounded-xl px-4 py-3 font-mono uppercase focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all"
                    />
                    <button type="submit" className="bg-secondary text-secondary-foreground px-6 font-bold rounded-xl hover:bg-secondary/80 transition-colors">
                      OK
                    </button>
                  </form>
                </div>
              ) : (
                <div className="relative rounded-xl overflow-hidden bg-black aspect-[4/3]">
                  <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" />
                  <canvas ref={canvasRef} className="hidden" />
                  <div className="absolute inset-0 border-4 border-primary/50 m-8 rounded-xl z-10 pointer-events-none">
                    <div className="absolute inset-0 bg-primary/10 animate-pulse" />
                  </div>
                  <button onClick={() => setShowScanner(false)} className="absolute top-4 right-4 bg-black/50 text-white p-2 rounded-full backdrop-blur-md z-20">
                    <X />
                  </button>
                  <p className="absolute bottom-4 left-0 right-0 text-center text-white font-medium z-20 drop-shadow-md">
                    Aponte para o QR Code
                  </p>
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
              <button onClick={() => setActiveWorkerId(null)} className="bg-white/10 hover:bg-white/20 p-3 rounded-full transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
          )}
        </div>

        {/* Weight Input Mode Tabs */}
        <div className="bg-card rounded-2xl shadow-sm border border-border overflow-hidden">
          <div className="flex border-b border-border">
            {([
              { mode: "scale" as WeightMode, icon: <Usb className="w-4 h-4" />, label: "Balança" },
              { mode: "manual" as WeightMode, icon: <Keyboard className="w-4 h-4" />, label: "Manual" },
              { mode: "photo" as WeightMode, icon: <Sparkles className="w-4 h-4" />, label: "IA / Foto" },
            ] as const).map(({ mode, icon, label }) => (
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

            {/* SCALE MODE */}
            {weightMode === "scale" && (
              <div className="text-center relative">
                {scaleStatus === "DISCONNECTED" && (
                  <div className="flex flex-col items-center gap-3 py-6 text-muted-foreground">
                    <Scale className="w-12 h-12 opacity-40" />
                    <p className="font-medium">Balança desconectada</p>
                    <p className="text-xs">Ligue a balança pelo botão no topo da página</p>
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

            {/* MANUAL MODE */}
            {weightMode === "manual" && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground text-center">
                  Introduza o peso directamente em gramas
                </p>
                <div className="flex gap-3 items-center">
                  <input
                    type="number"
                    inputMode="numeric"
                    placeholder="0"
                    min={1}
                    max={9999}
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

            {/* PHOTO / AI MODE */}
            {weightMode === "photo" && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground text-center">
                  Tire uma foto ao visor da balança — a IA lê o valor automaticamente
                </p>

                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handlePhotoCapture}
                />

                {!photoDataUrl ? (
                  <button
                    onClick={() => photoInputRef.current?.click()}
                    className="w-full flex flex-col items-center justify-center gap-4 p-10 border-2 border-dashed border-violet-300 rounded-2xl bg-violet-50 text-violet-600 hover:bg-violet-100 transition-colors dark:bg-violet-950/20 dark:border-violet-700 dark:text-violet-400"
                  >
                    <Sparkles className="w-12 h-12" />
                    <div className="text-center">
                      <p className="font-bold text-lg">Fotografar Balança</p>
                      <p className="text-sm opacity-70">Aponte para o ecrã da balança</p>
                    </div>
                  </button>
                ) : (
                  <div className="space-y-3">
                    <div className="relative rounded-2xl overflow-hidden bg-black aspect-video">
                      <img src={photoDataUrl} alt="Foto da balança" className="w-full h-full object-contain" />
                      {isAnalyzing && (
                        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-3">
                          <RefreshCw className="w-8 h-8 text-white animate-spin" />
                          <p className="text-white font-bold">A analisar com IA...</p>
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
                          <p className="text-4xl font-display font-black text-success">{aiGrams} <span className="text-lg">g</span></p>
                        </div>
                        <CheckCircle2 className="w-8 h-8 text-success" />
                      </motion.div>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={() => photoInputRef.current?.click()}
                        disabled={isAnalyzing}
                        className="flex-1 flex items-center justify-center gap-2 py-3 bg-muted text-muted-foreground font-bold rounded-xl hover:bg-muted/80 transition-colors disabled:opacity-50"
                      >
                        <Camera className="w-4 h-4" /> Nova foto
                      </button>
                      <button
                        onClick={() => { setPhotoDataUrl(null); setPhotoBase64(null); setAiGrams(null); }}
                        className="p-3 bg-muted text-muted-foreground rounded-xl hover:bg-muted/80 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Big Action Button */}
        <button
          onClick={handleWeigh}
          disabled={!canWeigh}
          className={`w-full py-6 rounded-2xl font-display font-black text-2xl sm:text-3xl transition-all duration-300 shadow-xl ${
            canWeigh
              ? "bg-gradient-to-b from-success to-emerald-600 text-white shadow-success/30 hover:shadow-success/40 hover:-translate-y-1 active:translate-y-0 active:shadow-md"
              : "bg-muted text-muted-foreground cursor-not-allowed shadow-none"
          }`}
        >
          {isProcessing ? "A REGISTAR..." : isAnalyzing ? "A LER COM IA..." :
           !activeWorkerId ? "IDENTIFICAR TRABALHADOR" :
           !weight ? "AGUARDAR LEITURA" : `REGISTAR ${weight.grams}g`}
        </button>

        {/* Today's History */}
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
                Nenhum registo ainda.
              </div>
            ) : (
              <div className="space-y-3">
                <AnimatePresence>
                  {todayRecords.map((record) => (
                    <motion.div
                      key={record.id}
                      initial={{ opacity: 0, height: 0, y: -20 }}
                      animate={{ opacity: 1, height: "auto", y: 0 }}
                      className="flex items-center justify-between p-4 bg-background border border-border rounded-xl"
                    >
                      <div>
                        <p className="font-mono text-xl font-bold text-foreground">{record.weightGrams} g</p>
                        <p className="text-xs text-muted-foreground">{format(new Date(record.timestamp), "HH:mm:ss")}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-xs font-bold px-2 py-1 rounded ${
                          record.scaleId?.startsWith("MANUAL") ? "text-orange-600 bg-orange-100 dark:bg-orange-900/30" :
                          record.scaleId?.startsWith("BAXTRAN") ? "text-success bg-success/10" :
                          "text-violet-600 bg-violet-100 dark:bg-violet-900/30"
                        }`}>
                          {record.scaleId?.startsWith("MANUAL-MANUAL") ? "✍ manual" :
                           record.scaleId?.startsWith("MANUAL-IA") ? "✨ IA" :
                           record.scaleId?.startsWith("BAXTRAN") ? "⚖ balança" : "OK"}
                        </span>
                        <button className="p-2 text-muted-foreground hover:text-destructive transition-colors">
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
