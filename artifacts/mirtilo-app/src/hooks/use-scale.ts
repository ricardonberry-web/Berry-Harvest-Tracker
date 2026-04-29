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
  /** Last raw line/frame received (debug aid). */
  lastRaw: string;
  /** Total bytes received since connection opened. */
  bytesReceived: number;
  /** Timestamp of last byte received (0 if never). */
  lastByteAt: number;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const ScaleContext = createContext<ScaleContextValue | null>(null);

const MIN_GRAMS = -200;          // small negatives possible after tare
const MAX_GRAMS_HARD_LIMIT = 12000; // safety filter for crazy spikes; UI enforces 10000g

/**
 * Try several known Baxtran continuous-output formats. Returns null if no parse.
 *
 * Supported variants:
 *  - XTA / FFN style:        "ST,GS:  +1.2345kg"  /  "US,GS:  +1.2345kg"  /  "ST,NT:  -0.250 kg"
 *  - UF series Format 1:     "S  +001.234 kg"     /  "U  +001.234 kg"     /  "OL    kg"
 *                            (S=stable, U=unstable, O=overload)
 *  - Toledo continuous:      <STX> SWA SWB SWC W W W W W W T T T T T T <CR>
 *  - Generic fallback:       any line containing a number followed by "kg" or "g"
 */
function parseLine(line: string): WeightReading | null {
  const trimmed = line.replace(/\u0000/g, "").trim();
  if (!trimmed) return null;
  const now = Date.now();

  // Overload / underload / battery — multiple spellings
  if (/----/.test(trimmed) || /\b(OL|O-?L|OVER ?LOAD)\b/i.test(trimmed)) {
    return { weightGrams: 0, weightKg: 0, status: "OVERLOAD", rawLine: line, timestamp: now };
  }
  if ((/\bLO\b/i.test(trimmed) || /\bUNDER ?LOAD\b/i.test(trimmed)) && trimmed.includes("-")) {
    return { weightGrams: 0, weightKg: 0, status: "UNDERLOAD", rawLine: line, timestamp: now };
  }
  if (/(ba\s*lo|lo\s*ba|low ?bat)/i.test(trimmed)) {
    return { weightGrams: 0, weightKg: 0, status: "ERROR", rawLine: line, timestamp: now };
  }

  // Variant A: "ST,GS: +1.234 kg" / "US,GS:" / "ST,NT:"
  let m = /(ST|US),\s*(GS|NT)\s*:\s*([+-]?)\s*(\d+\.?\d*)\s*kg/i.exec(trimmed);
  if (m) {
    return buildReading({
      stable: m[1].toUpperCase() === "ST",
      sign: m[3] === "-" ? -1 : 1,
      value: parseFloat(m[4]),
      unit: "kg",
      raw: line,
    });
  }

  // Variant B: UF-6 Format 1 — leading status letter, then number + unit
  // Examples: "S  +001.234 kg" , "U -000.150 kg" , "S 1.234 kg"
  m = /^([SUOsuoSt])[A-Za-z]?\s+([+-]?)\s*(\d+\.?\d*)\s*(kg|g)\b/i.exec(trimmed);
  if (m) {
    const tag = m[1].toUpperCase();
    if (tag === "O") {
      return { weightGrams: 0, weightKg: 0, status: "OVERLOAD", rawLine: line, timestamp: now };
    }
    return buildReading({
      stable: tag === "S",
      sign: m[2] === "-" ? -1 : 1,
      value: parseFloat(m[3]),
      unit: m[4].toLowerCase() as "kg" | "g",
      raw: line,
    });
  }

  // Variant C: Toledo continuous frame — "<STX>SWA SWB SWC WWWWWW TTTTTT<CR>"
  // Look for STX (0x02) and 6-digit weight that follows the 3 status bytes.
  // After we strip control chars in `trimmed`, all that remains visible is letters+digits.
  // Match: 3 ASCII chars, then 6 digits (weight), then 6 digits (tare).
  m = /^([A-Za-z0-9?@])([A-Za-z0-9?@])([A-Za-z0-9?@])(\d{6})(\d{6})$/.exec(trimmed);
  if (m) {
    const swa = m[1].charCodeAt(0);
    // Toledo: SWA bit5 = decimal position; SWB bit0 = stable (1 = unstable for some, 0 for others)
    const decPos = swa & 0b00000111;     // 0–6
    const weightInt = parseInt(m[4], 10);
    const swb = m[2].charCodeAt(0);
    const isUnstable = (swb & 0b00000001) === 1;
    const isNeg = (swb & 0b00000010) === 0b00000010;
    const value = weightInt / Math.pow(10, decPos);
    return buildReading({
      stable: !isUnstable,
      sign: isNeg ? -1 : 1,
      value,
      unit: "kg",
      raw: line,
    });
  }

  // Variant D — ultra-permissive fallback: first number with optional sign
  // and optional unit (kg/g). Assume kg if unit absent OR if value < 100 with decimal.
  m = /([+-]?)\s*(\d{1,5}\.?\d{0,4})\s*(kg|g)?\b/i.exec(trimmed);
  if (m && m[2]) {
    const value = parseFloat(m[2]);
    if (Number.isFinite(value) && value > 0) {
      // Heuristic for unit: explicit 'g' (not preceded by 'k') => grams. Otherwise kg.
      const unit: "kg" | "g" = m[3]?.toLowerCase() === "g" ? "g" : "kg";
      return buildReading({
        stable: true, // assume stable when unknown
        sign: m[1] === "-" ? -1 : 1,
        value,
        unit,
        raw: line,
      });
    }
  }

  return null;
}

