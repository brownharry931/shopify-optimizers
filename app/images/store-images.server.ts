import type { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  SUPPORTED_MIME,
  filenameFromUrl,
  type MaxDimension,
  type QualityLevel,
  type SupportedMime,
} from "./compress-options";
import { compressImage, previewPair } from "./compress.server";

type AdminApi = Awaited<ReturnType<typeof authenticate.admin>>["admin"];
type Gql<T> = { data?: T; errors?: Array<{ message?: string }> };

const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

async function gql<T>(admin: AdminApi, query: string, variables?: Record<string, unknown>) {
  const response = await admin.graphql(query, variables ? { variables } : undefined);
  const payload = (await response.json()) as Gql<T>;
  if (payload.errors?.length) {
    const message = payload.errors.map((error) => error.message).join(" ");
    if (/access denied|write_files|read_files/i.test(message)) {
      throw new Error("SpeedBoost needs permission to manage files. Reopen the app from Shopify admin and approve the updated permissions.");
    }
    throw new Error("Shopify couldn't complete the image request. Please try again.");
  }
  if (!payload.data) throw new Error("Shopify returned an empty response.");
  return payload.data;
}

export type StoreImage = {
  id: string;
  filename: string;
  alt: string;
  url: string;
  width: number;
  height: number;
  bytes: number | null;
  mimeType: string;
  supported: boolean;
  ready: boolean;
  optimization: { id: string; status: string; originalBytes: number; optimizedBytes: number } | null;
};

