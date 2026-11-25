import { BAND_STYLE, percent, type Band, type Tally } from "@/lib/attendance";

/** Ring fills to attended/held in the band colour; a tick marks the target. The band is also given in words. */
export function Donut({ tally, band, target, size = 120 }: { tally: Tally; band: Band; target: number; size?: number }) {
  const pct = percent(tally);
  const stroke = size * 0.1;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const fill = tally.held ? tally.attended / tally.held : 0;
  const angle = (target / 100) * 2 * Math.PI - Math.PI / 2;
  const cx = size / 2;
  const tick = (k: number) => [cx + Math.cos(angle) * (r + k), cx + Math.sin(angle) * (r + k)];
  // A notch across the ring only, so it never reads as a minus sign next to the number.
  const [x1, y1] = tick(-stroke / 2);
  const [x2, y2] = tick(stroke / 2 + 3);
  const color = BAND_STYLE[band].color;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={`${pct ?? 0}% attendance, ${BAND_STYLE[band].label}`}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--color-line)" strokeWidth={stroke} />
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap={fill > 0 && fill < 1 ? "round" : "butt"}
          strokeDasharray={`${fill * c} ${c}`}
          transform={`rotate(-90 ${cx} ${cx})`}
        />
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-ink)" strokeWidth={2.5} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center leading-tight">
        <div>
          <div className="font-extrabold" style={{ fontSize: size * 0.2 }}>
            {pct === null ? "—" : `${pct.toFixed(1)}%`}
          </div>
          <div className="text-muted" style={{ fontSize: Math.max(10, size * 0.1) }}>
            {tally.attended} of {tally.held}
          </div>
        </div>
      </div>
    </div>
  );
}

export function BandPill({ band }: { band: Band }) {
  const s = BAND_STYLE[band];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: `${s.color}17`, color: s.text }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
      {s.label}
    </span>
  );
}
