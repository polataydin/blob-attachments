# blob-attachments

Moves Dynamics 365 email attachments out of Dataverse and into Azure Blob Storage, and gives
users a control on the email form that behaves like the stock attachment list.

Dataverse file storage is the most expensive storage an environment has, and mailbox
synchronisation fills it with attachments nobody opens again. This solution keeps the attachment
bytes in a blob container and keeps only a small record in Dataverse.

## How it works

```
         new email attachment
                 |
                 v
   +----------------------------+        +------------------------------+
   |  Power Automate flow       |  --->  |  Azure Blob Storage          |
   |  (copy, record, delete)    |        |  container: plt_ContainerName|
   +----------------------------+        +------------------------------+
                 |                                      ^
                 v                                      |
   +----------------------------+                       | SAS URL
   |  plt_blobattachment        |                       | (read, short-lived)
   |                            |                       |
   +----------------------------+                       |
                 ^                                      |
                 |  dataset                             |
   +----------------------------+        +------------------------------+
   |  PCF: BlobAttachmentViewer |  --->  |  plt_RequestAttachmentUrl    |
   |  (on the email form)       |        |  (plug-in signs the SAS)     |
   +----------------------------+        +------------------------------+
```

1. **A Power Automate flow** copies each new email attachment to Blob Storage and creates a
   `plt_blobattachment` record. The record's **primary key is the source
   `activitymimeattachmentid`**, so a record and the attachment it came from can always be matched,
   and re-running the flow is idempotent.
2. **A PCF dataset control**, `PLT.BlobAttachmentViewer`, sits on the email form over the
   `plt_blobattachment` records related to that email. It lists them, previews PDFs and images
   inline, downloads everything else, and allows attach and delete while the email is still a
   draft.
3. **A plug-in** handles the legacy custom action `plt_RequestAttachmentUrl`. It reads
   `plt_blobpath` from the `plt_blobattachment` record, signs a short-lived read-only SAS URL with
   the storage account key, and returns it in the `Url` output parameter. Signing is HMAC-SHA256
   done in-process: the plug-in takes no external package dependency and makes no outbound call,
   both of which the Dataverse sandbox would block anyway.

Attachment bytes never travel through Dataverse or through the plug-in. The browser fetches them
straight from Azure with the signed URL.

## Repository layout

| Path | What it is |
| --- | --- |
| `pcf/BlobAttachmentViewer/` | PCF dataset control (virtual, React) |
| `plugins/PLT.BlobAttachments.Plugins/` | Plug-in assembly: .NET Framework 4.6.2, `Microsoft.CrmSdk.CoreAssemblies`, strong-name signed |
| `solution/` | Dataverse solution project (publisher `Polat`, prefix `plt`) referencing the PCF project |
| `docs/` | Data model, custom action contract, flow and registration notes |

`PLT.BlobAttachments.Plugins.snk` is committed on purpose: the assembly's public key token has to
stay stable across builds and machines, or each environment sees a different assembly. It is a
build input, not a secret.

## Prerequisites

### Tooling

