import { useEffect, useRef, useCallback, useState } from "react";
import jsQR from "jsqr";

/**
 * Robust QR scanner hook.
 * Uses requestAnimationFrame internally — no setInterval needed by the caller.
 * Tries rear camera first (exact), then ideal, then any.
 */
export function useQRScanner(onScan: (code: string) => void) {
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  const onScanRef = useRef(onScan);

  useEffect(() => { onScanRef.current = onScan; }, [onScan]);

  const scanLoop = useCallback(() => {
    if (!activeRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas && video.readyState >= video.HAVE_ENOUGH_DATA) {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w > 0 && h > 0) {
        // Downscale for performance — 640px wide max
        const scale = Math.min(1, 640 / w);
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "attemptBoth",
          });
          if (code?.data) {
            onScanRef.current(code.data);
            return; // stop loop — caller decides whether to restart
          }
        }
      }
    }
    rafRef.current = requestAnimationFrame(scanLoop);
  }, []);

  const stopScanner = useCallback(() => {
    activeRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsScanning(false);
  }, []);

  const startScanner = useCallback(async () => {
    if (activeRef.current) return;
    setError(null);

    // Try rear camera first (exact), then ideal, then any
    const constraints: MediaStreamConstraints[] = [
      { video: { facingMode: { exact: "environment" } } },
      { video: { facingMode: { ideal: "environment" } } },
      { video: true },
    ];

    let stream: MediaStream | null = null;
    for (const c of constraints) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(c);
        break;
      } catch {
        // try next
      }
    }

    if (!stream) {
      setError("Não foi possível aceder à câmara. Verifique as permissões.");
      return;
    }

    streamRef.current = stream;
    const video = videoRef.current;
    if (!video) { stream.getTracks().forEach(t => t.stop()); return; }

    video.srcObject = stream;
    video.setAttribute("playsinline", "true");
    video.muted = true;

    try {
      await video.play();
    } catch {
      // autoplay blocked — user will see the video anyway on tap
    }

    activeRef.current = true;
    setIsScanning(true);
    rafRef.current = requestAnimationFrame(scanLoop);
  }, [scanLoop]);

  // Cleanup on unmount
  useEffect(() => () => stopScanner(), [stopScanner]);

  return { videoRef, canvasRef, isScanning, error, startScanner, stopScanner };
}