const FILES_QUERY = `#graphql
  query ImageFiles($after: String) {
    files(first: 50, after: $after, query: "media_type:IMAGE", sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        alt
        fileStatus
        ... on MediaImage {
          mimeType
          image { url width height }
          originalSource { url fileSize }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

type FilesPage = {
  files: {
    nodes: Array<{
      id: string;
      alt: string | null;
      fileStatus: string;
      mimeType?: string;
      image?: { url: string; width: number; height: number } | null;
      originalSource?: { url: string; fileSize: number | null } | null;
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

/** One page of the store's images (Content → Files), largest first within the page. */
export async function listStoreImages(admin: AdminApi, shop: string, after: string | null) {
  const data = await gql<FilesPage>(admin, FILES_QUERY, { after });
  const nodes = data.files.nodes.filter((node) => node.id.includes("/MediaImage/") && node.image);
  const history = await prisma.imageOptimization.findMany({
    where: { shop, fileId: { in: nodes.map((node) => node.id) }, status: { in: ["APPLIED", "PENDING", "RESTORED"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, fileId: true, status: true, originalBytes: true, optimizedBytes: true },
  });
  const latest = new Map<string, (typeof history)[number]>();
  for (const row of history) if (!latest.has(row.fileId)) latest.set(row.fileId, row);

  const images: StoreImage[] = nodes.map((node) => {
    const mimeType = node.mimeType ?? "";
    return {
      id: node.id,
      filename: filenameFromUrl(node.image!.url),
      alt: node.alt ?? "",
      url: node.image!.url,
      width: node.image!.width,
      height: node.image!.height,
      bytes: node.originalSource?.fileSize ?? null,
      mimeType,
      supported: (SUPPORTED_MIME as readonly string[]).includes(mimeType),
      ready: node.fileStatus === "READY",
      optimization: latest.get(node.id) ?? null,
    };
  });
  images.sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0));
  return { images, nextCursor: data.files.pageInfo.hasNextPage ? data.files.pageInfo.endCursor : null };
}

async function fetchFile(admin: AdminApi, fileId: string) {
  const data = await gql<{
    node: {
      id: string;
      fileStatus: string;
      mimeType?: string;
      image?: { url: string } | null;
      originalSource?: { url: string; fileSize: number | null } | null;
    } | null;
  }>(
    admin,
    `#graphql
      query ImageFile($id: ID!) {
        node(id: $id) {
          ... on MediaImage { id fileStatus mimeType image { url } originalSource { url fileSize } }
        }
      }`,
    { id: fileId },
  );
  const file = data.node;
  if (!file?.originalSource?.url || !file.mimeType) throw new Error("That image is no longer in your store.");
  if (!(SUPPORTED_MIME as readonly string[]).includes(file.mimeType)) {
    throw new Error("Only JPEG, PNG and WebP images can be compressed.");
  }
  if (file.fileStatus !== "READY") throw new Error("Shopify is still processing this image. Try again in a minute.");
  const response = await fetch(file.originalSource.url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error("The original image couldn't be downloaded from Shopify.");
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    id: file.id,
    mimeType: file.mimeType as SupportedMime,
    filename: filenameFromUrl(file.image?.url ?? file.originalSource.url),
    buffer,
  };
}

export function validateFileId(value: unknown) {
  if (typeof value !== "string" || !/^gid:\/\/shopify\/MediaImage\/\d+$/.test(value)) {
    throw new Error("Choose an image from your store.");
  }
  return value;
}

export async function previewCompression(admin: AdminApi, fileId: string, level: QualityLevel, maxDimension: MaxDimension) {
  const file = await fetchFile(admin, fileId);
  const result = await compressImage(file.buffer, file.mimeType, level, maxDimension);
  const previews = await previewPair(file.buffer, result.buffer);
  return {
    fileId,
    filename: file.filename,
    originalBytes: result.originalBytes,
    compressedBytes: result.bytes,
    originalSize: `${result.originalWidth}×${result.originalHeight}`,
    compressedSize: `${result.width}×${result.height}`,
    psnr: result.psnr,
    accepted: result.accepted,
    reason: result.reason,
    previews,
  };
}

/** Upload bytes to Shopify and swap them into the existing file (same ID and URL). */
async function replaceFileContent(admin: AdminApi, fileId: string, filename: string, mimeType: string, bytes: Buffer) {
  const staged = await gql<{
    stagedUploadsCreate: {
      stagedTargets: Array<{ url: string; resourceUrl: string; parameters: Array<{ name: string; value: string }> }>;
      userErrors: Array<{ message: string }>;
    };
  }>(
    admin,
    `#graphql
      mutation StageImage($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets { url resourceUrl parameters { name value } }
          userErrors { field message }
        }
      }`,
    { input: [{ filename, mimeType, resource: "IMAGE", httpMethod: "POST", fileSize: String(bytes.length) }] },
  );
  const target = staged.stagedUploadsCreate.stagedTargets[0];
  if (!target || staged.stagedUploadsCreate.userErrors.length) {
    throw new Error(staged.stagedUploadsCreate.userErrors[0]?.message || "Shopify didn't provide an upload target.");
  }
  const form = new FormData();
  for (const parameter of target.parameters) form.append(parameter.name, parameter.value);
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mimeType }), filename);
  const upload = await fetch(target.url, { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
  if (!upload.ok) throw new Error(`Uploading to Shopify failed (HTTP ${upload.status}).`);

  const updated = await gql<{
    fileUpdate: { files: Array<{ id: string; fileStatus: string }> | null; userErrors: Array<{ message: string; code?: string }> };
  }>(
    admin,
    `#graphql
      mutation ReplaceImage($files: [FileUpdateInput!]!) {
        fileUpdate(files: $files) {
          files { id fileStatus }
          userErrors { field message code }
        }
      }`,
    { files: [{ id: fileId, originalSource: target.resourceUrl }] },
  );
  if (updated.fileUpdate.userErrors.length || !updated.fileUpdate.files?.length) {
    throw new Error(updated.fileUpdate.userErrors[0]?.message || "Shopify didn't accept the new image.");
  }
}

export async function applyCompression(
  admin: AdminApi,
  shop: string,
  fileId: string,
  level: QualityLevel,
  maxDimension: MaxDimension,
) {
  const active = await prisma.imageOptimization.findFirst({
    where: { shop, fileId, status: { in: ["APPLIED", "PENDING"] } },
    select: { id: true },
  });
  if (active) throw new Error("This image is already compressed. Restore it first to compress it again.");

  const file = await fetchFile(admin, fileId);
  const result = await compressImage(file.buffer, file.mimeType, level, maxDimension);
  if (!result.accepted) throw new Error(result.reason ?? "This image wasn't compressed.");
  if (file.buffer.length > MAX_BACKUP_BYTES) throw new Error("Images over 20 MB are skipped so a restorable backup can always be kept.");

  // Keep the original first, so a failure after upload can still be undone.
  const record = await prisma.imageOptimization.create({
    data: {
      shop,
      fileId,
      filename: file.filename,
      mimeType: file.mimeType,
      originalBytes: result.originalBytes,
      optimizedBytes: result.bytes,
      width: result.width,
      height: result.height,
      quality: level,
      psnr: result.psnr,
      status: "PENDING",
      backup: new Uint8Array(file.buffer),
    },
    select: { id: true },
  });
  try {
    await replaceFileContent(admin, fileId, file.filename, file.mimeType, result.buffer);
  } catch (error) {
    await prisma.imageOptimization.update({
      where: { id: record.id },
      data: { status: "FAILED", backup: null, error: error instanceof Error ? error.message : "Upload failed" },
    });
    throw error;
  }
  await prisma.imageOptimization.update({ where: { id: record.id }, data: { status: "APPLIED" } });
  return { fileId, originalBytes: result.originalBytes, optimizedBytes: result.bytes, psnr: result.psnr };
}

export async function restoreOriginal(admin: AdminApi, shop: string, optimizationId: string) {
  const record = await prisma.imageOptimization.findFirst({
    // PENDING = the server stopped between upload and bookkeeping; the backup is still valid.
    where: { id: optimizationId, shop, status: { in: ["APPLIED", "PENDING"] } },
  });
  if (!record?.backup) throw new Error("No backup is available for this image.");
  await replaceFileContent(admin, record.fileId, record.filename, record.mimeType, Buffer.from(record.backup));
  await prisma.imageOptimization.update({
    where: { id: record.id },
    data: { status: "RESTORED", restoredAt: new Date(), backup: null },
  });
  return { fileId: record.fileId };
}

export async function optimizationHistory(shop: string) {
  const rows = await prisma.imageOptimization.findMany({
    where: { shop, status: { in: ["APPLIED", "PENDING", "RESTORED"] } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, fileId: true, filename: true, originalBytes: true, optimizedBytes: true,
      quality: true, psnr: true, status: true, createdAt: true, restoredAt: true,
    },
  });
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), restoredAt: row.restoredAt?.toISOString() ?? null }));
}
