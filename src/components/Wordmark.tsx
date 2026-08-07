/**
 * The mark: scatter resolving into a grid.
 *
 * Which is the product, drawn. A storage unit is the loose shapes on the left
 * and an inventory is the lattice on the right, and the one accent node is the
 * item that has just landed in it.
 *
 * Inline SVG rather than an image file. It stays sharp at every size, costs no
 * request on a phone with one bar of signal, and takes its two colours from
 * the tokens, so the mark can never drift away from the palette around it.
 */

/** Scatter. Denser and larger nearer the grid, thinning to the left. */
const DOTS: readonly [number, number, number][] = [
  [29, 13, 2.4],
  [30, 29, 1.7],
  [25, 22, 2.1],
  [24, 35, 1.5],
  [20, 9, 1.5],
  [19, 18, 2.2],
  [15, 27, 1.3],
  [14, 13, 1.2],
  [10, 22, 1.4],
  [9, 33, 1.1],
  [6, 17, 1.0],
  [21, 41, 1.2],
]

/** A few squares among the dots, so the scatter reads as things, not noise. */
const CHIPS: readonly [number, number, number][] = [
  [26, 5, 3.6],
  [22, 16, 3.4],
  [16, 33, 2.8],
  [12, 8, 2.4],
  [11, 27, 2.2],
]

const COLS = [40, 52, 64]
const ROWS = [12, 24, 36]
const LAST_COL = COLS[2]!
const LAST_ROW = ROWS[2]!

export function Mark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 72 48"
      fill="none"
      role="img"
      aria-label="Clearspace"
    >
      <g fill="currentColor">
        {DOTS.map(([cx, cy, r]) => (
          <circle key={`d${cx}-${cy}`} cx={cx} cy={cy} r={r} />
        ))}
        {CHIPS.map(([x, y, s]) => (
          <rect key={`c${x}-${y}`} x={x} y={y} width={s} height={s} rx="0.4" />
        ))}
      </g>

      {/* The lattice the scatter resolves into. */}
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        {ROWS.map((y) => (
          <line key={`h${y}`} x1={COLS[0]} y1={y} x2={LAST_COL} y2={y} />
        ))}
        {COLS.map((x) => (
          <line key={`v${x}`} x1={x} y1={ROWS[0]} x2={x} y2={LAST_ROW} />
        ))}
      </g>

      <g fill="currentColor">
        {COLS.flatMap((x) =>
          ROWS.map((y) =>
            // The corner node is the accent's, and it is the only one: the
            // item that has just landed in the inventory.
            x === LAST_COL && y === LAST_ROW ? null : (
              <circle key={`n${x}-${y}`} cx={x} cy={y} r="3.4" />
            ),
          ),
        )}
      </g>
      <circle cx={LAST_COL} cy={LAST_ROW} r="3.4" fill="var(--color-accent)" />
    </svg>
  )
}

/**
 * Mark plus name. Lowercase, because that is how the logo sets it; prose
 * elsewhere still calls the app Clearspace.
 */
export function Wordmark() {
  return (
    <span className="wordmark">
      <Mark className="wordmark__mark" />
      <span className="wordmark__text">clearspace</span>
    </span>
  )
}
