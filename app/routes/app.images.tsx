import { Suspense, useState } from "react";
import { Await, Link, useFetcher, useLoaderData, useRevalidator } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getVerifiedSubscription } from "../billing/billing.server";
import {
  MAX_DIMENSIONS,
  QUALITY_LEVELS,
  parseMaxDimension,
  parseQuality,
  qualityVerdict,
  type MaxDimension,
  type QualityLevel,
} from "../images/compress-options";
import {
  applyCompression,
  listStoreImages,
  optimizationHistory,
  previewCompression,
  restoreOriginal,
  validateFileId,
  type StoreImage,
} from "../images/store-images.server";
import { Icon } from "../components/icons";
import { Badge, Banner, Card, EmptyState, PageHeader, Spinner, Time, formatBytes } from "../components/ui";

const MAX_BULK = 20;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const access = await getVerifiedSubscription(admin, session.shop);
  const canUse = access.isVerified && access.hasActiveSubscription;
  const hasScope = (session.scope ?? "").split(",").includes("write_files");
  const after = new URL(request.url).searchParams.get("after");
  // Streamed so the page appears immediately.
  const page =
    canUse && hasScope
      ? listStoreImages(admin, session.shop, after).catch((error: unknown) => ({
          error: error instanceof Error ? error.message : "Images couldn't be loaded.",
        }))
      : Promise.resolve({ images: [] as StoreImage[], nextCursor: null as string | null });
  return {
    canUse,
    hasScope,
    subscriptionVerified: access.isVerified,
    isFirstPage: !after,
    page,
    history: canUse ? await optimizationHistory(session.shop) : [],
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const access = await getVerifiedSubscription(admin, session.shop);
  if (!access.isVerified || !access.hasActiveSubscription) {
    return { ok: false as const, intent: "error" as const, error: "An active SpeedBoost plan is required." };
  }
  const form = await request.formData();
  const intent = form.get("intent");
  const level = parseQuality(form.get("quality"));
  const maxDimension = parseMaxDimension(form.get("maxDimension"));
  try {
    if (intent === "preview") {
      const fileId = validateFileId(form.get("fileId"));
      return { ok: true as const, intent: "preview" as const, preview: await previewCompression(admin, fileId, level, maxDimension) };
    }
    if (intent === "apply") {
      const ids = form.getAll("fileId").slice(0, MAX_BULK).map(validateFileId);
      const results: Array<{ fileId: string; ok: boolean; message: string; saved?: number }> = [];
      for (const fileId of ids) {
        try {
          const result = await applyCompression(admin, session.shop, fileId, level, maxDimension);
          results.push({ fileId, ok: true, message: "Compressed", saved: result.originalBytes - result.optimizedBytes });
        } catch (error) {
          results.push({ fileId, ok: false, message: error instanceof Error ? error.message : "Not compressed" });
        }
      }
      return { ok: true as const, intent: "apply" as const, results };
    }
    if (intent === "restore") {
      const id = String(form.get("optimizationId") ?? "");
      await restoreOriginal(admin, session.shop, id);
      return { ok: true as const, intent: "restore" as const };
    }
    return { ok: false as const, intent: "error" as const, error: "Unsupported action." };
  } catch (error) {
    return { ok: false as const, intent: "error" as const, error: error instanceof Error ? error.message : "Something went wrong." };
  }
};

type ActionData = Awaited<ReturnType<typeof action>>;
type Preview = Extract<ActionData, { intent: "preview" }>["preview"];

function CompareSlider({ before, after, label }: { before: string; after: string; label: string }) {
  const [position, setPosition] = useState(50);
  return (
    <div className="sb-compare">
      <div className="sb-compareStage">
        <img src={after} alt={`${label} after compression`} />
        <img src={before} alt={`${label} original`} className="sb-compareBefore" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }} />
        <span className="sb-compareLine" style={{ left: `${position}%` }} aria-hidden="true" />
        <span className="sb-compareTag sb-compareTag-left">Original</span>
        <span className="sb-compareTag sb-compareTag-right">Compressed</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={position}
        onChange={(event) => setPosition(Number(event.target.value))}
        aria-label="Drag to compare original and compressed"
        className="sb-compareRange"
      />
    </div>
  );
}

