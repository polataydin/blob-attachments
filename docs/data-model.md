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
| `plt_filename` | Text (255) | The file name the control displays. |
| `plt_blobpath` | Text (500) | Blob name **relative to the container**, e.g. `<activityid>/<attachmentid>_quote-1042.pdf`. The only column the plug-in reads. |
| `plt_container` | Text (100) | The container the blob was written to, for traceability. |
| `plt_mimetype` | Text (100) | The attachment's content type. Drives the preview-or-download decision in the control. |
| `plt_filesize` | Whole number | Bytes, for display. |
| `plt_emailid` | Lookup → `email` | The email the attachment belongs to. The PCF dataset is filtered on this. |

Ownership is User/Team, matching `email`, so record access follows the email's own security.

`plt_sasurl` was used while SAS URLs were produced by a flow and polled by the control. The plug-in
returns the URL directly now, so the column is unused and can be dropped.

### plt_blobpath

The plug-in treats this as container-relative. It strips a leading `/`, and it strips a redundant
container prefix if one is present, since the migrate flow has written the value in both shapes.
The container itself comes from the `plt_ContainerName` environment variable, so the same records
keep working when a container is renamed or an environment points somewhere else.

The layout the migrate flow writes: