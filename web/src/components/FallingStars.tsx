/**
 * Crystal stars drifting down behind a footer.
 *
 * Hand-placed rather than randomised, for the same reason as the landing page tiles: the
 * arrangement stays stable between renders instead of reshuffling on every paint. Each entry
 * is [left %, size px, fall duration s, start offset s].
 *
 * The offsets are negative on purpose. A positive delay would leave every star queued above
 * the top edge on first paint, so the footer looks empty for several seconds; a negative one
 * starts the animation part-way through, and the fall is already populated when the page loads.
 */
const STARS: [number, number, number, number][] = [
  [3, 12, 10.0, -0.5],
  [9, 9, 13.0, -6.4],
  [16, 15, 9.0, -3.1],
  [23, 10, 12.5, -8.2],
  [31, 13, 11.0, -1.6],
  [38, 8, 14.0, -10.3],
  [45, 14, 9.5, -4.8],
  [53, 11, 12.0, -7.2],
  [60, 9, 13.5, -2.9],
  [67, 16, 10.0, -5.7],
  [74, 10, 12.0, -9.9],
  [81, 12, 11.5, -3.4],
  [88, 8, 14.5, -12.7],
  [95, 13, 10.5, -6.1],
];

/**
 * `tone` picks the palette: `app` is the muted blue used on the light/dark app footer,
 * `plate` is near-white for the deep blue landing plate, where a blue star would vanish.
 */
export function FallingStars({ tone = 'app' }: { tone?: 'app' | 'plate' }) {
  return (
    <div className={`stars stars-${tone}`} aria-hidden="true">
      {STARS.map(([left, size, duration, delay], i) => (
        <span
          key={i}
          className="star"
          style={{
            left: `${left}%`,
            width: size,
            height: size,
            animationDuration: `${duration}s`,
            animationDelay: `${delay}s`,
          }}
        />
      ))}
    </div>
  );
}
