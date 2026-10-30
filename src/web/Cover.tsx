import { useState } from "react";

export function Cover({ url, className = "cover" }: { url: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <span className={`${className} none`} aria-hidden="true" />;
  return <img className={className} src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}
