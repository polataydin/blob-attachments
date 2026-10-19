import * as React from "react";
import {
    Button, Spinner, Text, Dialog, DialogSurface, DialogBody, DialogTitle,
    DialogContent, DialogActions
} from "@fluentui/react-components";

export interface IAttachmentItem {
    id: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    blobPath: string;
}

export interface IAttachmentListProps {
    items: IAttachmentItem[];
    loading: boolean;
    hasDeletePrivilege: boolean;
    hasCreatePrivilege: boolean;
    isDraft: () => Promise<boolean>;
    getUrl: (item: IAttachmentItem) => Promise<string | null>;
    onDelete: (item: IAttachmentItem) => Promise<boolean>;
    onUpload: (files: File[]) => Promise<boolean>;
}

interface IPreview { item: IAttachmentItem; url: string | null }

const formatSize = (b: number): string =>
    !b ? "" : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;

const isImage = (m: string): boolean => !!m && m.startsWith("image/");
const isPdf = (m: string, n: string): boolean => m === "application/pdf" || n.toLowerCase().endsWith(".pdf");
const ext = (n: string): string => (n.split(".").pop() ?? "").toLowerCase();

const download = async (url: string, name: string): Promise<void> => {
    const resp = await fetch(url);
    const blob = await resp.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = name;
    a.click();
    URL.revokeObjectURL(objUrl);
};

const FolderIcon: React.FC = () => (
    <svg width="90" height="90" viewBox="0 0 90 90">
        <circle cx="45" cy="45" r="45" fill="#0F6CBD" />
        <path fill="#fff" d="M25 33h14l4 4h22v22H25z" />
        <circle cx="39" cy="50" r="2" fill="#0F6CBD" />
        <circle cx="45" cy="50" r="2" fill="#0F6CBD" />
        <circle cx="51" cy="50" r="2" fill="#0F6CBD" />
    </svg>
);

const TrashIcon: React.FC = () => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="#424242">
        <path d="M8.5 4h3a1.5 1.5 0 0 0-3 0zm-1 0a2.5 2.5 0 0 1 5 0h5a.5.5 0 0 1 0 1h-1.05l-1.2 10.34A3 3 0 0 1 12.27 18H7.73a3 3 0 0 1-2.98-2.66L3.55 5H2.5a.5.5 0 0 1 0-1h5zM5.74 15.23A2 2 0 0 0 7.73 17h4.54a2 2 0 0 0 1.99-1.77L15.44 5H4.56l1.18 10.23zM8.5 7.5c.28 0 .5.22.5.5v6a.5.5 0 0 1-1 0V8c0-.28.22-.5.5-.5zm3.5.5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V8z" />
    </svg>
);

const AttachIcon: React.FC = () => (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
        <path d="M13.5 3a3.5 3.5 0 0 1 3.5 3.5v7a4 4 0 0 1-8 0V7a.5.5 0 0 1 1 0v6.5a3 3 0 0 0 6 0v-7a2.5 2.5 0 0 0-5 0v7a1.5 1.5 0 0 0 3 0V7a.5.5 0 0 1 1 0v6.5a2.5 2.5 0 0 1-5 0v-7A3.5 3.5 0 0 1 13.5 3z" />
    </svg>
);

const FileIcon: React.FC<{ name: string; mime: string }> = ({ name, mime }) => {
    const e = ext(name);
    let color = "#605E5C";
    let label = "";
    if (["doc", "docx"].includes(e)) { color = "#185ABD"; label = "W"; }
    else if (["xls", "xlsx", "csv"].includes(e)) { color = "#107C41"; label = "X"; }
    else if (["ppt", "pptx"].includes(e)) { color = "#C43E1C"; label = "P"; }
    else if (e === "pdf") { color = "#D13438"; label = "PDF"; }
    else if (isImage(mime) || ["png", "jpg", "jpeg", "gif"].includes(e)) { color = "#8764B8"; label = "IMG"; }
    return (
        <svg width="40" height="48" viewBox="0 0 40 48">
            <path d="M4 2h22l10 10v34H4z" fill="#fff" stroke="#8A8886" strokeWidth="1.5" />
            <path d="M26 2v10h10" fill="none" stroke="#8A8886" strokeWidth="1.5" />
            <rect x="0" y="22" width="28" height="18" rx="2" fill={color} />
            <text x="14" y="35" fontSize={label.length > 1 ? 9 : 13} fontWeight="bold" fill="#fff" textAnchor="middle">{label}</text>
        </svg>
    );
};

