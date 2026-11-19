import { EMBED_BLOCK_HANDLE } from "./embed-handle";

export { EMBED_BLOCK_HANDLE };

/**
 * Deep link that opens the live theme's editor with the SpeedBoost app embed
 * selected and switched on, ready for the merchant to save.
 */
export function themeEditorEmbedUrl(myshopifyDomain: string, apiKey = process.env.SHOPIFY_API_KEY ?? "") {
  const url = new URL(`https://${myshopifyDomain}/admin/themes/current/editor`);
  url.searchParams.set("context", "apps");
  if (apiKey) url.searchParams.set("activateAppId", `${apiKey}/${EMBED_BLOCK_HANDLE}`);
  return url.toString();
}
