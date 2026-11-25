/** SVG materials share the existing chart coordinates; the front face remains the measured value. */
export function ReadingChartMaterial({ id }: { id: string }) {
  return <defs>
    {(['copper', 'patina'] as const).map((tone, index) => {
      const color = `var(--chart-${index ? 3 : 1})`;
      return <linearGradient key={tone} id={`${id}-${tone}`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor={`color-mix(in srgb, ${color} 65%, var(--atelier-chart-highlight))`} />
        <stop offset="0.3" stopColor={color} />
        <stop offset="0.76" stopColor={`color-mix(in srgb, ${color} 90%, var(--atelier-chart-highlight))`} />
        <stop offset="1" stopColor={`color-mix(in srgb, ${color} 72%, var(--foreground))`} />
      </linearGradient>;
    })}
    <linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="var(--chart-1)" stopOpacity="0.22" />
      <stop offset="1" stopColor="var(--chart-1)" stopOpacity="0.02" />
    </linearGradient>
    <radialGradient id={`${id}-bead`} cx="30%" cy="24%" r="80%">
      <stop offset="0" stopColor="var(--atelier-chart-highlight)" />
      <stop offset="0.28" stopColor="var(--chart-2)" />
      <stop offset="0.65" stopColor="var(--chart-1)" />
      <stop offset="1" stopColor="var(--foreground)" />
    </radialGradient>
    <filter id={`${id}-shadow`} x="-12%" y="-12%" width="130%" height="140%" colorInterpolationFilters="sRGB">
      <feDropShadow dx="1.8" dy="2.2" stdDeviation="1.2" floodColor="var(--atelier-chart-shadow)" />
    </filter>
  </defs>;
}

export function ReadingChartPrism({ id, x, y, width, height, depth, tone = 'copper', hollow = false }: {
  id: string; x: number; y: number; width: number; height: number; depth: number; tone?: 'copper' | 'patina'; hollow?: boolean;
}) {
  if (height <= 0) return null;
  const d = Math.min(depth, height / 2);
  const color = tone === 'copper' ? 'var(--chart-1)' : 'var(--chart-3)';
  return <g data-chart-prism>
    <path className="reading-chart-depth" d={`M${x + width} ${y} l${d} ${-d} v${height} l${-d} ${d} Z`}
      fill={`color-mix(in srgb, ${color} 68%, var(--foreground))`} />
    <rect data-chart-face x={x} y={y} width={width} height={height} rx="0.6"
      fill={hollow ? 'var(--atelier-chart-well)' : `url(#${id}-${tone})`}
      stroke={hollow ? color : 'none'} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    <path className="reading-chart-depth" d={`M${x} ${y} l${d} ${-d} h${width} l${-d} ${d} Z`}
      fill={`color-mix(in srgb, ${color} 55%, var(--atelier-chart-highlight))`} />
    <path className="reading-chart-depth" d={`M${x + 0.7} ${y + height} V${y + 0.6} H${x + width}`}
      fill="none" stroke="var(--atelier-chart-highlight)" strokeOpacity="0.5" strokeWidth="0.7" vectorEffect="non-scaling-stroke" />
  </g>;
}

export function ReadingChartBead({ id, x, y, radius, active }: { id: string; x: number; y: number; radius: number; active: boolean }) {
  return <g>
    <ellipse className="reading-chart-depth" cx={x + 1} cy={y + 2} rx={radius + 0.8} ry={radius * 0.7} fill="var(--atelier-chart-shadow)" />
    <ellipse cx={x} cy={y} rx={radius} ry={active ? 4 : 2.8} fill={`url(#${id}-bead)`}
      stroke="var(--chart-1)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
  </g>;
}
