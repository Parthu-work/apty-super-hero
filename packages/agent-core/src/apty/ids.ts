/**
 * The shape each version's tenant, application and environment IDs take, so
 * an ID is checked before it becomes part of a content path
 * (AUDIT-CORRECTIONS A1).
 * - 5.x: UUIDs (tenant: apty-dap:packages/libs/shared/contracts/src/accounts/user/user.schema.ts:37@3f3adba;
 *   application: .../accounts/application/application.schema.ts:256@3f3adba;
 *   environments are database rows of the same kind). `app-urls.json` itself
 *   only types them as strings (application.schema.ts:279-282).
 * - 4.x: a short tenant key (`config.json` `tenantKey`, e.g. "yA87eWGa",
 *   apty-assist:player3.0/config/config.json:7@bbb4cbc) and numeric
 *   application and environment IDs
 *   (apty-assist:player3.0/src/shared/types/common-models.types.ts:1022-1031@bbb4cbc).
 */
import type { AptyVersion } from "./content-source.js";

export type AptyIdKind = "tenant" | "application" | "environment";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT_KEY_4X = /^[A-Za-z0-9_-]{1,64}$/;
const NUMBER_4X = /^\d{1,9}$/;

const SHAPES: Record<
  AptyVersion,
  Record<AptyIdKind, { pattern: RegExp; expected: string }>
> = {
  "5.x": {
    tenant: { pattern: UUID, expected: "a UUID" },
    application: { pattern: UUID, expected: "a UUID" },
    environment: { pattern: UUID, expected: "a UUID" },
  },
  "4.x": {
    tenant: {
      pattern: TENANT_KEY_4X,
      expected: "a short key of letters, digits, - or _",
    },
    application: { pattern: NUMBER_4X, expected: "a number" },
    environment: { pattern: NUMBER_4X, expected: "a number" },
  },
};

const KIND_NAME: Record<AptyIdKind, string> = {
  tenant: "tenant ID",
  application: "application ID",
  environment: "environment ID",
};

/** Why `id` cannot be this version's ID of this kind, or undefined when it can. */
export function idShapeIssue(
  version: AptyVersion,
  kind: AptyIdKind,
  id: string,
): string | undefined {
  const { pattern, expected } = SHAPES[version][kind];
  return pattern.test(id)
    ? undefined
    : `In Apty ${version}, the ${KIND_NAME[kind]} is ${expected}.`;
}
