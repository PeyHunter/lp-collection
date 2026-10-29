import { useState } from "react";

/** A Release's cover from Discogs, or a drawn record when it has none or the image fails to load. */
export function Cover({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <span className="cover none" aria-hidden="true" />;
  return <img className="cover" src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}
