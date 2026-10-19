using System;
using System.Globalization;

namespace PLT.BlobAttachments.Plugins
{
    /// <summary>
    /// Storage account coordinates used to sign SAS URLs, read from Dataverse environment variables.
    /// </summary>
    /// <remarks>
    /// Values come from the environment variables plt_StorageAccountName, plt_StorageAccountKey and
    /// the optional plt_BlobEndpoint, so the solution is configured at import time without touching
    /// the plug-in step registration.
    /// </remarks>
    internal sealed class StorageAccountSettings
    {
        private const string DefaultEndpointSuffix = "core.windows.net";

        private StorageAccountSettings(string accountName, byte[] accountKey, string blobEndpoint)
        {
            AccountName = accountName;
            AccountKey = accountKey;
            BlobEndpoint = blobEndpoint;
        }

        /// <summary>The storage account name, used in the canonicalized resource and the host name.</summary>
        internal string AccountName { get; }

        /// <summary>The decoded storage account key, used as the HMAC-SHA256 signing key.</summary>
        internal byte[] AccountKey { get; }

        /// <summary>Blob service endpoint without a trailing slash.</summary>
        internal string BlobEndpoint { get; }

        internal static StorageAccountSettings Create(string accountName, string accountKeyBase64, string blobEndpoint)
        {
            if (string.IsNullOrWhiteSpace(accountName))
            {
                throw new ConfigurationException("The environment variable plt_StorageAccountName has no value.");
            }

            if (string.IsNullOrWhiteSpace(accountKeyBase64))
            {
                throw new ConfigurationException("The environment variable plt_StorageAccountKey has no value.");
            }

            byte[] accountKey;
            try
            {
                accountKey = Convert.FromBase64String(accountKeyBase64.Trim());
            }
            catch (FormatException ex)
            {
                throw new ConfigurationException("plt_StorageAccountKey is not a valid base64 string.", ex);
            }

            if (string.IsNullOrWhiteSpace(blobEndpoint))
            {
                blobEndpoint = string.Format(
                    CultureInfo.InvariantCulture, "https://{0}.blob.{1}", accountName.Trim(), DefaultEndpointSuffix);
            }

            return new StorageAccountSettings(accountName.Trim(), accountKey, blobEndpoint.Trim().TrimEnd('/'));
        }
    }

    /// <summary>Raised when the configuration cannot be used.</summary>
    internal sealed class ConfigurationException : Exception
    {
        internal ConfigurationException(string message)
            : base(message)
        {
        }

        internal ConfigurationException(string message, Exception innerException)
            : base(message, innerException)
        {
        }
    }
}