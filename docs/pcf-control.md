# PLT.BlobAttachmentViewer

A virtual React dataset control, bound to a subgrid of `plt_blobattachment` records related to the
email on the form.

## Behaviour

| Capability | Notes |
| --- | --- |
| List | Tiles with a file type icon, name and size. |
| Preview | PDFs and images inline, from the signed URL. Everything else shows "No preview available" with a download button. |
| Download | Fetches the signed URL and hands the blob to the browser with its original file name. |
| Attach | Draft emails only. Creates `activitymimeattachment` rows; the migrate flow copies them to blob storage. |
| Delete | Draft emails only. Calls `plt_DeleteBlobAttachment` and waits for the record to disappear. |

Attach and delete are gated on two things: the email is still a draft (`statuscode` 1), and the user
has the matching privilege on `email`. A sent email is a record of what was sent and should not
change, which is also how the stock attachment list behaves.

Uploads are validated against the organization's own rules before anything is created: the blocked
file extension list and the maximum file size from System Settings, both read from the
`organization` table.

## Getting a URL

```ts
const response = await context.webAPI.execute(/* plt_RequestAttachmentUrl, BlobAttachmentId */);
const { Url } = await response.json();
```

Call it **per user action**, not per row on render. Each call signs a token valid for a few minutes
(`plt_SasExpiryMinutes`, default 5), so URLs fetched up front will have expired by the time anyone
clicks them — and signing URLs for rows nobody opens hands out access for no reason.

If the response is `204 No Content`, the action definition is missing its `Url` output argument.

## Deleting

`plt_DeleteBlobAttachment` is served by a flow, and a flow started from the *when an action is
performed* trigger cannot return anything to its caller. The control therefore polls the record
once a second, up to ten times, and stops either when the record is gone or when the attempts run
out. It never keeps polling indefinitely.

## Preview and CORS

Inline preview fetches the blob from Azure directly, which is a cross-origin request from the
Dynamics host. It needs a CORS rule on the blob service allowing `GET` from the Dynamics origin.
**Preview of an image or PDF in an iframe works without CORS, but the download button does not**,
because it fetches the blob as a blob before saving it. A missing CORS rule therefore looks like a
dead download button.

The browser picks its renderer from the blob's stored `Content-Type`, set by the migrate flow at
upload time. A blob stored as `application/octet-stream` downloads instead of previewing even for a
PDF.

## Manifest

The dataset declares four bound columns — `fileName`, `mimeType`, `fileSize` and `blobPath` — and
`feature-usage` declares `WebAPI` and `Utility`. `Utility` is required: without it,
`context.utils.getEntityMetadata` throws and the privilege checks silently fall back to false,
which hides the attach and delete affordances.

`external-service-usage` lists `*.blob.core.windows.net`.

## Local development

```bash
cd pcf/BlobAttachmentViewer
npm install
npm run start:watch
```

The harness runs against mock data with no environment, so the list layout can be built there. The
custom actions cannot be called from the harness — URL fetching and deleting need a real
environment, via `pac pcf push --publisher-prefix plt` or a solution import.

Deploy code changes with `--incremental`; a full push is only needed when the manifest changes.

```bash
npm run build
pac pcf push --publisher-prefix plt --incremental
```