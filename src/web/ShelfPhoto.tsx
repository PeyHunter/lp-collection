import type { ReactNode, Ref } from "react";
import type { PhotoPoint, ShelfCorners } from "../server/schema.ts";
import { perspective, sectionLabel, sectionQuads } from "./shelf-grid.ts";

export type ShelfImage = { url: string; width: number; height: number };

type Props = {
  photo: ShelfImage;
  corners: ShelfCorners;
  columns: number;
  rows: number;
  labels?: boolean;
  label: string;
  frameRef?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

const distance = (a: PhotoPoint, b: PhotoPoint) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The Shelf photo with its Sections drawn over it. The SVG's viewBox is the photo's own pixel size,
 * so the drawn squares stay on the photo at any screen size.
 */
export function ShelfPhoto({ photo, corners, columns, rows, labels = true, label, frameRef, children }: Props) {
  const { width, height } = photo;
  const inPixels = ({ x, y }: PhotoPoint) => ({ x: x * width, y: y * height });
  const points = (quad: readonly PhotoPoint[]) => quad.map((point) => `${point.x * width},${point.y * height}`).join(" ");
  const middle = perspective(corners);

  return (
    <div className="shelf-photo" ref={frameRef} style={{ aspectRatio: `${width} / ${height}` }}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
        <image href={photo.url} width={width} height={height} />
        {sectionQuads(corners, columns, rows).map((quad) => {
          const [a, b, , d] = quad.points.map(inPixels) as [PhotoPoint, PhotoPoint, PhotoPoint, PhotoPoint];
          const center = inPixels(middle({ x: (quad.column - 0.5) / columns, y: (quad.row - 0.5) / rows }));
          const size = Math.min(distance(a, b), distance(a, d)) * 0.32;
          return (
            <g key={`${quad.column},${quad.row}`} className="cell">
              <polygon points={points(quad.points)} />
              {labels && (
                <text x={center.x} y={center.y} fontSize={size} textAnchor="middle" dominantBaseline="central">
                  {sectionLabel(quad.column, quad.row)}
                </text>
              )}
            </g>
          );
        })}
        <polygon className="outline" points={points(corners)} />
      </svg>
      {children}
    </div>
  );
}
