# Flows

Three cloud flows, none of them in this repository yet. Build them in the environment and add them
to the solution, with a shared Azure Blob Storage connection reference and a Dataverse connection
reference.

A fourth flow, **Get Attachment Download URLs**, is retired. It generated SAS URLs before the
plug-in existed and can be deleted.

## Migrate Email Attachment

**Trigger:** Dataverse, *When a row is added* — table `Attachments` (`activitymimeattachment`),
scope Organization, filter `objecttypecode eq 'email'`.

Steps:

1. **Get the attachment row** including `body` (base64), `filename`, `mimetype` and `filesize`. The
   trigger output does not reliably carry `body`, so retrieve it.
2. **Create the blob** from `base64ToBinary(body)` at
   `<activityid>/<activitymimeattachmentid>_<filename>`, setting **Content-Type** from `mimetype`.
   That header is what makes inline preview work later, so it is not optional.
3. **Create the `plt_blobattachment` record**, setting `plt_blobattachmentid` **explicitly** to the
   `activitymimeattachmentid`. That is what makes the flow idempotent — a re-run fails on the
   duplicate key instead of creating a second pointer.
4. **Optionally delete the source attachment.** Guarded by two conditions: the
   `plt_DeleteSourceAttachment` environment variable is true, **and** the parent email is Sent (3)
   or Received (4). A draft email still needs its attachment rows, because Exchange sends the files
   from `activitymimeattachment.body`; deleting them early sends an email with nothing attached.

Set the flow's concurrency to 1 while testing. Attachments arrive in bursts when a mailbox syncs,
and a partial copy followed by a delete is the one failure mode that loses data.

## Cleanup Sent Email Attachments

**Trigger:** Dataverse, *When a row is modified* — table `Email Messages`, filter
`statuscode eq 3`.

Draft attachments are copied to blob storage but deliberately left in Dataverse so the email can be
sent. This flow removes them once the email has gone out: it checks
`plt_DeleteSourceAttachment`, lists the email's `activitymimeattachment` rows and deletes them.

## Delete Blob Attachment

**Trigger:** Dataverse, *When an action is performed* — `plt_DeleteBlobAttachment`.

1. **Get the `plt_blobattachment` row** by `triggerOutputs()?['body/InputParameters/BlobAttachmentId']`,
   selecting `plt_blobpath`.
2. **Delete the blob** at that path.
3. **Delete the `plt_blobattachment` row.**

The order matters: the path lives on the record, so the record has to be read before it is deleted.
This is also why the flow is triggered by an action rather than by *when a row is deleted* — that
trigger returns only the deleted row's id, with none of its columns.

Treat a missing blob as success: the record is going away either way, and failing here only
produces noise.

## Container name

All flows should read the container from the `plt_ContainerName` environment variable rather than
hard-coding it, so an import into another environment needs no edits.

## Failure handling

The migrate flow is the only place where data can be lost, so it is worth a configured run-after
path: on failure of the create-record or create-blob steps, do **not** delete the original
attachment, and raise something visible (a record in an error table, a Teams message) rather than
letting the run fail silently in the history.