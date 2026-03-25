import { useState } from "react";
import { Layout } from "@/components/Layout";
import { useListWorkers, useCreateWorker } from "@workspace/api-client-react";
import { Users, Plus, QrCode, Search, UserCheck } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { getListWorkersQueryKey } from "@workspace/api-client-react";

export default function WorkersPage() {
  const [search, setSearch] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [selectedQR, setSelectedQR] = useState<{id: string, name: string} | null>(null);

  const { data: workers = [], isLoading } = useListWorkers();
  const filteredWorkers = workers.filter(w => 
    w.name.toLowerCase().includes(search.toLowerCase()) || 
    w.id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Layout>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Equipa</h1>
            <p className="text-muted-foreground">Gestão de trabalhadores e badges QR</p>
          </div>
          
          <button 
            onClick={() => setIsAddOpen(true)}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-3 rounded-xl font-bold shadow-lg shadow-primary/25 hover:shadow-xl hover:-translate-y-0.5 transition-all"
          >
            <Plus className="w-5 h-5" />
            Adicionar Trabalhador
          </button>
        </div>

        {/* Search */}
        <div className="relative">
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

        {/* Grid */}
        {isLoading ? (
           <div className="flex justify-center p-12">
             <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div>
           </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredWorkers.map(worker => (
              <div key={worker.id} className="bg-card border border-border rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow group flex flex-col">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-bold text-lg text-foreground">{worker.name}</h3>
                    <span className="inline-flex mt-1 items-center gap-1 bg-muted px-2 py-1 rounded text-xs font-mono font-medium text-muted-foreground">
                      <UserCheck className="w-3 h-3" /> {worker.id}
                    </span>
                  </div>
                  <div className={`w-3 h-3 rounded-full ${worker.active ? 'bg-success shadow-[0_0_8px_rgba(0,255,0,0.5)]' : 'bg-destructive'}`} />
                </div>
                
                <div className="mt-auto pt-4 flex gap-2">
                  <button 
                    onClick={() => setSelectedQR({ id: worker.id, name: worker.name })}
                    className="flex-1 flex items-center justify-center gap-2 bg-secondary text-secondary-foreground py-2 rounded-lg font-medium hover:bg-secondary/80 transition-colors"
                  >
                    <QrCode className="w-4 h-4" />
                    Ver Badge
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>

      {/* Add Modal */}
      {isAddOpen && <AddWorkerModal onClose={() => setIsAddOpen(false)} />}
      
      {/* QR Modal */}
      {selectedQR && <QRModal data={selectedQR} onClose={() => setSelectedQR(null)} />}
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
    } catch (err) {
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

function QRModal({ data, onClose }: { data: { id: string, name: string }, onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md" onClick={onClose}>
      <div className="bg-white text-black w-full max-w-sm rounded-3xl p-8 text-center flex flex-col items-center" onClick={e => e.stopPropagation()}>
        <h2 className="text-3xl font-display font-black mb-1">{data.name}</h2>
        <p className="text-gray-500 font-mono text-lg mb-8 tracking-widest">{data.id}</p>
        
        <div className="bg-white p-4 border-4 border-gray-100 rounded-2xl mb-8">
          <QRCodeSVG value={data.id} size={200} level="H" />
        </div>
        
        <button onClick={onClose} className="w-full py-4 bg-gray-100 text-gray-800 font-bold rounded-xl hover:bg-gray-200 transition-colors">
          Fechar
        </button>
      </div>
    </div>
  );
}
