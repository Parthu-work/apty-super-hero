# KB pack delivery: set-up for IT and the KB owner

KB-RAG K26 Part D ([FIXES-K26.md](../tasks/kb-rag/FIXES-K26.md)). Once this
is set up, a KB edit reaches every managed SE's extension within a day with
no file passed by hand:

1. Every night at 01:30 UTC (07:00 IST) the GitHub Actions job
   `.github/workflows/kb-packs.yml` builds the 4.x and 5.x packs from
   Confluence, checks them (the gate below), signs them with the **CI key**
   and uploads them to the **pack host**.
2. Each SE's extension checks the pack host 30 seconds after the browser
   starts, every `kbPackCheckHours` (6 by default) and on **Check now**, with
   the SE's own session, and uses a newer pack as soon as it is verified.

The owner decisions behind this are D-DEL1 to D-DEL8 in
[decisions.md](../tasks/kb-rag/decisions.md) (Proposed until the owner
confirms them).

Who does what:

| Step | Who |
| --- | --- |
| 1. The CI signing key | KB owner (makes it), IT (stores it) |
| 2. The pack host and its token | IT |
| 3. The policy | IT |
| 4. The first run | KB owner |
| 5. Revoking a key | IT and the KB owner |

## What the job checks before it publishes (D-DEL8)

A pack is uploaded only if all of these pass; otherwise the run fails and
nothing is uploaded:

- the build succeeds and no card names a customer (when the customer-name
  list is set);
- the pack is the version asked for and is signed;
- the self-check: every card's title finds the card itself in the top 3;
- the card count has not dropped more than 10% from the last published pack
  (a manual run may override this rule only, with a reason that is written
  in the job summary);
- where `tooling/scripts/kb/questions/<version>.json` exists, the D-KB8
  quality gate (Recall@3 ≥ 0.90, "not covered" precision ≥ 0.90 and recall
  ≥ 0.80, layer accuracy ≥ 0.70).

After the upload the job reads the pack back and compares its sha256.

**This repository is public.** The job never prints a card title, card text
or the pack host: the builder's own output goes to a temporary file that is
deleted, and the job summary holds counts, page ids, numbers and hashes. A
failed run keeps its pack as an artifact for 7 days **only if the
repository is private**; on this public repository it is not kept, and the
KB owner runs the build locally to inspect it.

## 1. The CI signing key (D-DEL3)

The CI key is separate from the KB owner's own key, which stays on the KB
owner's machine. It is trusted only through the policy, never built in.

On a trusted machine, outside this repository:

```bash
pnpm kb:keygen --out ~/apty-kb-ci-key --name "Apty KB CI"
```

It writes `kb-signing-key-<keyId>.pem` (the private key, mode 600) and
`kb-signing-key-<keyId>.public.json` (`keyId`, `spki`, `name`).

- Put the **whole content of the `.pem` file** in the repository secret
  `KB_CI_SIGNING_KEY` (Settings → Secrets and variables → Actions → New
  repository secret). Then delete the `.pem` file from the machine.
- Give the `.public.json` content to IT for the policy's `trustedPackKeys`
  (step 3), with the name "Apty KB CI".

## 2. The pack host and its token (D-DEL4)

Choose an internal HTTPS host behind Apty SSO; never a public URL. It needs:

- one URL per version, for example `https://<pack-host>/apty-kb/4x.kbpack.json`
  and `https://<pack-host>/apty-kb/5x.kbpack.json`;
- for SEs (the extension): `GET` with their SSO session (cookies), answering
  `200` with `Content-Type: application/json` (or `text/plain`), and
  ideally an `ETag` or `Last-Modified` so repeat checks are a cheap `304`.
  The extension sends the session with `credentials: "include"`; a host that
  answers a signed-out request with a sign-in page is reported to the SE as
  "sign in to the pack host";
- for the job: a token that may **only** `GET` and `PUT` those two URLs
  (`Authorization: Bearer <token>`).

In the repository settings (Settings → Secrets and variables → Actions):

| Name | Kind | Value |
| --- | --- | --- |
| `CONFLUENCE_EMAIL` | secret | The read-only Confluence service account's email |
| `CONFLUENCE_TOKEN` | secret | Its classic, read-only API token |
| `KB_CI_SIGNING_KEY` | secret | The CI key's PKCS#8 PEM (step 1) |
| `KB_PUBLISH_TOKEN` | secret | The pack host token above |
| `KB_PUBLISH_URL_4X` | variable | The 4.x pack URL |
| `KB_PUBLISH_URL_5X` | variable | The 5.x pack URL |
| `KB_CUSTOMER_NAMES_URL` | variable, optional | A URL on the pack host holding the customer-name list (one name per line), read with the same token |

A missing secret fails the run and names it; its value is never printed.
The space and root page each version is built from are in
[`tooling/scripts/kb/sources.json`](../../tooling/scripts/kb/sources.json).

## 3. The policy (D-DEL1, D-DEL5, D-DEL7)

Add three keys to the managed policy ([ORG_POLICY.md](../security/ORG_POLICY.md)
says how to deploy it):

```json
{
  "kbPackSources": {
    "4.x": "https://<pack-host>/apty-kb/4x.kbpack.json",
    "5.x": "https://<pack-host>/apty-kb/5x.kbpack.json"
  },
  "kbPackCheckHours": 6,
  "trustedPackKeys": [
    { "keyId": "<16 hex>", "spki": "<base64>", "name": "Apty KB CI" }
  ]
}
```

Keep any `trustedPackKeys` entries already there (for example the KB
owner's key). `allowManualPackImport` stays absent (false): an SE cannot
import or remove a delivered version's pack by hand.

Check one SE's machine: chrome://policy shows the keys; Options →
Connections → Preflight → **Run all checks** shows "KB packs up to date"; if
it is amber or red, press **Check now** on it and read the reason.

## 4. The first run

Actions → KB packs → **Run workflow** (versions `4.x,5.x`). Read the job
summary: per version, the card counts by status, cards added, removed and
changed (ids), the self-check and quality numbers, the pack's sha256, the
key id and the expiry date. Then press **Check now** in one SE's Options →
Knowledge base: each row says "Delivered by your organization" and the
build date is the run's.

To try the job without a pack host or Confluence (on a fork, for example),
set the repository variable `KB_PUBLISH_DRY_RUN` to `1`: the job builds the
demo packs, checks them and uploads nothing.

## 5. Revoking a key

If the CI key may have leaked:

1. IT adds its `keyId` to the policy's `revokedPackKeyIds` and pushes the
   policy. Every pack it signed stops being used at the next question.
2. The KB owner makes a new CI key (step 1) and replaces the
   `KB_CI_SIGNING_KEY` secret.
3. IT replaces the old entry in `trustedPackKeys` with the new public key.
4. The KB owner runs the workflow by hand (step 4).

The same steps revoke the KB owner's own key, with the KB owner's key in
place of the CI key.

## What an SE sees when something is wrong

| What happened | Options (latest check) | Preflight | Chat |
| --- | --- | --- | --- |
| The host refused the session | "HTTP 403: sign in to the pack host." | Amber while the stored pack works, red when it does not | When no pack answers: "… The last update of the 5.x pack from your organization failed (HTTP 403: sign in to the pack host)." |
| The host is down or unreachable | "The pack host could not be reached." | As above | As above |
| The host sent an older pack | "The host's pack is older than the one in use; the one in use was kept." | Amber | — |
| The pack is not signed by a trusted key | "This pack is not signed by a key this extension trusts." | Amber, or red with no usable pack | As above |
