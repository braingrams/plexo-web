// Browser side of an SSR zip upload. The zip goes to the app in 3 MB parts (ssr-upload/chunk), which
// stages and assembles it server-side. Then ssr-deploy queues the build from the assembled zip.
// Nothing is sent from the browser straight to storage.

const PART_BYTES = 3 * 1024 * 1024;

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export async function uploadSsrZip(templateId: string, file: File, onPart?: (sent: number, total: number) => void): Promise<Result<{ uploadKey: string }>> {
  const total = Math.max(1, Math.ceil(file.size / PART_BYTES));
  const session = crypto.randomUUID();
  for (let index = 0; index < total; index++) {
    const res = await fetch(`/api/v1/templates/${templateId}/ssr-upload/chunk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Upload-Session": session,
        "X-Chunk-Index": String(index),
        "X-Chunk-Total": String(total),
      },
      body: file.slice(index * PART_BYTES, (index + 1) * PART_BYTES),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error ?? `The upload stopped at part ${index + 1} of ${total} (server responded ${res.status}). Try again.` };
    onPart?.(index + 1, total);
    if (data.status === "assembled") return { ok: true, data: { uploadKey: data.uploadKey as string } };
  }
  return { ok: false, error: "The upload didn't finish. Try again." };
}

export async function queueSsrBuild(templateId: string, uploadKey: string): Promise<Result<{ message: string; warnings: string[] }>> {
  const res = await fetch(`/api/v1/templates/${templateId}/ssr-deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadKey }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error ?? `The server couldn't start the build (server responded ${res.status}). Try again.` };
  return { ok: true, data: { message: data.message as string, warnings: (data.warnings ?? []) as string[] } };
}
