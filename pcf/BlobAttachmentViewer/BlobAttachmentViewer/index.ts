import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { AttachmentList, IAttachmentListProps, IAttachmentItem } from "./AttachmentList";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import * as React from "react";

interface OrgRecord { blockedattachments?: string; maxuploadfilesize?: number }
interface EmailRecord { statuscode?: number }
interface UrlResponse { Url?: string }

export class BlobAttachmentViewer implements ComponentFramework.ReactControl<IInputs, IOutputs> {
    private context: ComponentFramework.Context<IInputs>;
    private notifyOutputChanged: () => void;
    private blockedExtensions: string[] = [];
    private maxUploadSize = 5242880;

    public init(context: ComponentFramework.Context<IInputs>, notifyOutputChanged: () => void): void {
        this.context = context;
        this.notifyOutputChanged = notifyOutputChanged;
        void this.warmUp();
    }

    public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
        this.context = context;
        const ds = context.parameters.attachments;

        const items: IAttachmentItem[] = ds.sortedRecordIds.map(id => {
            const r = ds.records[id];
            return {
                id,
                fileName: r.getFormattedValue("fileName"),
                mimeType: r.getFormattedValue("mimeType"),
                fileSize: r.getValue("fileSize") as number,
                blobPath: r.getFormattedValue("blobPath")
            };
        });

        const props: IAttachmentListProps = {
            items,
            loading: ds.loading,
            hasDeletePrivilege: this.hasPrivilege(4),
            hasCreatePrivilege: this.hasPrivilege(1),
            isDraft: () => this.isDraft(),
            getUrl: (item: IAttachmentItem) => this.getUrl(item),
            onDelete: (item: IAttachmentItem) => this.deleteItem(item),
            onUpload: (files: File[]) => this.uploadFiles(files)
        };