function PreviewPanel({ preview, onApply, applying, onClose }: { preview: Preview; onApply: () => void; applying: boolean; onClose: () => void }) {
  const [zoom, setZoom] = useState<"full" | "crop">("full");
  const saving = preview.originalBytes - preview.compressedBytes;
  return (
    <Card
      icon="image"
      title={`Preview · ${preview.filename}`}
      subtitle="Drag the slider to compare. Use 100% zoom to inspect fine detail."
      actions={<button type="button" className="sb-btn sb-btn-ghost" onClick={onClose}><Icon name="x" size={15} />Close</button>}
    >
      <div className="sb-segmented" role="tablist" aria-label="Zoom" style={{ marginBottom: 12 }}>
        <button type="button" role="tab" aria-selected={zoom === "full"} onClick={() => setZoom("full")}>Whole image</button>
        <button type="button" role="tab" aria-selected={zoom === "crop"} onClick={() => setZoom("crop")}>100% zoom (centre)</button>
      </div>
      <CompareSlider
        key={zoom}
        label={preview.filename}
        before={zoom === "full" ? preview.previews.beforeFull : preview.previews.beforeCrop}
        after={zoom === "full" ? preview.previews.afterFull : preview.previews.afterCrop}
      />
      <div className="sb-totals" style={{ marginTop: 14 }}>
        <div className="sb-stat"><span>Original</span><strong className="sb-num">{formatBytes(preview.originalBytes)}</strong><small>{preview.originalSize} px</small></div>
        <div className="sb-stat"><span>Compressed</span><strong className="sb-num">{formatBytes(preview.compressedBytes)}</strong><small>{preview.compressedSize} px</small></div>
        <div className="sb-stat">
          <span>Saving · quality</span>
          <strong className={`sb-num ${saving > 0 ? "sb-text-pass" : ""}`}>{saving > 0 ? `−${Math.round((saving / preview.originalBytes) * 100)}%` : "0%"}</strong>
          <small>{qualityVerdict(preview.psnr)}{preview.psnr ? ` (${preview.psnr} dB PSNR)` : ""}</small>
        </div>
      </div>
      {preview.accepted ? (
        <div className="sb-cardActions" style={{ marginTop: 14 }}>
          <button type="button" className="sb-btn sb-btn-accent sb-btn-lg" disabled={applying} onClick={onApply}>
            {applying ? <><Spinner /> Replacing image…</> : <><Icon name="check" size={16} /> Use compressed image on my store</>}
          </button>
          <span className="sb-help">The image keeps its URL, so products and sections update automatically. You can restore the original any time.</span>
        </div>
      ) : (
        <div style={{ marginTop: 14 }}><Banner tone="info" title="This image won't be changed">{preview.reason}</Banner></div>
      )}
    </Card>
  );
}

