# Data model

## plt_blobattachment

One record per attachment that lives in blob storage. The table is **not** in this repository yet —
create it in the environment and add it to the solution.

The decisive design choice: **the primary key is the source `activitymimeattachmentid`**. The flow
supplies the id rather than letting Dataverse generate one, which makes the copy idempotent (a
re-run hits a duplicate key instead of creating a second pointer) and means a pointer can always be
traced back to the attachment row it replaced, even after that row is deleted.

| Column | Type | Notes |
| --- | --- | --- |
| `plt_blobattachmentid` | Unique identifier | Primary key. Set explicitly to the source `activitymimeattachmentid`. |
| `plt_name` | Text (primary name) | The original file name, e.g. `quote-1042.pdf`. |
| `plt_blobpath` | Text (400) | Blob name **relative to the container**, e.g. `email/2026/10/<activityid>/<attachmentid>/quote-1042.pdf`. The only column the plug-in reads. |
| `plt_mimetype` | Text (100) | The attachment's content type. Drives the preview-or-download decision in the control. |
| `plt_filesize` | Whole number | Bytes, for display. |
| `plt_regardingobjectid` | Lookup → `email` | The email the attachment belongs to. The PCF dataset is filtered on this. |

### plt_blobpath

The plug-in treats this as container-relative and strips a leading `/` if one is present. The
container is **not** part of the value — it comes from the `plt_ContainerName` environment
variable, so the same records keep working when a container is renamed or an environment points
somewhere else.

A path layout that keeps the container browsable and avoids collisions:

```
email/<yyyy>/<MM>/<activityid>/<attachmentid>/<filename>
```

The attachment id segment is what guarantees uniqueness; the date and activity segments exist so a
human can find things in Storage Explorer.

### Content type

Set the blob's `Content-Type` at upload time, in the flow, from the attachment's MIME type. Getting
this right in the flow is what makes inline PDF and image preview work — the browser decides how to
render a blob from the response header, and the plug-in deliberately does not override it in the
SAS. (`BlobSasBuilder.BuildReadOnlyBlobUrl` accepts optional `rsct` and `rscd` overrides if you
later need to force a download or correct a stored content type, but the plug-in does not pass
them.)

## Relationship to the stock tables

`activitymimeattachment` rows are the originals. Once a copy is confirmed in blob storage, the flow
deletes the original row so the Dataverse file capacity is actually released — that deletion is the
whole point of the solution, and it is the step to be most careful with when testing.

The `plt_blobattachment` table sits alongside the stock relationship rather than replacing it:
nothing in Dynamics knows about blob attachments, so the PCF control on the form is the only place
users see them.
