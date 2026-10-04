import type { CSSProperties } from "react";

import { neon } from "../ui/tokens";

/** Native CSS 3D centerpiece (no WebGL, no external assets): a glowing risk "nucleus"
 * inside a gyroscope of meridian/latitude rings, two tilted orbits carrying risk-level
 * satellites, and floating glass data panels in 3D space. `transform-style: preserve-3d`
 * throughout; the outer `.rmis-tilt` layer leans toward the cursor via ui/spotlight.ts.
 * Decorative only (aria-hidden). Styles: ui/spatial.css (.rmis-core*). */
export default function RiskCore3D({ size = 260, className }: { size?: number; className?: string }) {
  const meridians = [0, 30, 60, 90, 120, 150];
  const latitudes = [
    { z: 0, scale: 1 },
    { z: 0.32, scale: 0.86 },
    { z: -0.32, scale: 0.86 },
    { z: 0.6, scale: 0.55 },
    { z: -0.6, scale: 0.55 },
  ];
  const half = size / 2;

  return (
    <div
      className={`rmis-core rmis-tilt${className ? ` ${className}` : ""}`}
      style={{ "--size": `${size}px` } as CSSProperties}
      aria-hidden="true"
    >
      <div className="rmis-core__tilt">
        <div className="rmis-core__float">
          <div className="rmis-core__halo" />

          <div className="rmis-core__spin">
            {meridians.map((deg) => (
              <span key={`m${deg}`} className="rmis-core__ring" style={{ transform: `rotateY(${deg}deg)` }} />
            ))}
            {latitudes.map((l, i) => (
              <span
                key={`l${i}`}
                className="rmis-core__ring rmis-core__ring--lat"
                style={{ transform: `rotateX(90deg) translateZ(${l.z * half}px) scale(${l.scale})` }}
              />
            ))}
          </div>

          <div className="rmis-core__nucleus" />

          <div className="rmis-core__orbit rmis-core__orbit--a">
            <span className="rmis-core__sat" style={{ "--sat": neon.critical } as CSSProperties} />
          </div>
          <div className="rmis-core__orbit rmis-core__orbit--b">
            <span className="rmis-core__sat" style={{ "--sat": neon.cyan } as CSSProperties} />
          </div>

          <span
            className="rmis-core__panel"
            style={{
              insetBlockStart: "4%",
              insetInlineEnd: "-14%",
              transform: `translateZ(${half * 0.7}px) rotateY(-18deg) rotateX(8deg)`,
              "--panel": neon.cyan,
            } as CSSProperties}
          />
          <span
            className="rmis-core__panel"
            style={{
              insetBlockEnd: "6%",
              insetInlineStart: "-16%",
              transform: `translateZ(${half * 0.55}px) rotateY(22deg) rotateX(-6deg)`,
              "--panel": neon.medium,
            } as CSSProperties}
          />
        </div>
      </div>
    </div>
  );
}