        return React.createElement(
            FluentProvider, { theme: webLightTheme },
            React.createElement(AttachmentList, props)
        );
    }

    public getOutputs(): IOutputs { return {}; }
    public destroy(): void { /* nothing */ }

    private getEmailId(): string {
        const fromMode = (this.context.mode as unknown as { contextInfo?: { entityId?: string } }).contextInfo?.entityId;
        if (fromMode) return fromMode.replace(/[{}]/g, "");
        try {
            const xrm = (window as unknown as { Xrm?: { Utility?: { getPageContext?: () => { input?: { entityId?: string } } } } }).Xrm;
            const id = xrm?.Utility?.getPageContext?.()?.input?.entityId;
            return id ? id.replace(/[{}]/g, "") : "";
        } catch {
            return "";
        }
    }

    private async isDraft(): Promise<boolean> {
        const emailId = this.getEmailId();
        if (!emailId) return false;
        try {
            const email = await this.context.webAPI.retrieveRecord(
                "email", emailId, "?$select=statuscode"
            ) as EmailRecord;
            return email.statuscode === 1;
        } catch {
            return false;
        }
    }

    private async warmUp(): Promise<void> {
        try {
            await this.context.utils.getEntityMetadata("email");
        } catch {
            // ignore
        }
        try {
            const res = await this.context.webAPI.retrieveMultipleRecords(
                "organization", "?$select=blockedattachments,maxuploadfilesize"
            );
            const org = res.entities[0] as OrgRecord | undefined;
            if (org) {
                this.blockedExtensions = (org.blockedattachments ?? "")
                    .split(";")
                    .map(e => e.trim().toLowerCase())
                    .filter(e => e.length > 0);
                if (org.maxuploadfilesize) this.maxUploadSize = org.maxuploadfilesize;
            }
        } catch {
            // ignore
        }
        this.notifyOutputChanged();
    }

    private hasPrivilege(type: number): boolean {
        try {
            const privilegeType = type as ComponentFramework.PropertyHelper.Types.PrivilegeType;
            return [0, 1, 2, 3].some(depth =>
                this.context.utils.hasEntityPrivilege(
                    "email",
                    privilegeType,
                    depth as ComponentFramework.PropertyHelper.Types.PrivilegeDepth
                )
            );
        } catch {
            return false;
        }
    }

    private async getUrl(item: IAttachmentItem): Promise<string | null> {
        const request = {
            BlobAttachmentId: item.id,
            getMetadata: () => ({
                boundParameter: null,
                parameterTypes: {
                    BlobAttachmentId: { typeName: "Edm.String", structuralProperty: 1 }
                },
                operationType: 0,
                operationName: "plt_RequestAttachmentUrl"
            })
        };

        try {
            const webApi = this.context.webAPI as unknown as { execute: (req: unknown) => Promise<Response> };
            const resp = await webApi.execute(request);
            console.log("PLT url resp", resp.ok, resp.status);
            if (!resp.ok) return null;
            const data = await resp.json() as UrlResponse;
            console.log("PLT url data", data);
            return data.Url ?? null;
        } catch (e) {
            console.log("PLT url error", e);
            return null;
        }
    }

    private async deleteItem(item: IAttachmentItem): Promise<boolean> {
        const request = {
            BlobAttachmentId: item.id,
            getMetadata: () => ({
                boundParameter: null,
                parameterTypes: {
                    BlobAttachmentId: { typeName: "Edm.String", structuralProperty: 1 }
                },
                operationType: 0,
                operationName: "plt_DeleteBlobAttachment"
            })
        };

        try {
            const webApi = this.context.webAPI as unknown as { execute: (req: unknown) => Promise<Response> };
            const resp = await webApi.execute(request);
            if (!resp.ok) {
                await this.context.navigation.openAlertDialog({ text: "Delete failed. Please try again." });
                return false;
            }

            let removed = false;
            for (let i = 0; i < 10; i++) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                try {
                    await this.context.webAPI.retrieveRecord(
                        "plt_blobattachment", item.id, "?$select=plt_blobattachmentid"
                    );
                } catch {
                    removed = true;
                    break;
                }
            }

            this.context.parameters.attachments.refresh();
            return removed;
        } catch (e) {
            await this.context.navigation.openAlertDialog({ text: `Delete failed: ${(e as Error).message}` });
            return false;
        }
    }

    private async countBlobAttachments(emailId: string): Promise<number> {
        try {
            const res = await this.context.webAPI.retrieveMultipleRecords(
                "plt_blobattachment",
                `?$select=plt_blobattachmentid&$filter=_plt_emailid_value eq ${emailId}`
            );
            return res.entities.length;
        } catch {
            return -1;
        }
    }

    private async uploadFiles(files: File[]): Promise<boolean> {
        const emailId = this.getEmailId();
        if (!emailId) {
            await this.context.navigation.openAlertDialog({ text: "Save the email before adding attachments." });
            return false;
        }

        for (const file of files) {
            const extension = (file.name.split(".").pop() ?? "").toLowerCase();
            if (this.blockedExtensions.includes(extension)) {
                await this.context.navigation.openAlertDialog({ text: `${file.name}: this file type is not allowed.` });
                return false;
            }
            if (file.size > this.maxUploadSize) {
                const mb = (this.maxUploadSize / 1048576).toFixed(0);
                await this.context.navigation.openAlertDialog({ text: `${file.name}: file is larger than the ${mb} MB limit.` });
                return false;
            }
        }

        try {
            const before = await this.countBlobAttachments(emailId);

            for (const file of files) {
                const body = await this.toBase64(file);
                await this.context.webAPI.createRecord("activitymimeattachment", {
                    "objectid_email@odata.bind": `/emails(${emailId})`,
                    objecttypecode: "email",
                    filename: file.name,
                    mimetype: file.type || "application/octet-stream",
                    body: body
                });
            }

            if (before >= 0) {
                const expected = before + files.length;
                for (let i = 0; i < 10; i++) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    const current = await this.countBlobAttachments(emailId);
                    if (current >= expected) break;
                }
            } else {
                await new Promise(resolve => setTimeout(resolve, 5000));
            }

            this.context.parameters.attachments.refresh();
            return true;
        } catch (e) {
            await this.context.navigation.openAlertDialog({ text: `Upload failed: ${(e as Error).message}` });
            return false;
        }
    }

    private toBase64(file: File): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result as string;
                resolve(result.substring(result.indexOf(",") + 1));
            };
            reader.onerror = () => reject(new Error("read error"));
            reader.readAsDataURL(file);
        });
    }
}