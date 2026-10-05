(() => {
  // Theme-editor previews do not prove that the embed is live on the storefront.
  if (window.Shopify && window.Shopify.designMode) return;

  // Same-origin Shopify App Proxy request; the server verifies Shopify's proxy
  // signature and derives the shop from that verified session, not from input.
  fetch("/apps/speedboost/heartbeat", {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }).catch(() => {
    // Storefront rendering must never depend on the optional verification ping.
  });
})();
