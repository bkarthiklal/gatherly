import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import { CameraOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * Continuous QR scanning from the rear camera. Browsers only grant camera
 * access on HTTPS or localhost, which is why check-in is tested on the
 * deployed site rather than a LAN address.
 */
export default function QrScanner({
  onScan,
  paused,
}: {
  onScan: (text: string) => void;
  paused: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  const pausedRef = useRef(paused);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onScanRef.current = onScan;
    pausedRef.current = paused;
  });

  useEffect(() => {
    let controls: IScannerControls | undefined;
    let stopped = false;
    const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 150 });

    reader
      .decodeFromConstraints(
        { video: { facingMode: 'environment' } },
        video.current ?? undefined,
        (result) => {
          if (result && !pausedRef.current) onScanRef.current(result.getText());
        },
      )
      .then((c) => {
        if (stopped) c.stop();
        else controls = c;
      })
      .catch((err: unknown) => {
        const name = err instanceof DOMException ? err.name : '';
        setError(
          name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow camera access in your browser settings, or type serials below.'
            : name === 'NotFoundError'
              ? 'No camera found on this device. Type ticket serials below instead.'
              : 'The camera could not be started. Check that this page is served over HTTPS.',
        );
      });

    return () => {
      stopped = true;
      controls?.stop();
    };
  }, []);

  if (error) {
    return (
      <div className="flex aspect-square flex-col items-center justify-center gap-3 rounded-xl bg-slate-900 p-6 text-center text-slate-300">
        <CameraOff className="size-10" aria-hidden />
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="relative aspect-square overflow-hidden rounded-xl bg-slate-900">
      <video ref={video} className="size-full object-cover" muted playsInline />
      <div className="pointer-events-none absolute inset-[15%] rounded-2xl border-4 border-white/70 shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]" />
    </div>
  );
}
