"use client";
import { useRef, useState } from "react";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm";
import { api } from "@/lib/api-client";
import { formatDate } from "@/lib/utils";
import { useAction } from "@/lib/use-action";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.pptx,.txt,.md,.csv";
const MAX_BYTES = 10 * 1024 * 1024;

interface Doc { id: string; originalName: string; sizeBytes: number; createdAt: string; uploadedBy: { id: string; name: string } }

function size(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function DocumentsPanel({ projectId, documents, canUpload, canManage, userId }: { projectId: string; documents: Doc[]; canUpload: boolean; canManage: boolean; userId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { run } = useAction();

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast.error("The file is larger than 10 MB");
      return;
    }
    const body = new FormData();
    body.append("file", file);
    setUploading(true);
    // Multipart upload (the JSON api() helper is not used here).
    await run(async () => {
      const res = await fetch(`/api/projects/${projectId}/documents`, { method: "POST", body, credentials: "same-origin" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(data?.error?.message ?? `Upload failed (${res.status})`);
      }
      return res.json();
    }, "Document uploaded");
    setUploading(false);
    if (input.current) input.current.value = "";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Documents
          {canUpload ? (
            <>
              <input ref={input} type="file" accept={ACCEPT} className="sr-only" id="doc-upload" onChange={(e) => onFile(e.target.files?.[0])} />
              <Button size="sm" variant="outline" disabled={uploading} onClick={() => input.current?.click()}><Upload /> {uploading ? "Uploading…" : "Upload"}</Button>
            </>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <p className="text-xs text-muted-foreground">No documents uploaded.{canUpload ? " PDF, images, Office files, text or CSV up to 10 MB." : ""}</p>
        ) : (
          <ul className="space-y-2">
            {documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate">{d.originalName}</span>
                    <span className="block text-[11px] text-muted-foreground">{size(d.sizeBytes)} · {d.uploadedBy.name} · {formatDate(d.createdAt)}</span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center">
                  <Button asChild size="icon" variant="ghost"><a href={`/api/documents/${d.id}/download`} aria-label={`Download ${d.originalName}`}><Download /></a></Button>
                  {canManage || d.uploadedBy.id === userId ? (
                    <ConfirmButton variant="ghost" size="icon" destructive title={`Delete ${d.originalName}?`} description="The file is removed permanently. This is recorded in the audit log." confirmLabel="Delete" onConfirm={() => run(() => api(`/documents/${d.id}`, { method: "DELETE" }), "Document deleted")}>
                      <Trash2 aria-label="Delete document" />
                    </ConfirmButton>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
