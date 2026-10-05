export type ScanStrategy = "mobile" | "desktop";

export type NormalizedTarget = {
  targetPath: string;
  template: "home" | "product" | "collection" | "page" | "blog";
};

/** Accept only a same-store path, never a merchant-supplied URL or query string. */
export function normalizeTargetPath(input: unknown): NormalizedTarget {
  if (typeof input !== "string") {
    throw new Error("Choose a storefront path to audit.");
  }
  const path = input.trim();
  if (path.length > 250 || !path.startsWith("/") || path.startsWith("//")) {
    throw new Error(
      "Enter a path such as /, /products/handle, or /collections/handle.",
    );
  }
  if (
    path.includes("\\") ||
    path.includes("?") ||
    path.includes("#") ||
    path.includes("%") ||
    Array.from(path).some((character) => {
      const code = character.charCodeAt(0);
      return code < 0x20 || code === 0x7f;
    })
  ) {
    throw new Error(
      "The audit path must not include a query, fragment, or encoded URL.",
    );
  }

  if (path === "/") return { targetPath: path, template: "home" };
  if (!/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/?$/.test(path)) {
    throw new Error(
      "The storefront path contains unsupported characters or segments.",
    );
  }

  const parts = path.split("/").filter(Boolean);
  if (parts.length === 2 && parts[0] === "products") {
    return { targetPath: `/${parts.join("/")}`, template: "product" };
  }
  if (parts.length === 2 && parts[0] === "collections") {
    return { targetPath: `/${parts.join("/")}`, template: "collection" };
  }
  if (parts.length === 2 && parts[0] === "pages") {
    return { targetPath: `/${parts.join("/")}`, template: "page" };
  }
  if (parts.length === 3 && parts[0] === "blogs") {
    return { targetPath: `/${parts.join("/")}`, template: "blog" };
  }

  throw new Error(
    "Supported targets are /, /products/handle, /collections/handle, /pages/handle, and /blogs/blog/article.",
  );
}

export function parseStrategies(input: unknown): ScanStrategy[] {
  if (input === "mobile") return ["mobile"];
  if (input === "desktop") return ["desktop"];
  if (input === "both") return ["mobile", "desktop"];
  throw new Error("Select mobile, desktop, or both audit strategies.");
}

export function buildTargetUrl(primaryOrigin: string, targetPath: string) {
  const origin = new URL(primaryOrigin);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.port ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error("Shopify did not return a valid HTTPS primary domain.");
  }
  const normalized = normalizeTargetPath(targetPath);
  return `${origin.origin}${normalized.targetPath}`;
}