export const AttachmentList: React.FC<IAttachmentListProps> = ({ items, loading, hasDeletePrivilege, hasCreatePrivilege, isDraft, getUrl, onDelete, onUpload }) => {
    const [preview, setPreview] = React.useState<IPreview | null>(null);
    const [toDelete, setToDelete] = React.useState<IAttachmentItem | null>(null);
    const [busy, setBusy] = React.useState(false);
    const [opening, setOpening] = React.useState<string | null>(null);
    const [deleting, setDeleting] = React.useState<string | null>(null);
    const [uploading, setUploading] = React.useState(false);
    const [draft, setDraft] = React.useState(false);
    const fileInput = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        let active = true;
        const load = async (): Promise<void> => {
            const value = await isDraft();
            if (active) setDraft(value);
        };
        void load();
        return () => { active = false; };
    }, [items.length]);

    const canDelete = draft && hasDeletePrivilege;
    const canUpload = draft && hasCreatePrivilege;

    const open = async (item: IAttachmentItem): Promise<void> => {
        setOpening(item.id);
        try {
            const url = await getUrl(item);
            setPreview({ item, url });
        } finally {
            setOpening(null);
        }
    };

    const confirmDelete = async (): Promise<void> => {
        if (!toDelete) return;
        const target = toDelete;
        setBusy(true);
        setToDelete(null);
        setDeleting(target.id);
        try {
            await onDelete(target);
        } finally {
            setDeleting(null);
            setBusy(false);
        }
    };

    const pickFiles = (e: React.ChangeEvent<HTMLInputElement>): void => {
        const list = e.target.files;
        if (!list || list.length === 0) return;
        const files: File[] = Array.from(list);
        e.target.value = "";
        setUploading(true);
        void onUpload(files).finally(() => setUploading(false));
    };

    if (loading) return <Spinner size="small" />;

    const p: IPreview | null = preview;
    const canPreview: boolean = !!p?.url && (isImage(p.item.mimeType) || isPdf(p.item.mimeType, p.item.fileName));

    return (
        <div style={{ width: "100%", boxSizing: "border-box" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", minHeight: 32, marginBottom: 12 }}>
                <Text weight="semibold" size={300}>{`Attachments (${items.length})`}</Text>
                {canUpload && (
                    <div style={{ marginLeft: "auto" }}>
                        <input ref={fileInput} type="file" multiple style={{ display: "none" }} onChange={pickFiles} />
                        <Button appearance="subtle" size="small" icon={<AttachIcon />} disabled={uploading} onClick={() => fileInput.current?.click()}>
                            {uploading ? "Uploading..." : "Attach file"}
                        </Button>
                    </div>
                )}
            </div>

            {items.length === 0 && (
                <div style={{ padding: "12px 0" }}>
                    <Text size={200} style={{ color: "#616161" }}>No attachments.</Text>
                </div>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {items.map((i: IAttachmentItem) => (
                    <div key={i.id}
                         style={{ position: "relative", width: 118, height: 118, border: "1px solid #e0e0e0", borderRadius: 4,
                                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 8, boxSizing: "border-box",
                                  opacity: deleting === i.id ? 0.5 : 1 }}>
                        {canDelete && deleting !== i.id && (
                            <div onClick={(e) => { e.stopPropagation(); setToDelete(i); }} title="Delete attachment"
                                 style={{ position: "absolute", top: 6, left: 6, width: 28, height: 28, border: "1px solid #e0e0e0", borderRadius: 4, background: "#fff",
                                          display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 1 }}>
                                <TrashIcon />
                            </div>
                        )}
                        <div onClick={() => { if (deleting !== i.id) void open(i); }} style={{ cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
                            {opening === i.id || deleting === i.id
                                ? <Spinner size="small" />
                                : <FileIcon name={i.fileName} mime={i.mimeType} />}
                            <Text size={200} style={{ marginTop: 8, width: "100%", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.fileName}</Text>
                            <Text size={100} style={{ marginTop: 2, color: "#616161" }}>{formatSize(i.fileSize)}</Text>
                        </div>
                    </div>
                ))}
            </div>

            <Dialog open={!!p} onOpenChange={(_, d) => { if (!d.open) setPreview(null); }}>
                <DialogSurface style={{ width: "60vw", maxWidth: "60vw", height: "85vh" }}>
                    <DialogBody style={{ height: "100%" }}>
                        <DialogTitle>Attachment preview</DialogTitle>
                        <DialogContent style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
                            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "auto" }}>
                                {p && canPreview && isImage(p.item.mimeType) && (
                                    <img src={p.url ?? ""} alt={p.item.fileName} style={{ maxWidth: "100%", maxHeight: "100%" }} />
                                )}
                                {p && canPreview && !isImage(p.item.mimeType) && (
                                    <iframe src={`${p.url ?? ""}#toolbar=0&navpanes=0&view=FitH`} title={p.item.fileName} style={{ width: "100%", height: "100%", border: 0 }} />
                                )}
                                {p && !canPreview && (
                                    <div style={{ textAlign: "center" }}>
                                        <FolderIcon />
                                        <Text block weight="semibold" size={500} style={{ marginTop: 16 }}>No preview available</Text>
                                        <Text block size={200} style={{ marginTop: 8 }}>Select download to view this attachment.</Text>
                                    </div>
                                )}
                            </div>
                            {p && (
                                <Text block size={300} weight="semibold" style={{ textAlign: "center", padding: "8px 0", borderBottom: "1px solid #e0e0e0" }}>
                                    File name: {p.item.fileName}
                                </Text>
                            )}
                        </DialogContent>
                        <DialogActions>
                            <Button appearance="primary" disabled={!p?.url} onClick={() => { if (p?.url) void download(p.url, p.item.fileName); }}>Download</Button>
                            <Button appearance="secondary" onClick={() => setPreview(null)}>Close</Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>

            <Dialog open={!!toDelete} onOpenChange={(_, d) => { if (!d.open) setToDelete(null); }}>
                <DialogSurface style={{ width: 540 }}>
                    <DialogBody>
                        <DialogTitle>Delete attachment</DialogTitle>
                        <DialogContent>Do you want to delete 1 attachment?</DialogContent>
                        <DialogActions>
                            <Button appearance="primary" disabled={busy} onClick={() => { void confirmDelete(); }}>Delete</Button>
                            <Button appearance="secondary" onClick={() => setToDelete(null)}>Cancel</Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
        </div>
    );
};