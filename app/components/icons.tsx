import type { SVGProps } from "react";

/**
 * SpeedBoost icon set: 20×20 grid, 1.6px rounded strokes, currentColor.
 * Hand-drawn paths so the app has one consistent visual language.
 */
const paths = {
  gauge: (
    <>
      <path d="M3.2 14.5a7.5 7.5 0 1 1 13.6 0" />
      <path d="M10 10.8 13.4 6.6" />
      <circle cx="10" cy="11.2" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  bolt: <path d="M11.2 2.5 4.5 11h4.6l-.9 6.5L15 9h-4.6l.8-6.5Z" />,
  image: (
    <>
      <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.2" />
      <circle cx="7.2" cy="8" r="1.4" />
      <path d="m3.2 14.6 4.2-3.8 3 2.6 2.6-2.2 4.1 3.4" />
    </>
  ),
  code: (
    <>
      <path d="m7 6-4 4 4 4" />
      <path d="m13 6 4 4-4 4" />
      <path d="m11.2 4.5-2.4 11" />
    </>
  ),
  chart: (
    <>
      <path d="M3 3.5v13h14" />
      <path d="m6 12.5 3.2-3.6 2.6 2.2L16 6.2" />
    </>
  ),
  history: (
    <>
      <path d="M3.4 10a6.6 6.6 0 1 0 1.9-4.7" />
      <path d="M3 3.6v3.2h3.2" />
      <path d="M10 6.6V10l2.4 1.6" />
    </>
  ),
  shield: (
    <>
      <path d="M10 2.6 4 4.8v4.6c0 3.8 2.6 6.5 6 8 3.4-1.5 6-4.2 6-8V4.8l-6-2.2Z" />
      <path d="m7.4 10 1.8 1.8 3.5-3.6" />
    </>
  ),
  check: <path d="m4.5 10.5 3.4 3.3 7.6-7.6" />,
  checkCircle: (
    <>
      <circle cx="10" cy="10" r="7.25" />
      <path d="m6.9 10.2 2.2 2.2 4-4.3" />
    </>
  ),
  alert: (
    <>
      <path d="M8.7 3.6 2.6 14.3A1.5 1.5 0 0 0 3.9 16.5h12.2a1.5 1.5 0 0 0 1.3-2.2L11.3 3.6a1.5 1.5 0 0 0-2.6 0Z" />
      <path d="M10 7.6v3.6" />
      <circle cx="10" cy="13.7" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  info: (
    <>
      <circle cx="10" cy="10" r="7.25" />
      <path d="M10 9v4.6" />
      <circle cx="10" cy="6.6" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  x: (
    <>
      <path d="m5.5 5.5 9 9" />
      <path d="m14.5 5.5-9 9" />
    </>
  ),
  external: (
    <>
      <path d="M11.5 3.5h5v5" />
      <path d="m16.3 3.7-7 7" />
      <path d="M14.5 11.5v3.2a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8V7.3a1.8 1.8 0 0 1 1.8-1.8h3.2" />
    </>
  ),
  arrowRight: (
    <>
      <path d="M4 10h12" />
      <path d="m11.5 5.5 4.5 4.5-4.5 4.5" />
    </>
  ),
  arrowUp: (
    <>
      <path d="M10 16V4" />
      <path d="m5.5 8.5 4.5-4.5 4.5 4.5" />
    </>
  ),
  arrowDown: (
    <>
      <path d="M10 4v12" />
      <path d="m5.5 11.5 4.5 4.5 4.5-4.5" />
    </>
  ),
  chevronDown: <path d="m5.5 7.8 4.5 4.5 4.5-4.5" />,
  mobile: (
    <>
      <rect x="5.5" y="2.5" width="9" height="15" rx="2" />
      <path d="M9 14.8h2" />
    </>
  ),
  desktop: (
    <>
      <rect x="2.5" y="3.5" width="15" height="10" rx="1.6" />
      <path d="M7 16.5h6" />
      <path d="M10 13.5v3" />
    </>
  ),
  devices: (
    <>
      <rect x="2.5" y="3.5" width="11" height="8" rx="1.4" />
      <path d="M5 14.5h4" />
      <rect x="12.5" y="7.5" width="5" height="9" rx="1.2" />
    </>
  ),
  settings: (
    <>
      <path d="M3.5 6h7" />
      <path d="M14 6h2.5" />
      <circle cx="12.2" cy="6" r="1.8" />
      <path d="M3.5 14h2.5" />
      <path d="M9.6 14h6.9" />
      <circle cx="7.8" cy="14" r="1.8" />
    </>
  ),
  font: (
    <>
      <path d="m3 16 4.6-12h.8L13 16" />
      <path d="M4.8 11.8h6.4" />
      <path d="M14.5 9.5c.4-.7 1.1-1 1.9-1 1.1 0 1.8.7 1.8 1.8V16" />
      <path d="M18.2 12.6c-2.6 0-3.9.7-3.9 1.9 0 .9.7 1.5 1.6 1.5 1.3 0 2.3-1 2.3-2.4" />
    </>
  ),
  cursor: (
    <>
      <path d="m4.5 3.5 4.3 12 1.8-5.2 5.2-1.8-11.3-5Z" />
      <path d="m11 11 4.5 4.5" />
    </>
  ),
  film: (
    <>
      <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2" />
      <path d="M6.5 3.75v12.5M13.5 3.75v12.5M2.75 7.5h3.75M2.75 12.5h3.75M13.5 7.5h3.75M13.5 12.5h3.75" />
    </>
  ),
  layers: (
    <>
      <path d="m10 2.8 7.2 3.8L10 10.4 2.8 6.6 10 2.8Z" />
      <path d="m2.8 10.1 7.2 3.8 7.2-3.8" />
      <path d="m2.8 13.6 7.2 3.8 7.2-3.8" />
    </>
  ),
  clock: (
    <>
      <circle cx="10" cy="10" r="7.25" />
      <path d="M10 6v4.2l2.8 1.7" />
    </>
  ),
  refresh: (
    <>
      <path d="M16.2 8.2A6.4 6.4 0 0 0 4.4 6.6" />
      <path d="M4 3.4v3.4h3.4" />
      <path d="M3.8 11.8a6.4 6.4 0 0 0 11.8 1.6" />
      <path d="M16 16.6v-3.4h-3.4" />
    </>
  ),
  store: (
    <>
      <path d="M3.2 7.6 4.6 3.5h10.8l1.4 4.1" />
      <path d="M3.2 7.6c0 1.3 1 2.2 2.3 2.2s2.3-.9 2.3-2.2c0 1.3 1 2.2 2.2 2.2s2.3-.9 2.3-2.2c0 1.3 1 2.2 2.2 2.2s2.3-.9 2.3-2.2" />
      <path d="M4.5 9.6v6.9h11V9.6" />
      <path d="M8.3 16.5v-3.6h3.4v3.6" />
    </>
  ),
  card: (
    <>
      <rect x="2.5" y="4.5" width="15" height="11" rx="2" />
      <path d="M2.5 8.2h15" />
      <path d="M5.5 12.5h3" />
    </>
  ),
  timer: (
    <>
      <circle cx="10" cy="11" r="6.25" />
      <path d="M8 2.5h4" />
      <path d="M10 7.8V11" />
      <path d="m15 5.4 1.2-1.2" />
    </>
  ),
  stack: (
    <>
      <rect x="3" y="3" width="14" height="4.2" rx="1.2" />
      <rect x="3" y="8.9" width="14" height="4.2" rx="1.2" />
      <path d="M3 16.5h14" />
    </>
  ),
  play: (
    <>
      <circle cx="10" cy="10" r="7.25" />
      <path d="M8.4 7.2v5.6l4.5-2.8-4.5-2.8Z" />
    </>
  ),
  loader: <path d="M10 2.75a7.25 7.25 0 1 1-7.25 7.25" />,
} as const;

export type IconName = keyof typeof paths;

export function Icon({
  name,
  size = 18,
  title,
  ...rest
}: { name: IconName; size?: number; title?: string } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {paths[name]}
    </svg>
  );
}

/** Brand mark: a speedometer needle inside a rounded tile. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      <rect width="28" height="28" rx="8" fill="#0b1220" />
      <path d="M7 18.5a7.6 7.6 0 1 1 14 0" fill="none" stroke="#3ee08f" strokeWidth="2.2" strokeLinecap="round" />
      <path d="m14 15.6 4.1-4.9" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="14" cy="15.8" r="1.7" fill="#fff" />
    </svg>
  );
}
