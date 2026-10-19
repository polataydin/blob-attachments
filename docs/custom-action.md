# plt_RequestAttachmentUrl

A **legacy custom action** (a process of type Action, not a custom API). The plug-in supplies the
whole implementation; the action itself exists only to define the message and its parameters, so it
needs no steps in its own definition.

## Contract

| Direction | Parameter | Type | Notes |
| --- | --- | --- | --- |
| Input | `Target` | EntityReference → `plt_blobattachment` | Present when the action is **bound** to the table. |
| Input | `BlobAttachmentId` | String | Alternative for a **global** (unbound) action. A GUID. |
| Output | `Url` | String | Absolute HTTPS URL with a read-only SAS token. |

`RequestAttachmentUrlPlugin` accepts either input shape, so the action can be defined bound or
global. Bound is the better default: the platform then validates the record reference and the
caller cannot pass an id for an unrelated table.

## Registration

Register `PLT.BlobAttachments.Plugins.RequestAttachmentUrlPlugin` on the `plt_RequestAttachmentUrl`
message, **PostOperation**, **synchronous**. The caller is waiting for the URL, so there is no
asynchronous option here.

Step configuration, as `name=value` pairs separated by `;` or newlines:

| Configuration | Keys | Required |
| --- | --- | --- |
| Unsecure | `AccountName`, optionally `EndpointSuffix` or `BlobEndpoint` | `AccountName` yes |
| Secure | `AccountKey` | yes |

`EndpointSuffix` defaults to `core.windows.net`. `BlobEndpoint` overrides the computed host
entirely, which is what you want against Azurite or a custom domain.

The secure configuration is not included in a solution export, so it has to be re-entered in every
environment after import. A step whose configuration is missing or malformed fails at plug-in
construction with a message naming the missing key.

## What the plug-in does

1. Reads the record id from `Target` or `BlobAttachmentId`.
2. Retrieves `plt_blobpath` from the `plt_blobattachment` record **as the calling user**, so
   Dataverse row security governs who can get a URL. A missing or empty `plt_blobpath` is an error
   ("not copied to blob storage yet"), not an empty result.
3. Reads `plt_ContainerName` and `plt_SasExpiryMinutes` from environment variables, falling back to
   each definition's default value. Expiry defaults to 5 minutes and is clamped to 1–60.
4. Signs a service SAS locally with HMAC-SHA256 over the storage account key and returns the URL in
   `Url`.

## The SAS

A **service SAS**, version `2020-12-06`, scoped to one blob:

| Field | Value |
| --- | --- |
| `sp` | `r` — read only |
| `sr` | `b` — a single blob |
| `spr` | `https` — HTTPS only |
| `st` | omitted, so valid immediately |
| `se` | now + `plt_SasExpiryMinutes` |

No stored access policy and no IP restriction, so the token stands alone and revocation is by
expiry (or by rotating the account key, which invalidates all of them at once).

`BlobSasBuilder` implements the signature by hand, against
[Create a service SAS](https://learn.microsoft.com/rest/api/storageservices/create-service-sas).
Two details are easy to get wrong and worth knowing before editing it:

- The **field list is version-specific**. The sixteen fields in `BuildStringToSign` are the ones
  defined for `2020-12-06` and later. Bumping `SasVersion` without revisiting that list produces
  signatures Azure rejects with a 403 and no useful detail.
- The **canonicalized resource uses the unescaped blob name** (`/blob/<account>/<container>/<blob>`)
  while the URL path uses the percent-escaped one. Attachments with spaces or non-ASCII names are
  where this shows up.

A 403 from Azure with `AuthenticationFailed` almost always means the string-to-sign is wrong; a 403
with `AuthorizationPermissionMismatch` means the token is fine but the account or container denies
shared key access.

## Why not a managed identity

A managed identity and a user delegation SAS would avoid holding an account key, but the Dataverse
sandbox lets the plug-in make no outbound call — and obtaining a user delegation key requires one.
Signing with the account key is the only approach that works entirely in-process. If outbound calls
are acceptable in your design, moving this to an Azure Function with a managed identity is the
upgrade path.
