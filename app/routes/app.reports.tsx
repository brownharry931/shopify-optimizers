import { useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getVerifiedSubscription } from "../billing/billing.server";
import prisma from "../db.server";
import { publicAudit } from "../performance/scan.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [access, runs] = await Promise.all([
    getVerifiedSubscription(admin, session.shop),
    prisma.auditRun.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        scans: {
          where: { status: "COMPLETE" },
          orderBy: { strategy: "asc" },
        },
      },
    }),
  ]);
  const auditRuns = (runs as Array<Parameters<typeof publicAudit>[0]>).map(
    publicAudit,
  );
  return {
    hasAccess: access.isVerified && access.hasActiveSubscription,
    subscriptionVerified: access.isVerified,
    runs: auditRuns,
  };
};

function formatDelta(value: number | null, unit: string, precision = 0) {
  if (value === null) return "No comparable earlier audit";
  const formatted = precision
    ? Math.abs(value).toFixed(precision)
    : `${Math.abs(value)}`;
  if (value === 0) return `No change (${formatted}${unit})`;
  return `${value < 0 ? "−" : "+"}${formatted}${unit}`;
}

export default function ReportsPage() {
  const data = useLoaderData<typeof loader>();
  const previousByKey = new Map<
    string,
    (typeof data.runs)[number]["scans"][number]
  >();
  const rows = data.runs.flatMap((run) =>
    run.scans.map((scan) => {
      const key = `${run.targetPath}\u0000${scan.strategy}`;
      const previous = previousByKey.get(key);
      previousByKey.set(key, scan);
      return {
        run,
        scan,
        scoreDelta:
          previous && previous.performance !== null && scan.performance !== null
            ? scan.performance - previous.performance
            : null,
        lcpDelta:
          previous && previous.lcpMs !== null && scan.lcpMs !== null
            ? scan.lcpMs - previous.lcpMs
            : null,
      };
    }),
  );

  return (
    <s-page heading="Performance reports">
      <main className="pp-scanPage">
        <section className="pp-scanPanel">
          <p className="pp-eyebrow">Measured history</p>
          <h1>Performance reports</h1>
          <p>
            Historical rows come from completed PageSpeed runs. Changes compare
            the latest result with the immediately previous result for the same
            path and device. A score increase or metric change is not proof of
            causation; test conditions and storefront content can vary.
          </p>
        </section>

        {!data.hasAccess ? (
          <aside className="pp-scanNotice" role="status">
            {!data.subscriptionVerified
              ? "Shopify subscription status is not verified. Report access remains locked."
              : "An active Shopify subscription is required to view reports."}{" "}
            <a href="/app/billing">View billing</a>
          </aside>
        ) : rows.length ? (
          <section className="pp-scanPanel" aria-label="Audit history">
            <div className="pp-reportTableWrap">
              <table className="pp-reportTable">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Page / device</th>
                    <th scope="col">Score</th>
                    <th scope="col">Score change</th>
                    <th scope="col">LCP</th>
                    <th scope="col">LCP change</th>
                    <th scope="col">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ run, scan, scoreDelta, lcpDelta }) => (
                    <tr key={scan.id}>
                      <td>{new Date(run.createdAt).toLocaleString()}</td>
                      <td>
                        <strong>{run.targetPath}</strong>
                        <small>
                          {scan.strategy} · {run.template}
                        </small>
                      </td>
                      <td>{scan.performance ?? "—"}/100</td>
                      <td>{formatDelta(scoreDelta, " points")}</td>
                      <td>
                        {scan.lcpMs === null
                          ? "Not available"
                          : `${(scan.lcpMs / 1000).toFixed(2)} s`}
                      </td>
                      <td>{formatDelta(lcpDelta, " ms")}</td>
                      <td>
                        {scan.fieldDataSource
                          ? `Lab + CrUX ${scan.fieldDataSource.toLowerCase()}`
                          : "Synthetic lab only"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="pp-scanFootnote">
              Up to the latest 50 audit runs are shown. Scan history is pruned
              when a new scan runs after the 90-day retention threshold. Scores
              are not guarantees of rankings or sales.
            </p>
          </section>
        ) : (
          <section className="pp-scanPanel">
            <h2>No reports yet</h2>
            <p>
              Run a Speed Audit first. No sample or estimated results are shown.
            </p>
            <a className="pp-scanButtonLink" href="/app/scan">
              Open Speed Audit
            </a>
          </section>
        )}
      </main>
    </s-page>
  );
}

export const headers = (headersArgs: Parameters<typeof boundary.headers>[0]) =>
  boundary.headers(headersArgs);
