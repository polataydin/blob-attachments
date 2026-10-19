# blob-attachments

Moves Dynamics 365 email attachments out of Dataverse and into Azure Blob Storage, and gives
users a control on the email form that behaves like the stock attachment list.

Dataverse file storage is the most expensive storage an environment has, and mailbox
synchronisation fills it with attachments nobody opens again. This solution keeps the attachment
bytes in a blob container and keeps only a pointer record in Dataverse.

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
   |  (pointer record)          |                       |
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
   `activitymimeattachmentid`**, so a pointer and the attachment it came from can always be
   matched, and re-running the flow is idempotent.
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
| `pcf/BlobAttachmentViewer/` | PCF dataset control (React), from `pac pcf init --namespace PLT --name BlobAttachmentViewer --template dataset --framework react` |
| `plugins/PLT.BlobAttachments.Plugins/` | Plug-in assembly: .NET Framework 4.6.2, `Microsoft.CrmSdk.CoreAssemblies`, strong-name signed |
| `solution/` | Dataverse solution project (publisher `Polat`, prefix `plt`) referencing the PCF project |
| `docs/` | Data model, custom action contract, flow and registration notes |

The PCF control is **scaffolding only** — `HelloWorld.tsx` and the generated manifest are still as
`pac pcf init` left them. The plug-in is implemented.

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

- A **storage account** (StorageV2, HTTPS-only). Shared key access must stay enabled — that key
  is what signs the SAS. The container itself should allow no public access; the SAS is the only
  way in.
- A **blob container** for the attachments. Its name goes in `plt_ContainerName`.
- The **storage account key**, which lives in the plug-in step's *secure* configuration and
  nowhere else in the solution.
- A **CORS rule** on the blob service allowing `GET` from your Dynamics 365 origin, so the PCF
  control can fetch blobs for inline preview. Without it previews fail and only downloads work.

### Dataverse components

These are not in the repository — create them in the environment and add them to the solution as
you build it out:

| Component | Name | Notes |
| --- | --- | --- |
| Table | `plt_blobattachment` | Primary key equals the source `activitymimeattachmentid`. See [docs/data-model.md](docs/data-model.md). |
| Environment variable | `plt_ContainerName` | Text. The blob container holding the attachments. |
| Environment variable | `plt_SasExpiryMinutes` | Text, parsed as an integer. URL lifetime in minutes; defaults to 5, clamped to 1–60. |
| Custom action | `plt_RequestAttachmentUrl` | Legacy custom action. See [docs/custom-action.md](docs/custom-action.md). |
| Cloud flow | *Copy attachment to blob* | On create of `activitymimeattachment`. See [docs/flows.md](docs/flows.md). |
| Cloud flow | *Delete blob* | On delete of `plt_blobattachment`, so removing a pointer removes the blob. |
| Connection reference | Azure Blob Storage | Used by both flows. |

## Build

```bash
dotnet build plugins/PLT.BlobAttachments.Plugins/PLT.BlobAttachments.Plugins.csproj -c Release
```

```bash
cd pcf/BlobAttachmentViewer && npm install && npm run build
```

`npm run start:watch` runs the PCF test harness against mock data — the fastest way to work on the
control without touching an environment.

## Deployment

The repository holds no deployment automation on purpose. These are the steps, in order.

1. **Create the Azure side.** Storage account, container, CORS rule for `GET` from your Dynamics
   origin. Copy the account key somewhere you can paste from once.

2. **Create the Dataverse components** listed above in an unmanaged solution: the
   `plt_blobattachment` table, both environment variables, and the `plt_RequestAttachmentUrl`
   custom action. Set `plt_ContainerName`; leave `plt_SasExpiryMinutes` unset to accept the
   default of 5 minutes.

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
   | Unsecure configuration | `AccountName=<storage account>` |
   | Secure configuration | `AccountKey=<storage account key>` |

   Both configurations are `name=value` pairs separated by `;` or newlines. `EndpointSuffix` (for
   sovereign clouds) and `BlobEndpoint` (to override the host entirely) are also accepted. The key
   goes in the **secure** configuration, which is not carried in a solution export — so it must be
   set again in every environment.

4. **Build the solution package** and import it. The PCF control comes with it.

   ```bash
   dotnet build solution/solution.cdsproj -c Release
   ```

   Import the zip from `solution/bin/Release/`. While iterating on just the control,
   `pac pcf push --publisher-prefix plt` is quicker.

5. **Add the control to the email form.** Place a subgrid for `plt_blobattachment` related to the
   email, then set `PLT.BlobAttachmentViewer` as that subgrid's control.

6. **Import and turn on the flows**, pointing their Azure Blob Storage connection reference at the
   storage account and their container parameter at `plt_ContainerName`.

7. **Verify end to end.** Send yourself an email with a PDF attached, confirm a
   `plt_blobattachment` record appears with a `plt_blobpath`, and confirm the control previews it.
   If preview fails but download works, the CORS rule is wrong.

## Security notes

- A signed URL is a bearer token for that one blob until it expires. Keep `plt_SasExpiryMinutes`
  small; the plug-in refuses anything above 60 regardless of what the variable says.
- The plug-in reads the `plt_blobattachment` record **as the calling user**, so Dataverse row
  security decides who can get a URL. A user who cannot read the pointer record cannot reach the
  blob.
- Signed URLs are never written to the plug-in trace log — only the container and blob path are.
- Rotating the storage account key invalidates every outstanding URL and means updating the secure
  configuration on the step in each environment.
