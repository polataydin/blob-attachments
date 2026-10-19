# Custom actions

Two **legacy custom actions** (processes of type Action, not custom APIs). They are global
(unbound), so both take the record id as a string parameter.

| Action | Implemented by | Mode |
| --- | --- | --- |
| `plt_RequestAttachmentUrl` | `RequestAttachmentUrlPlugin` | Synchronous plug-in, returns a URL |
| `plt_DeleteBlobAttachment` | The **Delete Blob Attachment** flow | Asynchronous, no return value |

## plt_RequestAttachmentUrl

| Direction | Parameter | Type | Notes |
| --- | --- | --- | --- |
| Input | `BlobAttachmentId` | String | The `plt_blobattachment` record id. |
| Input | `Target` | EntityReference → `plt_blobattachment` | Accepted as an alternative if the action is defined bound. |
| Output | `Url` | String | Absolute HTTPS URL with a read-only SAS token. |

The `Url` output argument must exist on the action definition. Without it Dataverse returns
`204 No Content` and the control has nothing to open.

### Registration

Register `PLT.BlobAttachments.Plugins.RequestAttachmentUrlPlugin` on the `plt_RequestAttachmentUrl`
message, **PostOperation**, **synchronous**. The caller is waiting for the URL, so there is no
asynchronous option here.

**The step takes no configuration.** Leave both the unsecure and the secure configuration empty.
Everything the plug-in needs comes from environment variables, which means a new environment is
configured on the solution import screen rather than through the plug-in registration.

| Environment variable | Required | Notes |
| --- | --- | --- |
| `plt_StorageAccountName` | yes | e.g. `stemailattachmentsdev001`. |
| `plt_StorageAccountKey` | yes | Base64 account key. |
| `plt_ContainerName` | yes | Container holding the blobs. |
| `plt_SasExpiryMinutes` | no | Defaults to 5, clamped to 1–60. |
| `plt_BlobEndpoint` | no | Overrides the computed host entirely, for sovereign clouds or Azurite. |

`plt_StorageAccountKey` is a plain text environment variable, so anyone who can read environment
variables can read the key. Use a storage account dedicated to attachments, and rotate the key if
that is a concern.

### What the plug-in does

1. Reads the record id from `BlobAttachmentId` or `Target`.
2. Reads `plt_ContainerName` from the environment variables.
3. Retrieves `plt_blobpath` from the `plt_blobattachment` record **as the calling user**, so
   Dataverse row security governs who can get a URL. A missing or empty `plt_blobpath` is an error
   ("not copied to blob storage yet"), not an empty result. A leading `/` and a redundant container
   prefix are both stripped, since the migrate flow has written the path in more than one shape.
4. Reads the storage account name, key and optional endpoint, and the SAS lifetime.
5. Signs a service SAS locally with HMAC-SHA256 over the storage account key and returns the URL in
   `Url`. The URL itself is never traced: the signature in it grants read access to the blob.

## plt_DeleteBlobAttachment

| Direction | Parameter | Type | Notes |
| --- | --- | --- | --- |
| Input | `BlobAttachmentId` | String | The `plt_blobattachment` record id. |

No output. The **Delete Blob Attachment** flow is triggered by *When an action is performed* on
this message, reads `plt_blobpath` while the record still exists, deletes the blob and then deletes
the record. The control polls the record until it disappears, because a flow started from this
trigger runs asynchronously and cannot return anything to the caller.

The action exists because the Dataverse *when a row is deleted* trigger carries only the deleted
row's id, not its columns, so a flow on that trigger has no way to learn the blob path.

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