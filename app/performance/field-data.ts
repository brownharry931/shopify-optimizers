export type CruxMetric = {
  percentile: number;
  category: string;
};

export type PageSpeedFieldSet = {
  metrics?: Record<string, CruxMetric | undefined>;
};

export type CruxFieldMetrics = {
  lcpP75Ms?: number;
  lcpCategory?: string;
  inpP75Ms?: number;
  inpCategory?: string;
  clsP75?: number;
  clsCategory?: string;
  fcpP75Ms?: number;
  fcpCategory?: string;
  ttfbP75Ms?: number;
  ttfbCategory?: string;
};

export type CruxFieldData = {
  source: "URL" | "ORIGIN";
  metrics: CruxFieldMetrics;
};

function readMetric(
  metrics: Record<string, CruxMetric | undefined> | undefined,
  key: string,
) {
  const metric = metrics?.[key];
  if (
    !metric ||
    typeof metric.percentile !== "number" ||
    !Number.isFinite(metric.percentile)
  ) {
    return null;
  }
  return {
    percentile: metric.percentile,
    category: typeof metric.category === "string" ? metric.category : undefined,
  };
}

export function selectCruxFieldData(
  page: PageSpeedFieldSet | undefined,
  origin: PageSpeedFieldSet | undefined,
): CruxFieldData | null {
  for (const [source, fieldSet] of [
    ["URL", page],
    ["ORIGIN", origin],
  ] as const) {
    const raw = fieldSet?.metrics;
    const lcp = readMetric(raw, "LARGEST_CONTENTFUL_PAINT_MS");
    const inp = readMetric(raw, "INTERACTION_TO_NEXT_PAINT");
    const cls = readMetric(raw, "CUMULATIVE_LAYOUT_SHIFT_SCORE");
    const fcp = readMetric(raw, "FIRST_CONTENTFUL_PAINT_MS");
    const ttfb = readMetric(raw, "EXPERIMENTAL_TIME_TO_FIRST_BYTE");

    const metrics: CruxFieldMetrics = {};
    if (lcp) {
      metrics.lcpP75Ms = lcp.percentile;
      if (lcp.category) metrics.lcpCategory = lcp.category;
    }
    if (inp) {
      metrics.inpP75Ms = inp.percentile;
      if (inp.category) metrics.inpCategory = inp.category;
    }
    if (cls) {
      // PageSpeed encodes CrUX CLS percentile as an integer scaled by 100.
      metrics.clsP75 = cls.percentile / 100;
      if (cls.category) metrics.clsCategory = cls.category;
    }
    if (fcp) {
      metrics.fcpP75Ms = fcp.percentile;
      if (fcp.category) metrics.fcpCategory = fcp.category;
    }
    if (ttfb) {
      metrics.ttfbP75Ms = ttfb.percentile;
      if (ttfb.category) metrics.ttfbCategory = ttfb.category;
    }

    if (Object.keys(metrics).length > 0) {
      return { source, metrics };
    }
  }
  return null;
}