function buildReading(opts: {
  stable: boolean;
  sign: 1 | -1;
  value: number;
  unit: "kg" | "g";
  raw: string;
}): WeightReading | null {
  if (!Number.isFinite(opts.value)) return null;
  const grams = Math.round((opts.unit === "kg" ? opts.value * 1000 : opts.value) * opts.sign);
  if (grams < MIN_GRAMS || grams > MAX_GRAMS_HARD_LIMIT) return null;
  return {
    weightGrams: grams,
    weightKg: grams / 1000,
    status: opts.stable ? "STABLE" : "UNSTABLE",
    rawLine: opts.raw,
    timestamp: Date.now(),
  };
}

export function ScaleProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ScaleStatus>("DISCONNECTED");
  const [reading, setReading] = useState<WeightReading | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRaw, setLastRaw] = useState<string>("");
  const [bytesReceived, setBytesReceived] = useState<number>(0);
  const [lastByteAt, setLastByteAt] = useState<number>(0);

  const portRef = useRef<any>(null);
  const readerRef = useRef<any>(null);
  const keepReadingRef = useRef(true);
  const lastParseAtRef = useRef<number>(0);

  // Watchdog: when no new valid weight has arrived for >2s while connected,
  // reset display to 0 g. Handles scales that auto-blank at zero or that
  // emit a frame variant we don't recognise yet.
  useEffect(() => {
    if (status !== "CONNECTED") return;
    const id = setInterval(() => {
      const silentFor = Date.now() - lastParseAtRef.current;
      if (silentFor > 2000) {
        setReading(prev => {
          if (prev && prev.weightGrams === 0 && prev.status === "STABLE") return prev;
          return {
            weightGrams: 0,
            weightKg: 0,
            status: "STABLE",
            rawLine: prev?.rawLine ?? "",
            timestamp: Date.now(),
          };
        });
      }
    }, 500);
    return () => clearInterval(id);
  }, [status]);

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
        if (!value) continue;

        // Track bytes for diagnostics
        setBytesReceived(prev => prev + value.length);
        setLastByteAt(Date.now());

        buffer += value;

        // Split on any combination of CR, LF, STX (0x02) or ETX (0x03).
        // Then trim each part. Keep the last partial chunk in the buffer.
        const parts = buffer.split(/[\r\n\u0002\u0003]+/);
        for (let i = 0; i < parts.length - 1; i++) {
          const raw = parts[i];
          if (!raw) continue;
          // Always log + expose so user can debug unknown formats
          console.log("[Scale] line:", JSON.stringify(raw));
          setLastRaw(raw);
          const parsed = parseLine(raw);
          if (parsed) {
            lastParseAtRef.current = Date.now();
            setReading(parsed);
          }
        }
        buffer = parts[parts.length - 1] ?? "";

        // Fallback: some formats only send CR or no terminator at all.
        // If buffer accumulated for >300ms with no terminator, try to parse it as-is.
        if (buffer.length > 200) {
          console.log("[Scale] flushing buffer:", JSON.stringify(buffer));
          setLastRaw(buffer);
          const parsed = parseLine(buffer);
          if (parsed) {
            lastParseAtRef.current = Date.now();
            setReading(parsed);
          }
          buffer = "";
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

      // Some Bluetooth-Serial bridges (e.g. SH-B30) do NOT start
      // forwarding bytes until DTR/RTS are asserted. Set both high.
      try {
        await port.setSignals({ dataTerminalReady: true, requestToSend: true });
      } catch (sigErr) {
        console.warn("[Scale] setSignals not supported / failed:", sigErr);
      }

      portRef.current = port;
      keepReadingRef.current = true;
      lastParseAtRef.current = Date.now();
      setBytesReceived(0);
      setLastByteAt(0);
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
    setLastRaw("");
    setBytesReceived(0);
    setLastByteAt(0);
  }, []);

  useEffect(() => {
    return () => {
      keepReadingRef.current = false;
      if (readerRef.current) { try { readerRef.current.cancel(); } catch {} }
      if (portRef.current) { try { portRef.current.close(); } catch {} }
    };
  }, []);

  const value: ScaleContextValue = { status, reading, error, lastRaw, bytesReceived, lastByteAt, connect, disconnect };
  return createElement(ScaleContext.Provider, { value }, children);
}

export function useScale(): ScaleContextValue {
  const ctx = useContext(ScaleContext);
  if (!ctx) {
    throw new Error("useScale deve ser usado dentro de <ScaleProvider>");
  }
  return ctx;
}
