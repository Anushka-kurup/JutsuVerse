import { useEffect, useRef, useState } from "react";
import type { Edge, Sign } from "@jutsu/protocol";
import type { InputAdapter } from "../input/adapter.ts";
import { createGestureAdapter } from "../input/gestureAdapter.ts";
import {
  initHandLandmarker,
  startCamera,
  stopCamera,
} from "../input/handTracker.ts";

export function CameraStage({
  onEdge,
}: {
  onEdge: (sign: Sign, edge: Edge) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const adapterRef = useRef<InputAdapter | null>(null);
  const onEdgeRef = useRef(onEdge);
  onEdgeRef.current = onEdge;

  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("—");
  const [error, setError] = useState<string | null>(null);

  const shutdown = () => {
    adapterRef.current?.stop();
    adapterRef.current = null;
    const video = videoRef.current;
    if (video) stopCamera(video);
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    setOn(false);
    setLabel("—");
  };

  useEffect(() => {
    return () => {
      adapterRef.current?.stop();
      adapterRef.current = null;
      const video = videoRef.current;
      if (video) stopCamera(video);
    };
    // refs are stable; this is unmount-only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = async () => {
    if (on) {
      shutdown();
      return;
    }
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    setBusy(true);
    setError(null);
    try {
      await initHandLandmarker();
      await startCamera(video);
      const adapter = createGestureAdapter({
        video,
        canvas,
        onLabel: setLabel,
      });
      adapter.start(({ sign, edge }) => onEdgeRef.current(sign, edge));
      adapterRef.current = adapter;
      setOn(true);
    } catch (err) {
      console.error(err);
      stopCamera(video);
      setError("Couldn't access the camera. Check permissions and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="camera-stage">
      <div className="camera-box">
        <video ref={videoRef} autoPlay playsInline muted />
        <canvas ref={canvasRef} width={480} height={360} />
        <div className="cam-sign">{label}</div>
        <div className="cam-label">You</div>
      </div>
      <button
        type="button"
        className={`cam-btn ${on ? "active" : ""}`}
        onClick={() => void toggle()}
        disabled={busy}
      >
        {busy ? "Starting…" : on ? "Disable camera" : "Enable camera"}
      </button>
      {error ? <p className="cam-error">{error}</p> : null}
    </section>
  );
}
