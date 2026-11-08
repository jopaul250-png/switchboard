/**
 * Switchboard brand mark — hexagonal interlocking-S.
 * Rendered as currentColor so it adopts its parent's text color;
 * add `glow` for the violet bloom used on dark surfaces.
 *
 * Geometry notes (viewBox 0 0 120 120):
 * - Hexagon: N(60,10) NE(105,35) SE(105,85) S(60,110) SW(15,85) NW(15,35)
 * - Top band hugs NW→N→NE and steps off the right edge below y=58
 * - Bottom band mirrors on the lower right, stepping off above y=70
 * - Floating "connector pins" sit in the gaps on the left/right edges
 * - Middle slab runs down-right with a rounded hook (the S spine)
 */
export default function BrandLogo({ className = "h-9 w-9", glow = false }) {
  return (
    <svg
      viewBox="0 0 120 120"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Switchboard"
      style={
        glow
          ? { filter: "drop-shadow(0 0 7px rgba(167,139,250,0.55))" }
          : undefined
      }
    >
      <g fill="currentColor">
        {/* top band */}
        <path d="M15 50 L15 35 L60 10 L105 35 L105 58 L92 58 L92 45 L60 27 L28 45 L28 50 Z" />
        {/* bottom band */}
        <path d="M15 70 L15 85 L60 110 L105 85 L105 70 L92 70 L92 75 L60 93 L28 75 L28 70 Z" />
        {/* left connector pin (gap y50–70) */}
        <path d="M15 57 L21 57 L21 63 L15 63 Z" />
        {/* right connector pin (gap y58–70) */}
        <path d="M105 60 L99 60 L99 65 L105 65 Z" />
      </g>
      {/* middle slab with rounded hook */}
      <path
        d="M36 47 L74 64 L74 77"
        stroke="currentColor"
        strokeWidth="14"
        strokeLinecap="butt"
        strokeLinejoin="round"
      />
    </svg>
  );
}
