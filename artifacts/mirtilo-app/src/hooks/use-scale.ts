import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export type ScaleStatus = "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "ERROR";
export type WeightStatus = "STABLE" | "UNSTABLE" | "OVERLOAD" | "UNDERLOAD" | "ERROR" | "READING";

export interface WeightReading {
  weightGrams: number;
  weightKg: number;
  status: WeightStatus;
  rawLine: string;
  timestamp: number;
}

interface ScaleContextValue {
  status: ScaleStatus;
  reading: WeightReading | null;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const ScaleContext = createContext<ScaleContextValue | null>(null);

// Baxtran XTA-style frames examples:
//   "ST,GS:  +1.2345kg\r\n"  (stable, gross)
//   "US,GS:  +1.2345kg\r\n"  (unstable, gross)
//   "ST,NT:  +1.2345kg\r\n"  (stable, net)
// We accept any 2-char status + 2-char type prefix.
const PARSER_REGEX = /(ST|US),\s*(GS|NT)\s*:\s*([+-]?)\s*(\d+\.?\d*)\s*kg/i;

const MIN_GRAMS = -200;          // small negatives possible after tare
const MAX_GRAMS_HARD_LIMIT = 12000; // safety filter for crazy spikes; UI enforces 10000g

function parseLine(line: string): WeightReading | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Overload: "----" or "OL"
  if (trimmed.includes("----") || /\bOL\b/i.test(trimmed)) {
    return { weightGrams: 0, weightKg: 0, status: "OVERLOAD", rawLine: line, timestamp: Date.now() };
  }
  // Underload: "LO" with negative
  if (/\bLO\b/i.test(trimmed) && trimmed.includes("-")) {
    return { weightGrams: 0, weightKg: 0, status: "UNDERLOAD", rawLine: line, timestamp: Date.now() };
  }
  // Battery low
  if (/(ba\s*lo|lo\s*ba)/i.test(trimmed)) {
    return { weightGrams: 0, weightKg: 0, status: "ERROR", rawLine: line, timestamp: Date.now() };
  }

  const match = PARSER_REGEX.exec(trimmed);
  if (!match) return null;

  const stability = match[1].toUpperCase(); // ST or US
  const sign = match[3] === "-" ? -1 : 1;
  const rawKg = parseFloat(match[4]);
  if (Number.isNaN(rawKg)) return null;

  const finalKg = rawKg * sign;
  const finalGrams = Math.round(finalKg * 1000);

  if (finalGrams < MIN_GRAMS || finalGrams > MAX_GRAMS_HARD_LIMIT) return null;

  return {
    weightKg: finalKg,
    weightGrams: finalGrams,
    status: stability === "ST" ? "STABLE" : "UNSTABLE",
    rawLine: line,
    timestamp: Date.now(),
  };
}

export function ScaleProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ScaleStatus>("DISCONNECTED");
  const [reading, setReading] = useState<WeightReading | null>(null);
  const [error, setError] = useState<string | null>(null);

  const portRef = useRef<any>(null);
  const readerRef = useRef<any>(null);
  const keepReadingRef = useRef(true);

  const readLoop = useCallback(async (port: any) => {
    // @ts-ignore
    const textDecoder = new TextDecoderStream();
    port.readable.pipeTo(textDecoder.writable).catch(() => {});
    const reader = textDecoder.readable.getReader();
    readerRef.current = reader;

    let buffer = "";
    try {
      while (keepReadingRef.current) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          buffer += value;
          const lines = buffer.split(/\r?\n/);
          for (let i = 0; i < lines.length - 1; i++) {
            const parsed = parseLine(lines[i]);
            if (parsed) setReading(parsed);
          }
          buffer = lines[lines.length - 1];
          // Safety: avoid runaway buffer if no newline is ever sent
          if (buffer.length > 4096) buffer = buffer.slice(-1024);
        }
      }
    } catch (err: any) {
      console.error("[Scale] Read loop error:", err);
      setError("Erro de leitura serial. Verifique o cabo.");
      setStatus("ERROR");
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  }, []);

  const connect = useCallback(async () => {
    try {
      if (!("serial" in navigator)) {
        throw new Error("Web Serial API não suportada neste browser (use o Chrome).");
      }
      setStatus("CONNECTING");
      setError(null);

      // @ts-ignore
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 9600, dataBits: 8, stopBits: 1, parity: "none" });

      portRef.current = port;
      keepReadingRef.current = true;
      setStatus("CONNECTED");

      readLoop(port);
    } catch (err: any) {
      console.error("[Scale] Connection error:", err);
      setStatus("DISCONNECTED");
      setError(err?.message || "Falha ao conectar à balança.");
    }
  }, [readLoop]);

  const disconnect = useCallback(async () => {
    keepReadingRef.current = false;
    if (readerRef.current) {
      try { await readerRef.current.cancel(); } catch {}
      readerRef.current = null;
    }
    if (portRef.current) {
      try { await portRef.current.close(); } catch (err) { console.error(err); }
      portRef.current = null;
    }
    setStatus("DISCONNECTED");
    setReading(null);
  }, []);

  useEffect(() => {
    return () => {
      keepReadingRef.current = false;
      if (readerRef.current) { try { readerRef.current.cancel(); } catch {} }
      if (portRef.current) { try { portRef.current.close(); } catch {} }
    };
  }, []);

  const value: ScaleContextValue = { status, reading, error, connect, disconnect };
  return createElement(ScaleContext.Provider, { value }, children);
}

export function useScale(): ScaleContextValue {
  const ctx = useContext(ScaleContext);
  if (!ctx) {
    throw new Error("useScale deve ser usado dentro de <ScaleProvider>");
  }
  return ctx;
}
