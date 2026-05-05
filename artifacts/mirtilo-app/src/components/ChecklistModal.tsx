import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, AlertTriangle, ShieldCheck } from "lucide-react";

export function ChecklistModal() {
  const [isOpen, setIsOpen] = useState(false);
  
  // Tasks state
  const [tasks, setTasks] = useState([
    { id: "t1", label: "Balança ligada e estável (aguardar 30s)", checked: false, section: "MANHÃ" },
    { id: "t4", label: "Tare feita com recipiente vazio", checked: false, section: "MANHÃ" },
    { id: "e1", label: "Cabo USB-OTG bem ligado", checked: false, section: "EQUIPAMENTO" }
  ]);

  // Check if shown today
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    const lastChecked = localStorage.getItem('mirtilo_checklist_date');
    if (lastChecked !== today) {
      setIsOpen(true);
    }
  }, []);

  const toggleTask = (id: string) => {
    setTasks(tasks.map(t => t.id === id ? { ...t, checked: !t.checked } : t));
  };

  const allChecked = tasks.every(t => t.checked);

  const handleComplete = () => {
    if (!allChecked) return;
    const today = new Date().toISOString().split('T')[0];
    localStorage.setItem('mirtilo_checklist_date', today);
    setIsOpen(false);
  };

  if (!isOpen) return null;

  const manhaTasks = tasks.filter(t => t.section === "MANHÃ");
  const equipTasks = tasks.filter(t => t.section === "EQUIPAMENTO");

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="bg-card w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        >
          <div className="bg-primary p-6 text-primary-foreground text-center relative overflow-hidden">
            <ShieldCheck className="w-16 h-16 mx-auto opacity-20 absolute -right-4 -top-4" />
            <h2 className="text-2xl font-display font-bold relative z-10">Verificação Diária</h2>
            <p className="text-primary-foreground/80 mt-1 relative z-10">
              Obrigatório antes de iniciar a colheita
            </p>
          </div>

          <div className="p-6 overflow-y-auto flex-1 space-y-6">
            {!allChecked && (
              <div className="bg-warning/10 border border-warning/20 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
                <p className="text-sm text-foreground">
                  Confirme fisicamente cada item no local. A precisão dos dados depende desta calibração.
                </p>
              </div>
            )}

            <div>
              <h3 className="text-xs font-bold tracking-wider text-muted-foreground uppercase mb-3">Manhã (Início do dia)</h3>
              <div className="space-y-2">
                {manhaTasks.map(task => (
                  <button
                    key={task.id}
                    onClick={() => toggleTask(task.id)}
                    className={`w-full flex items-center gap-4 p-3 rounded-xl border-2 transition-all duration-200 text-left ${
                      task.checked 
                        ? "bg-success/5 border-success/30" 
                        : "bg-background border-border hover:border-primary/30"
                    }`}
                  >
                    <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 border-2 transition-colors ${
                      task.checked ? "bg-success border-success text-white" : "border-muted-foreground/30 bg-background"
                    }`}>
                      {task.checked && <Check className="w-4 h-4" />}
                    </div>
                    <span className={`text-sm font-medium ${task.checked ? "text-foreground" : "text-foreground/80"}`}>
                      {task.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-xs font-bold tracking-wider text-muted-foreground uppercase mb-3">Equipamento</h3>
              <div className="space-y-2">
                {equipTasks.map(task => (
                  <button
                    key={task.id}
                    onClick={() => toggleTask(task.id)}
                    className={`w-full flex items-center gap-4 p-3 rounded-xl border-2 transition-all duration-200 text-left ${
                      task.checked 
                        ? "bg-success/5 border-success/30" 
                        : "bg-background border-border hover:border-primary/30"
                    }`}
                  >
                    <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 border-2 transition-colors ${
                      task.checked ? "bg-success border-success text-white" : "border-muted-foreground/30 bg-background"
                    }`}>
                      {task.checked && <Check className="w-4 h-4" />}
                    </div>
                    <span className={`text-sm font-medium ${task.checked ? "text-foreground" : "text-foreground/80"}`}>
                      {task.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="p-6 bg-muted/30 border-t border-border mt-auto">
            <button
              onClick={handleComplete}
              disabled={!allChecked}
              className={`w-full py-4 rounded-xl font-bold text-lg transition-all duration-300 shadow-lg ${
                allChecked 
                  ? "bg-primary text-primary-foreground shadow-primary/25 hover:shadow-primary/40 hover:-translate-y-1" 
                  : "bg-muted text-muted-foreground cursor-not-allowed shadow-none"
              }`}
            >
              {allChecked ? "Iniciar Dia de Trabalho" : "Complete todos os passos"}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
