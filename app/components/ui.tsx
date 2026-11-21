import type { ReactNode } from "react";
import { Fragment, useId, useState } from "react";
import { Icon, type IconName } from "./icons";
import {
  ratingForDisplayScore,
  type Rating,
} from "../performance/lighthouse-report";

/* ------------------------------------------------------------------ */
/* Score gauge — same thresholds and palette as the Lighthouse report  */
/* ------------------------------------------------------------------ */

export function ScoreGauge({
  score,
  label,
  size = 96,
  stroke,
}: {
  score: number | null;
  label?: string;
  size?: number;
  stroke?: number;
}) {
  const rating = ratingForDisplayScore(score);
  const width = stroke ?? Math.max(5, Math.round(size / 13));
  const radius = (size - width) / 2;
  const circumference = 2 * Math.PI * radius;
  const value = typeof score === "number" ? Math.max(0, Math.min(100, score)) : 0;
  return (
    <figure className={`sb-gauge sb-rate-${rating}`} style={{ width: size }}>
      <div className="sb-gaugeDial" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle
            className="sb-gaugeTrack"
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={width}
          />
          <circle
            className="sb-gaugeArc"
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={width}
            strokeDasharray={`${(value / 100) * circumference} ${circumference}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <span
          className="sb-gaugeValue"
          style={{ fontSize: Math.round(size * 0.32) }}
          aria-label={score === null ? "Score not available" : `Score ${score} out of 100`}
        >
          {score ?? "?"}
        </span>
      </div>
      {label ? <figcaption>{label}</figcaption> : null}
    </figure>
  );
}

export function RatingShape({ rating }: { rating: Rating }) {
  // Lighthouse uses shape + colour: ▲ fail, ■ average, ● pass.
  return <span className={`sb-shape sb-shape-${rating}`} aria-hidden="true" />;
}

export function GaugeLegend() {
  return (
    <div className="sb-legend" aria-label="Score ranges">
      <span><RatingShape rating="fail" />0–49</span>
      <span><RatingShape rating="average" />50–89</span>
      <span><RatingShape rating="pass" />90–100</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Layout primitives                                                   */
/* ------------------------------------------------------------------ */

export function PageHeader({
  icon,
  eyebrow,
  title,
  description,
  actions,
}: {
  icon?: IconName;
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="sb-pageHeader">
      <div className="sb-pageHeaderMain">
        {icon ? (
          <span className="sb-pageIcon">
            <Icon name={icon} size={20} />
          </span>
        ) : null}
        <div>
          {eyebrow ? <p className="sb-eyebrow">{eyebrow}</p> : null}
          <h1 className="sb-pageTitle">{title}</h1>
          {description ? <p className="sb-pageLead">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="sb-pageActions">{actions}</div> : null}
    </header>
  );
}

export function Card({
  title,
  subtitle,
  icon,
  actions,
  children,
  className = "",
  id,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: IconName;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={`sb-card ${className}`} id={id}>
      {title || actions ? (
        <div className="sb-cardHead">
          <div className="sb-cardHeadText">
            {title ? (
              <h2 className="sb-cardTitle">
                {icon ? <Icon name={icon} size={18} /> : null}
                {title}
              </h2>
            ) : null}
            {subtitle ? <p className="sb-cardSubtitle">{subtitle}</p> : null}
          </div>
          {actions ? <div className="sb-cardActions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Badge({
  tone = "neutral",
  children,
  icon,
}: {
  tone?: "neutral" | "success" | "warning" | "critical" | "info";
  children: ReactNode;
  icon?: IconName;
}) {
  return (
    <span className={`sb-badge sb-badge-${tone}`}>
      {icon ? <Icon name={icon} size={13} /> : <span className="sb-badgeDot" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Banner({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warning" | "critical" | "success";
  title?: ReactNode;
  children?: ReactNode;
}) {
  const icon: IconName =
    tone === "success" ? "checkCircle" : tone === "info" ? "info" : "alert";
  return (
    <div className={`sb-banner sb-banner-${tone}`} role={tone === "critical" ? "alert" : "status"}>
      <Icon name={icon} size={18} />
      <div>
        {title ? <strong>{title}</strong> : null}
        {children ? <div className="sb-bannerBody">{children}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="sb-empty">
      <span className="sb-emptyIcon">
        <Icon name={icon} size={22} />
      </span>
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <Icon name="loader" size={size} className="sb-spin" />;
}

/* ------------------------------------------------------------------ */
/* Lighthouse description markdown: [text](https://…) and `code` only  */
/* ------------------------------------------------------------------ */

export function LighthouseMarkdown({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const pattern = /\[([^\]]+)\]\((https:\/\/[^)\s]+)\)|`([^`]+)`/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1] && match[2]) {
      parts.push(
        <a key={key++} href={match[2]} target="_blank" rel="noreferrer noopener">
          {match[1]}
        </a>,
      );
    } else if (match[3]) {
      parts.push(<code key={key++}>{match[3]}</code>);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts.map((part, index) => <Fragment key={index}>{part}</Fragment>)}</>;
}

/* ------------------------------------------------------------------ */
/* Trend chart — accessible inline SVG, no chart library               */
/* ------------------------------------------------------------------ */

export type TrendSeries = {
  name: string;
  tone: "a" | "b";
  points: Array<{ x: number; y: number; label: string }>;
};

export function TrendChart({
  series,
  height = 220,
}: {
  series: TrendSeries[];
  height?: number;
}) {
  const width = 720;
  const pad = { top: 16, right: 16, bottom: 28, left: 34 };
  const all = series.flatMap((item) => item.points);
  if (all.length === 0) return null;
  const minX = Math.min(...all.map((point) => point.x));
  const maxX = Math.max(...all.map((point) => point.x));
  const spanX = Math.max(1, maxX - minX);
  const xFor = (x: number) =>
    pad.left + ((x - minX) / spanX) * (width - pad.left - pad.right);
  const yFor = (y: number) =>
    pad.top + (1 - y / 100) * (height - pad.top - pad.bottom);
  const ticks = [0, 50, 90, 100];
  const dateLabel = (x: number) =>
    new Date(x).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <div className="sb-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Performance score over time">
        <rect
          className="sb-chartBand sb-chartBand-pass"
          x={pad.left}
          y={yFor(100)}
          width={width - pad.left - pad.right}
          height={yFor(90) - yFor(100)}
        />
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="sb-chartGrid" x1={pad.left} x2={width - pad.right} y1={yFor(tick)} y2={yFor(tick)} />
            <text className="sb-chartTick" x={pad.left - 8} y={yFor(tick) + 4} textAnchor="end">
              {tick}
            </text>
          </g>
        ))}
        <text className="sb-chartTick" x={pad.left} y={height - 8}>
          {dateLabel(minX)}
        </text>
        {maxX !== minX ? (
          <text className="sb-chartTick" x={width - pad.right} y={height - 8} textAnchor="end">
            {dateLabel(maxX)}
          </text>
        ) : null}
        {series.map((item) => {
          const points = [...item.points].sort((a, b) => a.x - b.x);
          const d = points
            .map((point, index) => `${index ? "L" : "M"}${xFor(point.x).toFixed(1)},${yFor(point.y).toFixed(1)}`)
            .join(" ");
          return (
            <g key={item.name} className={`sb-chartSeries sb-chartSeries-${item.tone}`}>
              <path d={d} fill="none" />
              {points.map((point) => (
                <circle key={`${point.x}-${point.y}`} cx={xFor(point.x)} cy={yFor(point.y)} r={4}>
                  <title>{`${item.name}: ${point.label}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      <div className="sb-chartLegend">
        {series.map((item) => (
          <span key={item.name}>
            <i className={`sb-chartKey sb-chartSeries-${item.tone}`} />
            {item.name}
          </span>
        ))}
        <span>
          <i className="sb-chartKey sb-chartKey-band" />
          Good (90–100)
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export function formatBytes(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function relativeTime(value: string | null | undefined) {
  if (!value) return "never";
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Locale-formatted timestamp; server and browser locales may differ. */
export function Time({ value, relative = false }: { value: string | null | undefined; relative?: boolean }) {
  if (!value) return <span>—</span>;
  return (
    <time dateTime={value} title={formatDateTime(value)} suppressHydrationWarning>
      {relative ? relativeTime(value) : formatDateTime(value)}
    </time>
  );
}

/** Read-only code viewer with a copy button. */
export function CodeBlock({
  code,
  label,
  tone = "dark",
  maxHeight = 220,
  copyable = true,
}: {
  code: string;
  label?: string;
  tone?: "dark" | "muted";
  maxHeight?: number;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const preId = useId();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked: select the text so the merchant can copy manually.
      const range = document.createRange();
      const node = document.getElementById(preId);
      if (node) {
        range.selectNodeContents(node);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }
    }
  };
  return (
    <div className={`sb-codeBlock sb-codeBlock-${tone}`}>
      <div className="sb-codeHead">
        <span>{label}</span>
        {copyable ? (
          <button type="button" className="sb-btn sb-btn-ghost sb-codeCopy" onClick={copy}>
            <Icon name={copied ? "check" : "stack"} size={14} />
            {copied ? "Copied" : "Copy"}
          </button>
        ) : null}
      </div>
      <pre style={{ maxHeight }} id={preId}>{code}</pre>
    </div>
  );
}
