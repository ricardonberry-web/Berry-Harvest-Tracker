import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Scale, Trophy, Users, Usb } from "lucide-react";
import { useScale } from "@/hooks/use-scale";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { status, error, connect, disconnect } = useScale();

  const isConnected = status === "CONNECTED";
  const isConnecting = status === "CONNECTING";

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Top Status Bar */}
      <header className={`px-4 py-3 flex items-center justify-between shadow-sm z-40 transition-colors duration-500 ${
        isConnected ? 'bg-success/10 border-b border-success/20' : 
        status === 'ERROR' ? 'bg-destructive/10 border-b border-destructive/20' : 
        'bg-card border-b border-border'
      }`}>
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${isConnected ? 'bg-success/20 text-success' : 'bg-muted text-muted-foreground'}`}>
            <Usb className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-display font-bold text-foreground leading-tight">MirtiloTrack</h1>
            <p className={`text-xs font-medium ${
              isConnected ? 'text-success' : 
              status === 'ERROR' ? 'text-destructive' : 
              'text-muted-foreground'
            }`}>
              {isConnected ? 'Balança Conectada' : 
               isConnecting ? 'A conectar...' : 
               status === 'ERROR' ? (error || 'Erro na balança') : 
               'Balança Desconectada'}
            </p>
          </div>
        </div>

        <button
          onClick={isConnected ? disconnect : connect}
          className={`px-4 py-2 text-sm font-bold rounded-lg transition-all ${
            isConnected 
              ? 'bg-background border-2 border-border text-foreground hover:bg-muted' 
              : 'bg-primary text-primary-foreground shadow-md hover:shadow-lg hover:-translate-y-0.5'
          }`}
        >
          {isConnected ? 'Desligar' : 'Ligar Balança'}
        </button>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto pb-24 relative">
        {children}
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-card/80 backdrop-blur-xl border-t border-border z-40 pb-safe">
        <div className="max-w-md mx-auto flex justify-around p-2">
          <NavItem href="/" icon={<Scale />} label="Pesar" active={location === "/"} />
          <NavItem href="/ranking" icon={<Trophy />} label="Ranking" active={location === "/ranking"} />
          <NavItem href="/workers" icon={<Users />} label="Trabalhadores" active={location === "/workers"} />
        </div>
      </nav>
    </div>
  );
}

function NavItem({ href, icon, label, active }: { href: string; icon: ReactNode; label: string; active: boolean }) {
  return (
    <Link href={href} className={`flex flex-col items-center justify-center w-full py-2 px-1 rounded-xl transition-all duration-200 ${
      active ? 'text-primary' : 'text-muted-foreground hover:bg-muted/50'
    }`}>
      <div className={`mb-1 transition-transform duration-300 ${active ? 'scale-110' : ''}`}>
        {icon}
      </div>
      <span className={`text-[10px] font-bold ${active ? 'opacity-100' : 'opacity-70'}`}>{label}</span>
    </Link>
  );
}