- [Power Platform CLI](https://aka.ms/PowerPlatformCLI) (`pac`) 2.x
- .NET SDK, with .NET Framework 4.6.2 reference assemblies (restored via the
  `Microsoft.NETFramework.ReferenceAssemblies` package, so no Framework install is needed)
- Node.js 18 or later and npm, for the PCF build
- Plug-in Registration Tool (`pac tool prt`) to register the assembly and step
- A Dataverse environment where you are System Customizer or better

### Azure

- A **storage account** (StorageV2, HTTPS-only). Shared key access must stay enabled, because that
  key is what signs the SAS. The container itself should allow no public access; the SAS is the
  only way in.
- A **blob container** for the attachments. Its name goes in `plt_ContainerName`.
- The **storage account key**, which goes in the `plt_StorageAccountKey` environment variable.
- A **CORS rule** on the blob service allowing `GET` from your Dynamics 365 origin, so the control
  can fetch a blob before handing it to the browser. Without it the download button does nothing.

### Dataverse components

These are not in the repository, so create them in the environment and add them to the solution as
you build it out:

| Component | Name | Notes |
| --- | --- | --- |
| Table | `plt_blobattachment` | Primary key equals the source `activitymimeattachmentid`. See [docs/data-model.md](docs/data-model.md). |
| Environment variable | `plt_StorageAccountName` | Text. The storage account holding the container. |
| Environment variable | `plt_StorageAccountKey` | Text. The storage account key, base64. |
| Environment variable | `plt_ContainerName` | Text. The blob container holding the attachments. |
| Environment variable | `plt_SasExpiryMinutes` | Text, parsed as an integer. URL lifetime in minutes; defaults to 5, clamped to 1-60. |
| Environment variable | `plt_BlobEndpoint` | Text, optional. Overrides the computed host, for sovereign clouds or Azurite. |
| Environment variable | `plt_DeleteSourceAttachment` | Yes/No. Whether the flow deletes the original attachment once it is in blob storage. |
| Custom action | `plt_RequestAttachmentUrl` | Legacy custom action with a `Url` string output. See [docs/custom-action.md](docs/custom-action.md). |
| Custom action | `plt_DeleteBlobAttachment` | Legacy custom action, input only. Served by the delete flow. |
| Cloud flow | *Migrate Email Attachment* | On create of `activitymimeattachment`. See [docs/flows.md](docs/flows.md). |
| Cloud flow | *Cleanup Sent Email Attachments* | Removes draft attachments once the email has been sent. |
| Cloud flow | *Delete Blob Attachment* | Triggered by `plt_DeleteBlobAttachment`, deletes the blob and the record. |
| Connection reference | Azure Blob Storage | Used by the flows. |
| Connection reference | Microsoft Dataverse | Used by the flows. |

## Build

```bash
dotnet build plugins/PLT.BlobAttachments.Plugins/PLT.BlobAttachments.Plugins.csproj -c Release
```

```bash
cd pcf/BlobAttachmentViewer && npm install && npm run build
```

`npm run start:watch` runs the PCF test harness against mock data, which is the fastest way to work
on the layout without touching an environment. The custom actions cannot be called from there.

## Deployment

The repository holds no deployment automation on purpose. These are the steps, in order.

1. **Create the Azure side.** Storage account, container, CORS rule for `GET` from your Dynamics
   origin. Copy the account key somewhere you can paste from once.

2. **Create the Dataverse components** listed above in an unmanaged solution: the
   `plt_blobattachment` table, the environment variables, and the `plt_RequestAttachmentUrl` and
   `plt_DeleteBlobAttachment` custom actions. Set `plt_StorageAccountName`,
   `plt_StorageAccountKey` and `plt_ContainerName`; leave `plt_SasExpiryMinutes` unset to accept
   the default of 5 minutes, and `plt_BlobEndpoint` unset unless you are on a sovereign cloud.

   `plt_RequestAttachmentUrl` must declare a `Url` string **output** argument. Without it the
   action returns `204 No Content` and the control has nothing to open.

3. **Build and register the plug-in.**

   ```bash
   dotnet build plugins/PLT.BlobAttachments.Plugins/PLT.BlobAttachments.Plugins.csproj -c Release
   ```

   Then in `pac tool prt`, register the assembly and add a step on `RequestAttachmentUrlPlugin`:

   | Setting | Value |
   | --- | --- |
   | Message | `plt_RequestAttachmentUrl` |
   | Stage | PostOperation |
   | Mode | Synchronous |
   | Run in user's context | Calling User |
   | Unsecure configuration | (leave empty) |
   | Secure configuration | (leave empty) |

   The step takes no configuration. The plug-in reads the storage account name, key, container and
   SAS lifetime from the environment variables at run time, so a new environment is configured on
   the solution import screen rather than through the plug-in registration.

4. **Build the solution package** and import it. The PCF control comes with it.

   ```bash
   dotnet build solution/solution.cdsproj -c Release
   ```

   Import the zip from `solution/bin/Release/`. While iterating on just the control,
   `pac pcf push --publisher-prefix plt --incremental` is quicker; a full push is only needed when
   the manifest changes.

5. **Add the control to the email form.** Place a subgrid for `plt_blobattachment` related to the
   email, then set `PLT.BlobAttachmentViewer` as that subgrid's control and map the four columns it
   declares.

6. **Import and turn on the flows**, pointing their Azure Blob Storage connection reference at the
   storage account.

7. **Verify end to end.** Send yourself an email with a PDF attached, confirm a
   `plt_blobattachment` record appears with a `plt_blobpath`, and confirm the control previews it.
   If preview works but the download button does nothing, the CORS rule is wrong.

## Security notes

- Users need **Read** on `plt_blobattachment`. The plug-in reads the record **as the calling user**,
  so Dataverse row security decides who can get a URL for a file. Nothing else on the table is
  required: the flows write and delete under their own connection.
- The plug-in step runs in the **calling user's context**, so the same user also needs read access
  to the environment variable tables (`environmentvariabledefinition` and
  `environmentvariablevalue`). Most security roles already grant this; a heavily restricted role
  may not, and the symptom is the plug-in reporting that `plt_StorageAccountName` has no value.
- Attach and delete in the control are gated on the user's **Create** and **Delete** privileges on
  `email`, which is how Dataverse governs `activitymimeattachment` itself; that table has no
  privileges of its own.
- A signed URL is a bearer token for that one blob until it expires. Keep `plt_SasExpiryMinutes`
  small; the plug-in refuses anything above 60 regardless of what the variable says.
- Signed URLs are never written to the plug-in trace log, only the container and blob path are.
- `plt_StorageAccountKey` is a plain text environment variable, so anyone who can read environment
  variables can read the key. Use a storage account dedicated to attachments, and rotate the key if
  that is a concern. Rotating it invalidates every outstanding URL and means updating the variable
  in each environment.