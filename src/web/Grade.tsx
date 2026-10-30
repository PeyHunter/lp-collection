import type { SleeveCondition } from "../server/discogs.ts";

export function Grade({ condition }: { condition: SleeveCondition }) {
  const graded = /^(.*) \((.*)\)$/.exec(condition);
  if (!graded) return <>{condition}</>;
  return <abbr title={graded[1]}>{graded[2]}</abbr>;
}
