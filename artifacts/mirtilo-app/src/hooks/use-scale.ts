import { useState, useEffect, useCallback, useRef } from "react";

export type ScaleStatus = "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "ERROR";
export type WeightStatus = "STABLE" | "UNSTABLE" | "OVERLOAD" | "UNDERLOAD" | "ERROR" | "READING";

export interface WeightReading {
  weightGrams: number;
  weightKg: number;
  status: WeightStatus;
  rawLine: string;
  timestamp: number;
}

export function useScale() {
  const [status, setStatus] = useState<ScaleStatus>("DISCONNECTED");
  const [reading, setReading] = useState<WeightReading | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const portRef = useRef<any>(null);
  const readerRef = useRef<any>(null);
  const keepReadingRef = useRef(true);

  // Regex based on Baxtran XTA manual: "ST,GS: + 1.2345kg\r\n"
  const PARSER_REGEX = /^ST,GS:\s*(-?)\s*([+-]?)\s*(\d+\.?\d*)\s*kg/i;

  const parseLine = useCallback((line: string): WeightReading | null => {
    const trimmed = line.trim();
    if (!trimmed) return null;

    // Overload checks
    if (trimmed.includes("----") || trimmed.toLowerCase().includes("ol")) {
      return { weightGrams: 0, weightKg: 0, status: "OVERLOAD", rawLine: line, timestamp: Date.now() };
    }
    
    // Underload
    if (trimmed.toLowerCase().includes("lo") && trimmed.includes("-")) {
      return { weightGrams: 0, weightKg: 0, status: "UNDERLOAD", rawLine: line, timestamp: Date.now() };
    }

    // Battery low
    if (trimmed.toLowerCase().includes("ba lo") || trimmed.toLowerCase().includes("lo ba")) {
       return { weightGrams: 0, weightKg: 0, status: "ERROR", rawLine: line, timestamp: Date.now() };
    }

    const match = PARSER_REGEX.exec(trimmed);
    if (match) {
      const isTare = match[1] === "-";
      const sign = match[2] === "-" ? -1 : 1;
      const rawKg = parseFloat(match[3]);
      
      if (isNaN(rawKg)) return null;

      const finalKg = rawKg * sign;
      const finalGrams = Math.round(finalKg * 1000);

      // Blueberry harvest bounds check (ignore crazy spikes)
      if (finalGrams < -100 || finalGrams > 6000) return null;

      return {
        weightKg: finalKg,
        weightGrams: finalGrams,
        status: isTare ? "STABLE" : "STABLE", // If in StC mode, all valid parses are stable
        rawLine: line,
        timestamp: Date.now()
      };
    }

    return null;
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
      setStatus("CONNECTED");
      keepReadingRef.current = true;

      // Start reading loop
      readLoop(port);

    } catch (err: any) {
      console.error("[Scale] Connection error:", err);
      setStatus("DISCONNECTED");
      setError(err.message || "Falha ao conectar à balança.");
    }
  }, []);

  const readLoop = async (port: any) => {
    // @ts-ignore
    const textDecoder = new TextDecoderStream();
    const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
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
          
          // Process all complete lines
          for (let i = 0; i < lines.length - 1; i++) {
            const parsed = parseLine(lines[i]);
            if (parsed) {
              setReading(parsed);
            }
          }
          // Keep incomplete line in buffer
          buffer = lines[lines.length - 1];
        }
      }
    } catch (error: any) {
      console.error("[Scale] Read loop error:", error);
      setError("Erro de leitura serial. Verifique o cabo.");
      setStatus("ERROR");
    } finally {
      reader.releaseLock();
    }
  };

  const disconnect = useCallback(async () => {
    keepReadingRef.current = false;
    
    if (readerRef.current) {
      await readerRef.current.cancel();
      readerRef.current = null;
    }
    
    if (portRef.current) {
      try {
        await portRef.current.close();
      } catch (err) {
        console.error("Error closing port:", err);
      }
      portRef.current = null;
    }
    
    setStatus("DISCONNECTED");
    setReading(null);
  }, []);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    status,
    reading,
    error,
    connect,
    disconnect
  };
}
