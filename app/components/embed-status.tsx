import { Suspense } from "react";
import { Await, Link } from "react-router";
import type { EmbedStatus } from "../optimization/embed-status";
import { Badge, Banner, Time } from "./ui";

export function embedBadge(status: EmbedStatus) {
  if (status.theme === "enabled") {
    return <Badge tone="success">{status.live ? "Active · live" : "Active"}</Badge>;
  }
  if (status.theme === "disabled") return <Badge tone="warning">Turned off</Badge>;
  if (status.theme === "not-added") return <Badge tone="warning">Not enabled</Badge>;
  return status.live ? <Badge tone="success">Live</Badge> : <Badge tone="neutral">Checking unavailable</Badge>;
}

export function embedDetail(status: EmbedStatus) {
  if (status.theme === "enabled") {
    return status.live && status.lastSeenAt ? (
      <>Saved in {status.themeName ?? "live theme"} · storefront seen <Time value={status.lastSeenAt} relative /></>
    ) : (
      <>Saved in {status.themeName ?? "your live theme"}</>
    );
  }
  if (status.theme === "disabled") return `Added to ${status.themeName ?? "the live theme"} but switched off`;
  if (status.theme === "not-added") return `Not turned on in ${status.themeName ?? "the live theme"}`;
  return status.error ?? "Theme could not be read";
}

/** Streams the embed status so the page renders before the theme check finishes. */
export function DeferredEmbedStatus({
  status,
  children,
}: {
  status: Promise<EmbedStatus> | EmbedStatus;
  children: (status: EmbedStatus) => React.ReactNode;
}) {
  return (
    <Suspense fallback={<span className="sb-skeleton" style={{ width: 90 }} aria-label="Checking app embed" />}>
      <Await resolve={status} errorElement={<Badge tone="neutral">Checking unavailable</Badge>}>
        {(resolved) => children(resolved)}
      </Await>
    </Suspense>
  );
}

export function EmbedBanner({ status, embedUrl }: { status: EmbedStatus; embedUrl: string }) {
  if (status.theme === "enabled") return null;
  if (status.theme === "unknown") {
    return status.live ? null : (
      <Banner tone="info" title="Couldn't confirm the app embed right now">
        Shopify didn&apos;t return your live theme&apos;s settings. This is usually temporary; your boosters are not affected.
      </Banner>
    );
  }
  return (
    <Banner tone="warning" title="Turn on the SpeedBoost app embed to apply boosters">
      Boosters run from the app embed in your live theme ({status.themeName ?? "published theme"}).{" "}
      Follow the <Link to="/app/setup">setup guide</Link> (about a minute), or{" "}
      <a href={embedUrl} target="_top">open the theme editor</a> directly, switch SpeedBoost on under App embeds and click
      Save. Changes in a theme that isn&apos;t published, or that weren&apos;t saved, don&apos;t count.
    </Banner>
  );
}
