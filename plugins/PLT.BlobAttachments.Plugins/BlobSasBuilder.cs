using System;
using System.Collections.Generic;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace PLT.BlobAttachments.Plugins
{
    /// <summary>
    /// Builds a read-only service SAS URL for a single blob, signed with the storage account key.
    /// </summary>
    /// <remarks>
    /// This is a from-scratch implementation of the service SAS signature described in
    /// https://learn.microsoft.com/rest/api/storageservices/create-service-sas. The Dataverse
    /// sandbox allows neither third party assemblies nor outbound calls from this plug-in, so the
    /// token is signed locally with <see cref="HMACSHA256"/> and no request is made to Azure.
    /// </remarks>
    internal static class BlobSasBuilder
    {
        /// <summary>
        /// Service SAS version. The field list in <see cref="BuildStringToSign"/> is the one
        /// defined for 2020-12-06 and later; changing this constant without changing that list
        /// produces signatures Azure will reject.
        /// </summary>
        private const string SasVersion = "2020-12-06";

        private const string SignedResourceBlob = "b";
        private const string SignedPermissionsRead = "r";
        private const string SignedProtocolHttpsOnly = "https";

        /// <summary>
        /// Returns an absolute, read-only, HTTPS-only URL for <paramref name="blobName"/> that
        /// stops working at <paramref name="expiresOnUtc"/>.
        /// </summary>
        /// <param name="settings">Storage account coordinates and signing key.</param>
        /// <param name="containerName">Container holding the blob.</param>
        /// <param name="blobName">Blob name relative to the container, unescaped, e.g. <c>email/2026/file.pdf</c>.</param>
        /// <param name="expiresOnUtc">Expiry, in UTC.</param>
        /// <param name="contentDisposition">Optional <c>rscd</c> override, e.g. <c>attachment; filename="report.pdf"</c>.</param>
        /// <param name="contentType">Optional <c>rsct</c> override, e.g. <c>application/pdf</c>.</param>
        internal static string BuildReadOnlyBlobUrl(
            StorageAccountSettings settings,
            string containerName,
            string blobName,
            DateTime expiresOnUtc,
            string contentDisposition = null,
            string contentType = null)
        {
            if (settings == null)
            {
                throw new ArgumentNullException(nameof(settings));
            }

            if (string.IsNullOrEmpty(containerName))
            {
                throw new ArgumentException("A container name is required.", nameof(containerName));
            }

            if (string.IsNullOrEmpty(blobName))
            {
                throw new ArgumentException("A blob name is required.", nameof(blobName));
            }

            var expiry = FormatUtc(expiresOnUtc);

            // The canonicalized resource uses the *unescaped* blob name, the URL path uses the escaped one.
            var canonicalizedResource = string.Format(
                CultureInfo.InvariantCulture, "/blob/{0}/{1}/{2}", settings.AccountName, containerName, blobName);

            var stringToSign = BuildStringToSign(
                canonicalizedResource, expiry, contentDisposition ?? string.Empty, contentType ?? string.Empty);

            var signature = Sign(stringToSign, settings.AccountKey);

            var query = new List<string>
            {
                "sv=" + Escape(SasVersion),
                "sr=" + Escape(SignedResourceBlob),
                "sp=" + Escape(SignedPermissionsRead),
                "se=" + Escape(expiry),
                "spr=" + Escape(SignedProtocolHttpsOnly),
            };

            if (!string.IsNullOrEmpty(contentDisposition))
            {
                query.Add("rscd=" + Escape(contentDisposition));
            }

            if (!string.IsNullOrEmpty(contentType))
            {
                query.Add("rsct=" + Escape(contentType));
            }

            // The signature goes last so it is easy to strip when tracing a URL.
            query.Add("sig=" + Escape(signature));

            return string.Format(
                CultureInfo.InvariantCulture,
                "{0}/{1}/{2}?{3}",
                settings.BlobEndpoint,
                Escape(containerName),
                EscapePath(blobName),
                string.Join("&", query.ToArray()));
        }

        /// <summary>
        /// The service SAS string-to-sign for a blob, version 2020-12-06 and later. Field order and
        /// count are part of the contract: every field is present, empty ones as empty strings, and
        /// there is no trailing newline after the last one.
        /// </summary>
        private static string BuildStringToSign(
            string canonicalizedResource, string expiry, string contentDisposition, string contentType)
        {
            var fields = new[]
            {
                SignedPermissionsRead,     // sp
                string.Empty,              // st  - valid immediately
                expiry,                    // se
                canonicalizedResource,
                string.Empty,              // signed identifier - no stored access policy
                string.Empty,              // sip - no IP restriction
                SignedProtocolHttpsOnly,   // spr
                SasVersion,                // sv
                SignedResourceBlob,        // sr
                string.Empty,              // snapshot time
                string.Empty,              // encryption scope
                string.Empty,              // rscc - Cache-Control
                contentDisposition,        // rscd - Content-Disposition
                string.Empty,              // rsce - Content-Encoding
                string.Empty,              // rscl - Content-Language
                contentType,               // rsct - Content-Type
            };

            return string.Join("\n", fields);
        }

        private static string Sign(string stringToSign, byte[] accountKey)
        {
            using (var hmac = new HMACSHA256(accountKey))
            {
                return Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(stringToSign)));
            }
        }

        private static string FormatUtc(DateTime value)
        {
            return value.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture);
        }

        private static string Escape(string value)
        {
            return Uri.EscapeDataString(value);
        }

        /// <summary>Escapes each path segment, keeping the separators intact.</summary>
        private static string EscapePath(string blobName)
        {
            var segments = blobName.Split('/');
            for (var i = 0; i < segments.Length; i++)
            {
                segments[i] = Uri.EscapeDataString(segments[i]);
            }

            return string.Join("/", segments);
        }
    }
}
