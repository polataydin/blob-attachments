/**
 * Turning the bound dataset into the rows the list renders.
 */

/** Broad file families, used for the type icon and the preview-or-download decision. */
export type FileCategory =
    | "pdf"
    | "image"
    | "word"
    | "excel"
    | "powerpoint"
    | "archive"
    | "text"
    | "email"
    | "other";

export interface AttachmentItem {
    /** plt_blobattachmentid, which is also the source activitymimeattachmentid. */
    id: string;
    fileName: string;
    mimeType: string;
    /** Bytes, or null when plt_filesize is empty. */
    fileSize: number | null;
    /** Already localised by the platform; empty when the column is unavailable. */
    createdOn: string;
    category: FileCategory;
}

/** The property-set aliases declared in ControlManifest.Input.xml. */
type ColumnAlias = "fileName" | "mimeType" | "fileSize" | "createdOn";

/**
 * Logical names to fall back on when a property-set has not been mapped to a view
 * column — which is the normal case in the test harness, and a misconfigured subgrid
 * in a real environment. Falling back keeps the list readable instead of blank.
 */
const COLUMN_FALLBACKS: Record<ColumnAlias, string[]> = {
    fileName: ["plt_name"],
    mimeType: ["plt_mimetype"],
    fileSize: ["plt_filesize"],
    createdOn: ["createdon"],
};

const EXTENSION_CATEGORIES: Record<string, FileCategory> = {
    pdf: "pdf",
    png: "image",
    jpg: "image",
    jpeg: "image",
    gif: "image",
    bmp: "image",
    webp: "image",
    svg: "image",
    doc: "word",
    docx: "word",
    rtf: "word",
    odt: "word",
    xls: "excel",
    xlsx: "excel",
    csv: "excel",
    ods: "excel",
    ppt: "powerpoint",
    pptx: "powerpoint",
    odp: "powerpoint",
    zip: "archive",
    rar: "archive",
    "7z": "archive",
    tar: "archive",
    gz: "archive",
    txt: "text",
    log: "text",
    json: "text",
    xml: "text",
    md: "text",
    msg: "email",
    eml: "email",
};

/** MIME types the browser renders inline from a plain URL, with no CORS rule needed. */
const INLINE_PREVIEW_CATEGORIES: ReadonlySet<FileCategory> = new Set<FileCategory>(["pdf", "image"]);

export function fileExtension(fileName: string): string {
    const lastDot = fileName.lastIndexOf(".");
    if (lastDot <= 0 || lastDot === fileName.length - 1) {
        return "";
    }
    return fileName.slice(lastDot + 1).toLowerCase();
}

/**
 * Classifies by MIME type first — it is what the copy flow stored on the blob and what
 * the browser will act on — and by file extension only when the MIME type is missing or
 * the generic application/octet-stream.
 */
export function categorise(fileName: string, mimeType: string): FileCategory {
    const mime = mimeType.toLowerCase();

    if (mime === "application/pdf") {
        return "pdf";
    }
    if (mime.startsWith("image/")) {
        return "image";
    }
    if (mime.startsWith("text/")) {
        return "text";
    }
    if (mime.includes("wordprocessing") || mime === "application/msword") {
        return "word";
    }
    if (mime.includes("spreadsheet") || mime === "application/vnd.ms-excel") {
        return "excel";
    }
    if (mime.includes("presentation") || mime === "application/vnd.ms-powerpoint") {
        return "powerpoint";
    }
    if (mime.includes("zip") || mime.includes("compressed") || mime.includes("tar")) {
        return "archive";
    }
    if (mime === "message/rfc822" || mime === "application/vnd.ms-outlook") {
        return "email";
    }

    return EXTENSION_CATEGORIES[fileExtension(fileName)] ?? "other";
}

/**
 * Whether the browser can render this inline in an iframe or img. Everything else is
 * offered as a download instead — see docs/pcf-control.md.
 */
export function isInlinePreviewable(category: FileCategory): boolean {
    return INLINE_PREVIEW_CATEGORIES.has(category);
}

const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatFileSize(bytes: number | null): string {
    if (bytes === null || !Number.isFinite(bytes) || bytes < 0) {
        return "";
    }

    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
        value /= 1024;
        unit += 1;
    }

    const rounded = unit === 0 ? String(Math.round(value)) : value.toFixed(value >= 10 ? 0 : 1);
    return `${rounded} ${SIZE_UNITS[unit]}`;
}

type DataSet = ComponentFramework.PropertyTypes.DataSet;
type EntityRecord = ComponentFramework.PropertyHelper.DataSetApi.EntityRecord;

function resolveColumn(dataset: DataSet, alias: ColumnAlias): string | undefined {
    const byAlias = dataset.columns.find((column) => column.alias === alias);
    if (byAlias) {
        return byAlias.name;
    }

    for (const logicalName of COLUMN_FALLBACKS[alias]) {
        const byName = dataset.columns.find((column) => column.name === logicalName);
        if (byName) {
            return byName.name;
        }
    }

    return undefined;
}

function readString(record: EntityRecord, column: string | undefined): string {
    if (column === undefined) {
        return "";
    }

    const formatted = record.getFormattedValue(column);
    if (formatted) {
        return formatted;
    }

    const raw = record.getValue(column);
    return typeof raw === "string" ? raw : "";
}

function readNumber(record: EntityRecord, column: string | undefined): number | null {
    if (column === undefined) {
        return null;
    }

    const raw = record.getValue(column);
    if (typeof raw === "number") {
        return raw;
    }
    if (typeof raw === "string" && raw.trim() !== "") {
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
}

/**
 * Projects the dataset into rows, skipping ids the platform lists but has not delivered
 * a record for (which happens mid-paging).
 */
export function toAttachmentItems(dataset: DataSet): AttachmentItem[] {
    const columns = {
        fileName: resolveColumn(dataset, "fileName"),
        mimeType: resolveColumn(dataset, "mimeType"),
        fileSize: resolveColumn(dataset, "fileSize"),
        createdOn: resolveColumn(dataset, "createdOn"),
    };

    const items: AttachmentItem[] = [];

    for (const id of dataset.sortedRecordIds) {
        const record = dataset.records[id];
        if (!record) {
            continue;
        }

        const fileName = readString(record, columns.fileName) || "(unnamed)";
        const mimeType = readString(record, columns.mimeType);

        items.push({
            id: record.getRecordId(),
            fileName,
            mimeType,
            fileSize: readNumber(record, columns.fileSize),
            createdOn: readString(record, columns.createdOn),
            category: categorise(fileName, mimeType),
        });
    }

    return items;
}
