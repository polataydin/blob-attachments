using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using System;
using System.Globalization;

namespace PLT.BlobAttachments.Plugins
{
    /// <summary>
    /// Handles the legacy custom action <c>plt_RequestAttachmentUrl</c>: given a
    /// <c>plt_blobattachment</c> record, returns a short-lived read-only SAS URL for the blob that
    /// backs it.
    /// </summary>
    /// <remarks>
    /// Register as a synchronous step on the <c>plt_RequestAttachmentUrl</c> message, stage
    /// PostOperation. All configuration comes from environment variables, so the step itself needs
    /// no configuration. The URL is signed in-process; the plug-in never calls out to Azure.
    /// <para>
    /// The <c>plt_blobattachment</c> record is read as the *calling* user, so a user who cannot read
    /// the record cannot obtain a URL for it.
    /// </para>
    /// </remarks>
    public class RequestAttachmentUrlPlugin : PluginBase
    {
        private const string TargetInputParameter = "Target";
        private const string BlobAttachmentIdInputParameter = "BlobAttachmentId";
        private const string UrlOutputParameter = "Url";

        private const string BlobAttachmentEntityName = "plt_blobattachment";
        private const string BlobPathAttributeName = "plt_blobpath";

        private const string ContainerNameVariable = "plt_ContainerName";
        private const string SasExpiryMinutesVariable = "plt_SasExpiryMinutes";
        private const string StorageAccountNameVariable = "plt_StorageAccountName";
        private const string StorageAccountKeyVariable = "plt_StorageAccountKey";
        private const string BlobEndpointVariable = "plt_BlobEndpoint";

        private const int DefaultSasExpiryMinutes = 5;
        private const int MinimumSasExpiryMinutes = 1;

        /// <summary>
        /// Upper bound on the lifetime of a signed URL, whatever <c>plt_SasExpiryMinutes</c> says.
        /// A URL that leaves the browser is a bearer token for the blob, so the window stays small.
        /// </summary>
        private const int MaximumSasExpiryMinutes = 60;

        public RequestAttachmentUrlPlugin()
            : base(typeof(RequestAttachmentUrlPlugin))
        {
        }

        protected override void ExecuteDataversePlugin(ILocalPluginContext localPluginContext)
        {
            if (localPluginContext == null)
            {
                throw new ArgumentNullException(nameof(localPluginContext));
            }

            var context = localPluginContext.PluginExecutionContext;
            var systemService = localPluginContext.PluginUserService;

            var blobAttachmentId = ReadBlobAttachmentId(context);
            localPluginContext.Trace(
                string.Format(CultureInfo.InvariantCulture, "Resolving blob URL for {0}", blobAttachmentId));

            var containerName = EnvironmentVariableReader.GetString(systemService, ContainerNameVariable);
            if (string.IsNullOrEmpty(containerName))
            {
                throw new InvalidPluginExecutionException(
                    "The environment variable " + ContainerNameVariable + " has no value.");
            }

            var blobPath = RetrieveBlobPath(
                localPluginContext.InitiatingUserService, blobAttachmentId, containerName);

            StorageAccountSettings storage;
            try
            {
                storage = StorageAccountSettings.Create(
                    EnvironmentVariableReader.GetString(systemService, StorageAccountNameVariable),
                    EnvironmentVariableReader.GetString(systemService, StorageAccountKeyVariable),
                    EnvironmentVariableReader.GetString(systemService, BlobEndpointVariable));
            }
            catch (ConfigurationException ex)
            {
                throw new InvalidPluginExecutionException(
                    "The blob storage configuration is incomplete: " + ex.Message, ex);
            }

            var expiryMinutes = EnvironmentVariableReader.GetInt32(
                systemService,
                SasExpiryMinutesVariable,
                DefaultSasExpiryMinutes,
                MinimumSasExpiryMinutes,
                MaximumSasExpiryMinutes);

            var expiresOnUtc = DateTime.UtcNow.AddMinutes(expiryMinutes);

            var url = BlobSasBuilder.BuildReadOnlyBlobUrl(storage, containerName, blobPath, expiresOnUtc);

            localPluginContext.Trace(
                string.Format(
                    CultureInfo.InvariantCulture,
                    "Signed a read-only URL for {0}/{1}, valid for {2} minute(s)",
                    containerName,
                    blobPath,
                    expiryMinutes));

            // Never trace the URL itself: the signature in it grants read access to the blob.
            context.OutputParameters[UrlOutputParameter] = url;
        }

        /// <summary>
        /// Accepts either shape of the custom action: bound to <c>plt_blobattachment</c> (the record
        /// arrives as <c>Target</c>), or global with a <c>BlobAttachmentId</c> string parameter.
        /// </summary>
        private static Guid ReadBlobAttachmentId(IPluginExecutionContext context)
        {
            if (context.InputParameters.Contains(TargetInputParameter))
            {
                if (context.InputParameters[TargetInputParameter] is EntityReference reference)
                {
                    if (!string.Equals(reference.LogicalName, BlobAttachmentEntityName, StringComparison.Ordinal))
                    {
                        throw new InvalidPluginExecutionException(
                            "plt_RequestAttachmentUrl expects a " + BlobAttachmentEntityName
                            + " record but was called with a " + reference.LogicalName + ".");
                    }

                    return reference.Id;
                }

                if (context.InputParameters[TargetInputParameter] is Entity entity)
                {
                    return entity.Id;
                }
            }

            if (context.InputParameters.Contains(BlobAttachmentIdInputParameter))
            {
                var raw = context.InputParameters[BlobAttachmentIdInputParameter] as string;

                Guid parsed;
                if (!Guid.TryParse(raw, out parsed) || parsed == Guid.Empty)
                {
                    throw new InvalidPluginExecutionException(
                        BlobAttachmentIdInputParameter + " is not a valid record id.");
                }

                return parsed;
            }

            throw new InvalidPluginExecutionException(
                "plt_RequestAttachmentUrl requires either a " + TargetInputParameter + " reference or a "
                + BlobAttachmentIdInputParameter + " parameter.");
        }

        private static string RetrieveBlobPath(
            IOrganizationService service, Guid blobAttachmentId, string containerName)
        {
            var record = service.Retrieve(
                BlobAttachmentEntityName, blobAttachmentId, new ColumnSet(BlobPathAttributeName));

            var blobPath = record.GetAttributeValue<string>(BlobPathAttributeName);

            if (string.IsNullOrWhiteSpace(blobPath))
            {
                throw new InvalidPluginExecutionException(
                    "This attachment has no " + BlobPathAttributeName
                    + " value, so it has not been copied to blob storage yet.");
            }

            // plt_blobpath is stored relative to the container; tolerate a stray leading slash and a
            // redundant container prefix, since the migrate flow has written both shapes over time.
            blobPath = blobPath.Trim().TrimStart('/');

            var prefix = containerName + "/";
            if (blobPath.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                blobPath = blobPath.Substring(prefix.Length);
            }

            return blobPath;
        }
    }
}