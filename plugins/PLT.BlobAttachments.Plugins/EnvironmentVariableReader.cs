using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using System;
using System.Globalization;

namespace PLT.BlobAttachments.Plugins
{
    /// <summary>
    /// Reads Dataverse environment variables, falling back to the definition's default value when
    /// the environment has no value row of its own.
    /// </summary>
    internal static class EnvironmentVariableReader
    {
        private const string DefinitionEntityName = "environmentvariabledefinition";
        private const string ValueEntityName = "environmentvariablevalue";
        private const string ValueAlias = "v";

        /// <summary>Returns the variable's value, or <c>null</c> when it is not set anywhere.</summary>
        internal static string GetString(IOrganizationService service, string schemaName)
        {
            if (service == null)
            {
                throw new ArgumentNullException(nameof(service));
            }

            var query = new QueryExpression(DefinitionEntityName)
            {
                NoLock = true,
                TopCount = 1,
                ColumnSet = new ColumnSet("defaultvalue"),
                Criteria =
                {
                    Conditions = { new ConditionExpression("schemaname", ConditionOperator.Equal, schemaName) },
                },
            };

            // Outer join: a definition with a default value and no environment specific value is valid.
            var valueLink = query.AddLink(
                ValueEntityName, "environmentvariabledefinitionid", "environmentvariabledefinitionid", JoinOperator.LeftOuter);
            valueLink.EntityAlias = ValueAlias;
            valueLink.Columns = new ColumnSet("value");

            var definitions = service.RetrieveMultiple(query).Entities;
            if (definitions.Count == 0)
            {
                return null;
            }

            var definition = definitions[0];

            if (definition.Contains(ValueAlias + ".value")
                && definition[ValueAlias + ".value"] is AliasedValue aliased
                && aliased.Value is string value
                && !string.IsNullOrWhiteSpace(value))
            {
                return value;
            }

            var defaultValue = definition.GetAttributeValue<string>("defaultvalue");
            return string.IsNullOrWhiteSpace(defaultValue) ? null : defaultValue;
        }

        /// <summary>
        /// Returns the variable parsed as an integer, clamped to [<paramref name="minimum"/>,
        /// <paramref name="maximum"/>]. Unset or unparseable values fall back to
        /// <paramref name="fallback"/>, which is clamped the same way.
        /// </summary>
        internal static int GetInt32(
            IOrganizationService service, string schemaName, int fallback, int minimum, int maximum)
        {
            var raw = GetString(service, schemaName);

            int parsed;
            if (string.IsNullOrEmpty(raw)
                || !int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed))
            {
                parsed = fallback;
            }

            if (parsed < minimum)
            {
                return minimum;
            }

            return parsed > maximum ? maximum : parsed;
        }
    }
}
