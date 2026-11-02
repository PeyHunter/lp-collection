import { useEffect, useState } from "react";
import type { ImportProgress as Progress } from "../server/discogs-import.ts";

const pollMs = 1_000;

/** While the first-login import runs, how far it has got. When it finishes, the Collection loads again with everything in it. */
export function ImportProgress({ initial, onFinished }: { initial: Progress | null; onFinished: () => void }) {
  const [progress, setProgress] = useState(initial);
  const running = progress?.status === "running";

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(async () => {
      const response = await fetch("/api/me").catch(() => undefined);
      if (!response?.ok) return;
      const { discogsImport } = (await response.json()) as { discogsImport: Progress | null };
      setProgress(discogsImport);
      if (discogsImport?.status !== "running") onFinished();
    }, pollMs);
    return () => clearInterval(timer);
  }, [running, onFinished]);

  // Nothing shows for an empty Discogs collection, or before the first page says how much there is.
  if (!running || !progress.total) return null;
  return (
    <p className="notice import-progress" aria-live="polite">
      Importing your Discogs collection…{" "}
      <b className="tnum">
        {progress.imported} of {progress.total}
      </b>
    </p>
  );
}
