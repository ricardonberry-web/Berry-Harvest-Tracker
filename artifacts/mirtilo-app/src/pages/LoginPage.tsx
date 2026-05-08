import { useState } from "react";
import { supabase } from "@/lib/supabase";

const ACCESS_CODES: Record<string, string> = {
  "ADMIN26": "admin",
  "DML26": "operador1",
  "NF26": "operador2",
};

export default function LoginPage({ onLogin }: { onLogin: (role: string) => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);

  async function handleSubmit() {
    const role = ACCESS_CODES[code.toUpperCase()];
    if (role) {
      await supabase.from("access_logs").insert({ role });
      localStorage.setItem("access_role", role);
      onLogin(role);
    } else {
      setError(true);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="bg-card p-8 rounded-xl shadow-lg w-80 flex flex-col gap-4">
        <h1 className="text-2xl font-bold text-center">Mirtilo App</h1>
        <input
          type="password"
          placeholder="Código de acesso"
          value={code}
          onChange={e => { setCode(e.target.value); setError(false); }}
          onKeyDown={e => e.key === "Enter" && handleSubmit()}
          className="border rounded-lg px-4 py-2 text-center text-lg tracking-widest"
        />
        {error && <p className="text-red-500 text-sm text-center">Código incorreto</p>}
        <button
          onClick={handleSubmit}
          className="bg-primary text-primary-foreground rounded-lg py-2 font-semibold hover:opacity-90"
        >
          Entrar
        </button>
      </div>
    </div>
  );
}
