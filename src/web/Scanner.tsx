import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

type Blocked = "denied" | "missing" | "unsupported" | "failed" | "unreadable";

type Camera = { kind: "starting" } | { kind: "on" } | { kind: "read"; barcode: string } | { kind: "blocked"; reason: Blocked };

const blocked: Record<Blocked, { message: string; retry: boolean }> = {
  denied: {
    message: "LP-Collection isn't allowed to use the camera. Type the barcode below instead. To scan, allow the camera for LP-Collection in your phone's Settings, then try again.",
    retry: true,
  },
  missing: { message: "This phone has no camera LP-Collection can use. Type the barcode below instead.", retry: false },
  unsupported: { message: "This browser can't open the camera here. Type the barcode below instead.", retry: false },
  failed: { message: "The camera didn't start. Another app may be using it. Type the barcode below instead, or try again.", retry: true },
  unreadable: { message: "Scanning failed on this phone. Type the barcode below instead, or try again.", retry: true },
};

function blockedReason(error: unknown): Blocked {
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) return "denied";
  if (error instanceof DOMException && (error.name === "NotFoundError" || error.name === "OverconstrainedError")) return "missing";
  return "failed";
}

async function loadReader() {
  const [{ prepareZXingModule }, reader] = await Promise.all([import("zxing-wasm/reader"), import("./decode-barcode.ts")]);
  await prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) }, fireImmediately: true });
  return reader;
}

const restBetweenDecodesMs = 150;

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextFrame(video: HTMLVideoElement) {
  return new Promise<void>((resolve) => video.requestVideoFrameCallback(() => resolve()));
}

function subscribeToVisibility(listener: () => void) {
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
}

export function Scanner({ onRead }: { onRead: (barcode: string) => void }) {
  const [camera, setCamera] = useState<Camera>({ kind: "starting" });
  const visible = useSyncExternalStore(subscribeToVisibility, () => document.visibilityState === "visible");
  const video = useRef<HTMLVideoElement>(null);
  const reported = useRef(onRead);
  reported.current = onRead;
  const scanning = (camera.kind === "starting" || camera.kind === "on") && visible;

  useEffect(() => {
    if (!scanning) return;
    const element = video.current!;
    let stopped = false;
    let stream: MediaStream | undefined;
    let cameraOn = false;

    async function scan() {
      if (!navigator.mediaDevices?.getUserMedia) return setCamera({ kind: "blocked", reason: "unsupported" });
      const reader = loadReader();
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
      } catch (error) {
        if (!stopped) setCamera({ kind: "blocked", reason: blockedReason(error) });
        return;
      }
      if (stopped) return stream.getTracks().forEach((track) => track.stop());
      element.srcObject = stream;
      await element.play();
      cameraOn = true;
      setCamera({ kind: "on" });

      const { createReader, scanArea, thresholds } = await reader;
      const read = createReader();
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      for (let attempt = 0; ; attempt++) {
        await nextFrame(element);
        if (stopped) return;
        const area = scanArea(element.videoWidth, element.videoHeight);
        if (canvas.width !== area.toWidth || canvas.height !== area.toHeight) {
          canvas.width = area.toWidth;
          canvas.height = area.toHeight;
        }
        context.drawImage(element, area.x, area.y, area.width, area.height, 0, 0, area.toWidth, area.toHeight);
        const frame = context.getImageData(0, 0, area.toWidth, area.toHeight);
        await pause(0); // decode in a task of its own, so the grab and the decode each hold the screen up half as long
        const barcode = await read(frame, thresholds[attempt % thresholds.length]!);
        if (stopped) return;
        if (barcode) {
          setCamera({ kind: "read", barcode });
          return reported.current(barcode);
        }
        await pause(restBetweenDecodesMs);
      }
    }

    scan().catch((error: unknown) => {
      console.error(error);
      if (!stopped) setCamera({ kind: "blocked", reason: cameraOn ? "unreadable" : "failed" });
    });
    return () => {
      stopped = true;
      stream?.getTracks().forEach((track) => track.stop());
      element.srcObject = null;
    };
  }, [scanning]);

  return (
    <section className="section" aria-labelledby="scan-heading">
      <div className="section-head">
        <h2 id="scan-heading">Scan the barcode</h2>
        {camera.kind === "on" && <span className="count">Camera on</span>}
      </div>
      {camera.kind === "blocked" ? (
        <div className="notice" role="status">
          <p>{blocked[camera.reason].message}</p>
          {blocked[camera.reason].retry && (
            <button className="btn quiet" type="button" onClick={() => setCamera({ kind: "starting" })}>
              Try the camera again
            </button>
          )}
        </div>
      ) : camera.kind === "read" ? (
        <div className="scan-read">
          <p role="status">
            Read <span className="tnum">{camera.barcode}</span>
          </p>
          <button className="btn quiet" type="button" onClick={() => setCamera({ kind: "starting" })}>
            Scan another
          </button>
        </div>
      ) : (
        <div className="viewfinder">
          <video ref={video} muted playsInline aria-label="Camera view" />
          <span className="frame" aria-hidden="true" />
          <span className="viewfinder-hint">{camera.kind === "on" ? "Hold the barcode inside the frame" : "Starting the camera…"}</span>
        </div>
      )}
    </section>
  );
}