function ImageGrid({
  images,
  selected,
  toggle,
  onPreview,
  previewingId,
}: {
  images: StoreImage[];
  selected: Set<string>;
  toggle: (id: string) => void;
  onPreview: (id: string) => void;
  previewingId: string | null;
}) {
  return (
    <ul className="sb-imageGrid">
      {images.map((image) => {
        const compressed = image.optimization && image.optimization.status !== "RESTORED";
        const selectable = image.supported && image.ready && !compressed;
        return (
          <li key={image.id} className="sb-imageTile" data-selected={selected.has(image.id)}>
            <label className="sb-imageThumb">
              {selectable ? (
                <input type="checkbox" checked={selected.has(image.id)} onChange={() => toggle(image.id)} aria-label={`Select ${image.filename}`} />
              ) : null}
              <img src={`${image.url}${image.url.includes("?") ? "&" : "?"}width=360`} alt={image.alt} loading="lazy" decoding="async" />
            </label>
            <div className="sb-imageInfo">
              <strong title={image.filename}>{image.filename}</strong>
              <span>{image.width}×{image.height} · {formatBytes(image.bytes)}</span>
              <div className="sb-imageStatus">
                {compressed ? (
                  <Badge tone="success">Saved {formatBytes(image.optimization!.originalBytes - image.optimization!.optimizedBytes)}</Badge>
                ) : !image.supported ? (
                  <Badge tone="neutral">{image.mimeType.replace("image/", "").toUpperCase() || "Other"} · skipped</Badge>
                ) : !image.ready ? (
                  <Badge tone="neutral">Processing</Badge>
                ) : (
                  <button type="button" className="sb-btn sb-btn-secondary sb-btnSm" onClick={() => onPreview(image.id)} disabled={previewingId === image.id}>
                    {previewingId === image.id ? <><Spinner size={13} /> Preparing</> : "Preview"}
                  </button>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function ImageCompressorPage() {
  const data = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const previewFetcher = useFetcher<typeof action>();
  const applyFetcher = useFetcher<typeof action>();
  const restoreFetcher = useFetcher<typeof action>();
  const [quality, setQuality] = useState<QualityLevel>("balanced");
  const [maxDimension, setMaxDimension] = useState<MaxDimension>(0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [closedPreview, setClosedPreview] = useState<string | null>(null);

  const preview = previewFetcher.data?.ok && previewFetcher.data.intent === "preview" ? previewFetcher.data.preview : null;
  const previewError = previewFetcher.data && !previewFetcher.data.ok ? previewFetcher.data.error : null;
  const applyResults = applyFetcher.data?.ok && applyFetcher.data.intent === "apply" ? applyFetcher.data.results : null;
  const applying = applyFetcher.state !== "idle";
  const previewingId = previewFetcher.state !== "idle" ? String(previewFetcher.formData?.get("fileId") ?? "") : null;

  const settings = { quality, maxDimension: String(maxDimension) };
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_BULK) next.add(id);
      return next;
    });
  const runPreview = (fileId: string) => {
    setClosedPreview(null);
    previewFetcher.submit({ intent: "preview", fileId, ...settings }, { method: "post" });
  };
  const apply = (ids: string[]) => {
    const form = new FormData();
    form.set("intent", "apply");
    form.set("quality", quality);
    form.set("maxDimension", String(maxDimension));
    for (const id of ids) form.append("fileId", id);
    applyFetcher.submit(form, { method: "post" });
    setSelected(new Set());
  };
  const totalSaved = data.history
    .filter((row) => row.status !== "RESTORED")
    .reduce((sum, row) => sum + row.originalBytes - row.optimizedBytes, 0);

  return (
    <s-page heading="Image compressor">
      <main className="sb-app">
        <PageHeader
          icon="image"
          eyebrow="Content → Files"
          title="Image compressor"
          description="Make your store's image files smaller without visible quality loss. Preview every image before and after, use the compressed version on your store with one click, and restore the original whenever you like."
        />

        {!data.canUse ? (
          <Banner tone="warning" title="Image compressor is locked">
            {data.subscriptionVerified ? "An active SpeedBoost plan is required." : "Your subscription couldn't be verified yet."}{" "}
            <Link to="/app/billing">View billing</Link>
          </Banner>
        ) : !data.hasScope ? (
          <Banner tone="warning" title="Approve file access to use the image compressor">
            SpeedBoost needs permission to read and update the image files in Content → Files. Close and reopen the app
            from your Shopify admin and approve the updated permissions.
          </Banner>
        ) : null}

        <div className="sb-stats">
          <div className="sb-stat"><span><Icon name="image" size={15} />Images compressed</span><strong className="sb-num">{data.history.filter((row) => row.status !== "RESTORED").length}</strong><small>Restorable any time</small></div>
          <div className="sb-stat"><span><Icon name="arrowDown" size={15} />Space saved</span><strong className="sb-num sb-text-pass">{formatBytes(totalSaved)}</strong><small>Across compressed originals</small></div>
          <div className="sb-stat"><span><Icon name="shield" size={15} />Quality check</span><strong style={{ fontSize: 16, paddingTop: 4 }}>Every image</strong><small>Rejected if it would look different</small></div>
          <div className="sb-stat"><span><Icon name="refresh" size={15} />Originals</span><strong style={{ fontSize: 16, paddingTop: 4 }}>Backed up</strong><small>One-click restore</small></div>
        </div>

        <Card
          icon="settings"
          title="Compression settings"
          subtitle={`${QUALITY_LEVELS.find((level) => level.id === quality)!.label}${maxDimension ? ` · ${MAX_DIMENSIONS.find((item) => item.value === maxDimension)!.label}` : " · original dimensions"}`}
          actions={
            <button type="button" className="sb-btn sb-btn-secondary" aria-expanded={showAdvanced} onClick={() => setShowAdvanced((value) => !value)}>
              <Icon name="settings" size={15} /> {showAdvanced ? "Hide advanced" : "Advanced"}
            </button>
          }
        >
          {showAdvanced ? (
            <div className="sb-grid" style={{ gap: 18 }}>
              <div>
                <span className="sb-label">Quality</span>
                <div className="sb-choiceGrid" role="radiogroup" aria-label="Quality">
                  {QUALITY_LEVELS.map((level) => (
                    <label key={level.id} className="sb-choice" data-selected={quality === level.id}>
                      <input type="radio" name="quality" checked={quality === level.id} onChange={() => setQuality(level.id)} />
                      <strong>{level.label}</strong>
                      <span>{level.description}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <span className="sb-label">Resize very large images</span>
                <div className="sb-segmented" role="radiogroup" aria-label="Maximum size" style={{ marginTop: 6 }}>
                  {MAX_DIMENSIONS.map((item) => (
                    <label key={item.value}>
                      <input type="radio" name="maxDimension" checked={maxDimension === item.value} onChange={() => setMaxDimension(item.value)} />
                      {item.label}
                    </label>
                  ))}
                </div>
                <p className="sb-help" style={{ marginTop: 6 }}>
                  Shopify never shows images larger than about 2,000–3,000 px on a storefront, so capping the longest side
                  removes pixels nobody sees. Images are never enlarged and never cropped.
                </p>
              </div>
            </div>
          ) : (
            <p className="sb-muted">
              Images are re-encoded in their own format (JPEG, PNG, WebP) with high-quality encoders and checked against
              the original. Anything that would look different is skipped automatically.
            </p>
          )}
        </Card>

        {previewError ? <Banner tone="critical" title="Preview failed">{previewError}</Banner> : null}
        {preview && closedPreview !== preview.fileId ? (
          <PreviewPanel
            preview={preview}
            applying={applying}
            onApply={() => apply([preview.fileId])}
            onClose={() => setClosedPreview(preview.fileId)}
          />
        ) : null}

        {applyResults ? (
          <Banner
            tone={applyResults.every((result) => result.ok) ? "success" : "warning"}
            title={`${applyResults.filter((result) => result.ok).length} of ${applyResults.length} image${applyResults.length === 1 ? "" : "s"} compressed`}
          >
            {applyResults.filter((result) => !result.ok).map((result) => (
              <div key={result.fileId}>{result.message}</div>
            ))}
            Shopify takes a moment to process replaced images.{" "}
            <button type="button" className="sb-linkButton" onClick={() => revalidator.revalidate()}>Refresh list</button>
          </Banner>
        ) : null}

        <Card
          icon="image"
          title="Your store's images"
          subtitle="Largest files first. Select images to compress in bulk (up to 20 at a time), or preview one to compare."
          actions={
            selected.size ? (
              <button type="button" className="sb-btn sb-btn-accent" disabled={applying || !data.canUse} onClick={() => apply([...selected])}>
                {applying ? <><Spinner /> Compressing…</> : <>Compress {selected.size} selected</>}
              </button>
            ) : null
          }
        >
          {applying ? (
            <div className="sb-progress" style={{ marginBottom: 14 }}>
              <div className="sb-progressBar"><span /></div>
              <p className="sb-help">Compressing, checking quality and uploading to Shopify. Keep this page open.</p>
            </div>
          ) : null}
          <Suspense fallback={<div className="sb-imageGrid">{Array.from({ length: 8 }, (_, i) => <span key={i} className="sb-skeleton" style={{ height: 210, width: "100%" }} />)}</div>}>
            <Await resolve={data.page}>
              {(page) =>
                "error" in page ? (
                  <Banner tone="critical" title="Images couldn't be loaded">{page.error}</Banner>
                ) : page.images.length === 0 ? (
                  <EmptyState icon="image" title={data.canUse && data.hasScope ? "No images found" : "Images will appear here"}>
                    {data.canUse && data.hasScope ? "Upload images in Content → Files or to your products, then come back." : "Unlock the compressor to see your store's images."}
                  </EmptyState>
                ) : (
                  <>
                    <ImageGrid images={page.images} selected={selected} toggle={toggle} onPreview={runPreview} previewingId={previewingId} />
                    <div className="sb-cardActions" style={{ marginTop: 14 }}>
                      {!data.isFirstPage ? <Link className="sb-btn sb-btn-secondary" to="/app/images">First page</Link> : null}
                      {page.nextCursor ? (
                        <Link className="sb-btn sb-btn-secondary" to={`/app/images?after=${encodeURIComponent(page.nextCursor)}`}>
                          Next 50 images <Icon name="arrowRight" size={14} />
                        </Link>
                      ) : null}
                    </div>
                  </>
                )
              }
            </Await>
          </Suspense>
        </Card>

        <Card icon="history" title="Compression history" subtitle="Restore puts the exact original file back, keeping the same URL.">
          {data.history.length === 0 ? (
            <p className="sb-muted">Compressed images will be listed here.</p>
          ) : (
            <div className="sb-tableWrap">
              <table className="sb-table">
                <thead>
                  <tr>
                    <th scope="col">Image</th>
                    <th scope="col">When</th>
                    <th scope="col" className="sb-cellNum">Before</th>
                    <th scope="col" className="sb-cellNum">After</th>
                    <th scope="col">Quality</th>
                    <th scope="col"><span className="sb-visually-hidden">Action</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.history.map((row) => (
                    <tr key={row.id}>
                      <td><span className="sb-cellUrl" title={row.filename}>{row.filename}</span></td>
                      <td style={{ whiteSpace: "nowrap" }}><Time value={row.createdAt} /></td>
                      <td className="sb-cellNum">{formatBytes(row.originalBytes)}</td>
                      <td className="sb-cellNum sb-text-pass">{formatBytes(row.optimizedBytes)}</td>
                      <td>{qualityVerdict(row.psnr)}</td>
                      <td>
                        {row.status === "RESTORED" ? (
                          <Badge tone="neutral">Restored</Badge>
                        ) : (
                          <restoreFetcher.Form method="post">
                            <input type="hidden" name="intent" value="restore" />
                            <input type="hidden" name="optimizationId" value={row.id} />
                            <button type="submit" className="sb-btn sb-btn-ghost sb-btnSm" disabled={restoreFetcher.state !== "idle"}>
                              <Icon name="refresh" size={14} /> Restore original
                            </button>
                          </restoreFetcher.Form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {restoreFetcher.data && !restoreFetcher.data.ok ? <p className="sb-help sb-text-fail" style={{ marginTop: 8 }}>{restoreFetcher.data.error}</p> : null}
        </Card>

        <p className="sb-footnote">
          Shopify&apos;s image CDN already resizes images and converts them to WebP/AVIF for each visitor. Compressing the
          original files makes those versions smaller too, and helps most with large uploads. Run a Speed audit before and
          after to measure the effect on your pages.
        </p>
      </main>
    </s-page>
  );
}

export const headers = (headersArgs: Parameters<typeof boundary.headers>[0]) =>
  boundary.headers(headersArgs);
