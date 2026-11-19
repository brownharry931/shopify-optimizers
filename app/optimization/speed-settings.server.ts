import type { authenticate } from "../shopify.server";
import {
  SPEED_SETTINGS_KEY,
  SPEED_SETTINGS_NAMESPACE,
  readSpeedSettings,
  storefrontPayload,
  type SpeedSettings,
} from "./speed-settings";

type AdminApi = Awaited<ReturnType<typeof authenticate.admin>>["admin"];

type GraphqlPayload<T> = { data?: T; errors?: Array<{ message?: string }> };

export async function loadSpeedSettings(admin: AdminApi) {
  const response = await admin.graphql(
    `#graphql
      query SpeedSettings($namespace: String!, $key: String!) {
        currentAppInstallation {
          id
          metafield(namespace: $namespace, key: $key) { value updatedAt }
        }
      }`,
    { variables: { namespace: SPEED_SETTINGS_NAMESPACE, key: SPEED_SETTINGS_KEY } },
  );
  const payload = (await response.json()) as GraphqlPayload<{
    currentAppInstallation?: {
      id: string;
      metafield: { value: string; updatedAt: string } | null;
    };
  }>;
  const installation = payload.data?.currentAppInstallation;
  if (!installation) {
    throw new Error(
      payload.errors?.[0]?.message || "Shopify did not return the app installation.",
    );
  }
  return {
    installationId: installation.id,
    settings: readSpeedSettings(installation.metafield?.value),
    updatedAt: installation.metafield?.updatedAt ?? null,
  };
}

export async function saveSpeedSettings(
  admin: AdminApi,
  installationId: string,
  settings: SpeedSettings,
) {
  const response = await admin.graphql(
    `#graphql
      mutation SaveSpeedSettings($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { updatedAt }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        metafields: [
          {
            ownerId: installationId,
            namespace: SPEED_SETTINGS_NAMESPACE,
            key: SPEED_SETTINGS_KEY,
            type: "json",
            value: JSON.stringify(storefrontPayload(settings)),
          },
        ],
      },
    },
  );
  const payload = (await response.json()) as GraphqlPayload<{
    metafieldsSet?: {
      metafields: Array<{ updatedAt: string }> | null;
      userErrors: Array<{ message: string }>;
    };
  }>;
  const result = payload.data?.metafieldsSet;
  const error = payload.errors?.[0]?.message || result?.userErrors?.[0]?.message;
  if (error || !result?.metafields?.length) {
    throw new Error(error || "Shopify did not save the speed settings.");
  }
  return result.metafields[0].updatedAt;
}
