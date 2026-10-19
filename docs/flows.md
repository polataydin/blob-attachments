# Flows

Two cloud flows, neither in this repository yet. Build them in the environment and add them to the
solution, with a shared Azure Blob Storage connection reference.

## Copy attachment to blob

**Trigger:** Dataverse, *When a row is added* — table `Email Attachments`
(`activitymimeattachment`), scope Organization.

Steps:

1. **Get the attachment row** including `body` (base64), `filename`, `mimetype`, `filesize` and
   `objectid` (the email). The trigger output does not reliably carry `body`, so retrieve it.
2. **Guard clauses.** Skip inline images that are part of the message body
   (`isinline` / `attachmentcontentid` set) unless you want them moved too, and skip anything
   already pointed at by a `plt_blobattachment` record.
3. **Compose the blob path** — see [data-model.md](data-model.md):
   `email/<yyyy>/<MM>/<activityid>/<attachmentid>/<filename>`.
4. **Create the blob** from `base64ToBinary(body)`, setting **Content-Type** from `mimetype`. This
   header is what makes inline preview work later, so it is not optional.
5. **Create the `plt_blobattachment` record**, setting `plt_blobattachmentid` **explicitly** to the
   `activitymimeattachmentid`. That is what makes the flow idempotent — a re-run fails on the
   duplicate key instead of creating a second pointer.
6. **Delete the `activitymimeattachment` row.** This is the step that actually frees Dataverse file
   capacity, and the one to be most careful with: put it after the create succeeds, never in
   parallel with it, and configure its run-after so it cannot execute when an earlier step failed
   or was skipped.

Set the flow's concurrency to 1 while testing. Attachments arrive in bursts when a mailbox syncs,
and a partial copy followed by a delete is the one failure mode that loses data.

## Delete blob

**Trigger:** Dataverse, *When a row is deleted* — table `plt_blobattachment`.

Read `plt_blobpath` from the pre-image and delete that blob from `plt_ContainerName`. Treat a
missing blob as success: the record is gone either way, and failing here only produces noise.

This is what makes the PCF control's delete action complete — the control deletes the pointer
record and the flow cleans up the blob behind it.

## Container name

Both flows should read the container from the `plt_ContainerName` environment variable rather than
hard-coding it, so an import into another environment needs no edits.

## Failure handling

The copy flow is the only place where data can be lost, so it is worth a configured run-after path:
on failure of the create-record or create-blob steps, do **not** delete the original attachment,
and raise something visible (a record in an error table, a Teams message) rather than letting the
run fail silently in the history.
