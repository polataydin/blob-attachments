# PLT.BlobAttachmentViewer

Scaffolded, not implemented. `pac pcf init --namespace PLT --name BlobAttachmentViewer
--template dataset --framework react` generated the project, and `HelloWorld.tsx`, `index.ts` and
`ControlManifest.Input.xml` are untouched. This file records what the control is meant to do, so
whoever picks it up is not reverse-engineering it from the README.

## Intended behaviour

A dataset control bound to a subgrid of `plt_blobattachment` records related to the email on the
form.

| Capability | Notes |
| --- | --- |
| List | File name, type icon, size, created on. |
| Preview | PDFs and images inline, from the signed URL. Everything else gets a download. |
| Download | Fetch the signed URL and hand the blob to the browser. |
| Attach | Draft emails only. Upload to blob storage and create the pointer record. |
| Delete | Draft emails only. Delete the pointer record; the delete flow removes the blob. |

Attach and delete are gated on the email still being a draft (`statecode`), matching how the stock
attachment list behaves — a sent email is a record of what was sent and should not change.

## Getting a URL

```ts
const response = await context.webAPI.execute(/* plt_RequestAttachmentUrl, bound to the record */);
const { Url } = await response.json();
```

Call it **per user action**, not per row on render. Each call signs a token valid for a few minutes
(`plt_SasExpiryMinutes`, default 5), so URLs fetched up front will have expired by the time anyone
clicks them — and signing URLs for rows nobody opens hands out access for no reason.

## Preview and CORS

Inline preview fetches the blob from Azure directly, which is a cross-origin request from the
Dynamics host. It needs a CORS rule on the blob service allowing `GET` from the Dynamics origin.
**Download works without CORS and preview does not**, which makes a missing CORS rule look like a
bug in the control.

The browser picks its renderer from the blob's stored `Content-Type`, set by the copy flow at
upload time. A blob stored as `application/octet-stream` downloads instead of previewing even for a
PDF.

## Manifest

Still the generated dataset manifest. It will need, at minimum, the dataset declared with the
columns the list shows, and `WebAPI` in `feature-usage` so `context.webAPI.execute` is permitted.

## Local development

```bash
cd pcf/BlobAttachmentViewer
npm install
npm run start:watch
```

The harness runs against mock data with no environment, so the list layout can be built there. The
custom action cannot be called from the harness — URL fetching needs a real environment, via
`pac pcf push --publisher-prefix plt` or a solution import.
