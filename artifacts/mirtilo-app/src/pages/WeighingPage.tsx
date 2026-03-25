import { useState, useEffect, useRef } from "react";
import { Layout } from "@/components/Layout";
import { useScale } from "@/hooks/use-scale";
import { useQRScanner } from "@/hooks/use-qr-scanner";
import { useBeep } from "@/hooks/use-beep";
import { useListWorkers, useCreateWeighRecord, useListWeighRecords } from "@workspace/api-client-react";
import { Camera, X, User, Scale, AlertCircle, Trash2, CheckCircle2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

export default function WeighingPage() {
  const { status: scaleStatus, reading } = useScale();
  const beep = useBeep();
  const { toast } = useToast();
  
  const [activeWorkerId, setActiveWorkerId] = useState<string | null>(null);
  const [manualIdInput, setManualIdInput] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const lastRecordTimeRef = useRef<number>(0);

  // Queries
  const { data: workers = [] } = useListWorkers();
  const activeWorker = workers.find(w => w.id === activeWorkerId);
  
  const { data: todayRecords = [], refetch: refetchRecords } = useListWeighRecords(
    { workerId: activeWorkerId || undefined, limit: 10 },
    { query: { enabled: !!activeWorkerId } }
  );

  const createRecord = useCreateWeighRecord();

  // QR Scanner logic
  const { videoRef, canvasRef, startScanner, stopScanner, scanFrame, isScanning } = useQRScanner();

  useEffect(() => {
    if (showScanner) {
      startScanner();
      
      const interval = setInterval(() => {
        const code = scanFrame();
        if (code) {
          handleWorkerIdentified(code);
        }
      }, 500);
      
      return () => {
        clearInterval(interval);
        stopScanner();
      };
    }
  }, [showScanner, startScanner, stopScanner, scanFrame]);

  const handleWorkerIdentified = (id: string) => {
    const worker = workers.find(w => w.id === id);
    if (worker) {
      beep("success");
      setActiveWorkerId(id);
      setShowScanner(false);
      toast({
        title: "Trabalhador Identificado",
        description: `${worker.name} (${worker.id})`,
      });
    } else {
      beep("error");
      toast({
        title: "Trabalhador não encontrado",
        description: `O ID ${id} não existe no sistema.`,
        variant: "destructive"
      });
      // Pause scanning briefly on error
      stopScanner();
      setTimeout(startScanner, 2000);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualIdInput.trim()) {
      handleWorkerIdentified(manualIdInput.trim().toUpperCase());
      setManualIdInput("");
    }
  };

  const handleWeigh = async () => {
    if (!activeWorkerId || !reading || reading.status !== "STABLE" || isProcessing) return;
    
    // Anti-error: Weight limits
    if (reading.weightGrams < 50 || reading.weightGrams > 5100) {
      beep("warning");
      toast({
        title: "Peso Inválido",
        description: "O peso deve estar entre 50g e 5100g para caixas de mirtilo.",
        variant: "destructive"
      });
      return;
    }

    // Anti-error: Double click / rapid weigh prevention
    const now = Date.now();
    if (now - lastRecordTimeRef.current < 15000) { // 15 seconds debounce
      if (!window.confirm("Pesagem muito rápida! Certeza que quer registar outra caixa para o mesmo trabalhador já?")) {
        return;
      }
    }

    setIsProcessing(true);
    
    try {
      await createRecord.mutateAsync({
        data: {
          workerId: activeWorkerId,
          weightGrams: reading.weightGrams,
          unit: "g",
          scaleId: "BAXTRAN-XTA-01",
          rawLine: reading.rawLine,
          timestamp: new Date().toISOString()
        }
      });
      
      beep("success");
      lastRecordTimeRef.current = Date.now();
      refetchRecords();
      
      // Visual flash feedback handled by framer-motion key below
      
    } catch (err) {
      beep("error");
      toast({
        title: "Erro ao registar",
        description: "Verifique a ligação à internet ou tente novamente.",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const isOverload = reading?.status === "OVERLOAD";
  const canWeigh = activeWorkerId && scaleStatus === "CONNECTED" && reading?.status === "STABLE" && reading.weightGrams > 0;

  return (
    <Layout>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
        
        {/* Worker Identification Section */}
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
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border"></div></div>
                    <div className="relative flex justify-center"><span className="bg-card px-4 text-xs text-muted-foreground font-medium uppercase">OU</span></div>
                  </div>
                  
                  <form onSubmit={handleManualSubmit} className="flex gap-2">
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
                    <div className="absolute inset-0 bg-primary/10 animate-pulse"></div>
                  </div>
                  
                  <button 
                    onClick={() => setShowScanner(false)}
                    className="absolute top-4 right-4 bg-black/50 text-white p-2 rounded-full backdrop-blur-md z-20"
                  >
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
              <button 
                onClick={() => setActiveWorkerId(null)}
                className="bg-white/10 hover:bg-white/20 p-3 rounded-full transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          )}
        </div>

        {/* Live Scale Display */}
        <div className="bg-card rounded-2xl shadow-sm border border-border p-6 text-center relative overflow-hidden">
          {scaleStatus === "DISCONNECTED" && (
             <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center">
               <Scale className="w-12 h-12 text-muted-foreground mb-3" />
               <p className="font-medium text-muted-foreground">Balança Desconectada</p>
             </div>
          )}

          <div className="flex justify-between items-center mb-6">
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
            <div className="py-6">
              <div className={`text-7xl sm:text-8xl font-display font-black tracking-tighter transition-colors duration-300 ${
                reading?.status === "STABLE" ? "text-foreground" : "text-muted-foreground"
              }`}>
                {reading ? reading.weightGrams : "0"} <span className="text-3xl text-muted-foreground ml-1">g</span>
              </div>
            </div>
          )}
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
          {isProcessing ? "A REGISTAR..." : "REGISTAR PESAGEM"}
        </button>

        {/* Today's History for Worker */}
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
                      animate={{ opacity: 1, height: 'auto', y: 0 }}
                      className="flex items-center justify-between p-4 bg-background border border-border rounded-xl"
                    >
                      <div>
                        <p className="font-mono text-xl font-bold text-foreground">{record.weightGrams} g</p>
                        <p className="text-xs text-muted-foreground">{format(new Date(record.timestamp), "HH:mm:ss")}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-bold text-success bg-success/10 px-2 py-1 rounded">OK</span>
                        {/* Note: In a real app we'd have a delete mutation here */}
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
