import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { checkUpload, safeName } from "../src/lib/storage.js";
import { loginAs, resetDb, world } from "./helpers.js";

const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n");
const EXE = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);

let w: Awaited<ReturnType<typeof world>>;
beforeEach(async () => {
  await resetDb();
  w = await world();
});

async function uploadAs(email: string, buf: Buffer, name: string, contentType: string, fields: Record<string, string> = {}) {
  const agent = await loginAs(email);
  let req = agent.post(`/api/projects/${w.project.id}/documents`);
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req.attach("file", buf, { filename: name, contentType });
}

describe("upload policy", () => {
  it("allows known types only when content matches", () => {
    expect(checkUpload({ originalname: "a.pdf", mimetype: "application/pdf", buffer: PDF, size: PDF.length }).ok).toBe(true);
    expect(checkUpload({ originalname: "a.pdf", mimetype: "application/pdf", buffer: EXE, size: EXE.length }).ok).toBe(false);
    expect(checkUpload({ originalname: "a.exe", mimetype: "application/x-msdownload", buffer: EXE, size: EXE.length }).ok).toBe(false);
    expect(checkUpload({ originalname: "a.png", mimetype: "application/pdf", buffer: PDF, size: PDF.length }).ok).toBe(false);
  });
  it("sanitises display names", () => {
    expect(safeName("../../etc/passwd")).toBe("passwd");
    expect(safeName('a"b<c>.pdf')).toBe("a_b_c_.pdf");
  });
});

describe("document endpoints", () => {
  it("members upload; file is stored under a generated id and audited", async () => {
    const res = await uploadAs(w.member.email, PDF, "pitch deck.pdf", "application/pdf");
    expect(res.status).toBe(201);
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: res.body.document.id } });
    expect(doc.storageKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(doc.originalName).toBe("pitch deck.pdf");
    expect(await prisma.auditLog.count({ where: { action: "document.uploaded", entityId: doc.id } })).toBe(1);
  });

  it("rejects disguised executables and oversized files", async () => {
    const bad = await uploadAs(w.member.email, EXE, "report.pdf", "application/pdf");
    expect(bad.status).toBe(415);
    const big = await uploadAs(w.member.email, Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]), "big.pdf", "application/pdf");
    expect(big.status).toBe(413);
    expect(await prisma.document.count()).toBe(0);
  });

  it("outsiders and unassigned mentors cannot upload, list or download", async () => {
    expect((await uploadAs(w.outsider.email, PDF, "x.pdf", "application/pdf")).status).toBe(404);
    const up = await uploadAs(w.member.email, PDF, "x.pdf", "application/pdf");
    const id = up.body.document.id as string;
    const outsider = await loginAs(w.outsider.email);
    expect((await outsider.get(`/api/documents/${id}/download`)).status).toBe(404);
    expect((await outsider.get(`/api/projects/${w.project.id}/documents`)).status).toBe(404);
    expect((await (await loginAs(w.otherMentor.email)).get(`/api/documents/${id}/download`)).status).toBe(404);
  });

  it("the assigned mentor can download as an attachment with the original bytes", async () => {
    const up = await uploadAs(w.member.email, PDF, "x.pdf", "application/pdf");
    const res = await (await loginAs(w.mentor.email)).get(`/api/documents/${up.body.document.id}/download`).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.from(res.body).equals(PDF)).toBe(true);
  });

  it("links to tasks only within the same project", async () => {
    const foreign = await prisma.task.create({ data: { projectId: w.otherProject.id, title: "f", createdById: w.admin.id } });
    expect((await uploadAs(w.member.email, PDF, "x.pdf", "application/pdf", { taskId: foreign.id })).status).toBe(400);
    const own = await prisma.task.create({ data: { projectId: w.project.id, title: "o", createdById: w.admin.id } });
    expect((await uploadAs(w.member.email, PDF, "x.pdf", "application/pdf", { taskId: own.id })).status).toBe(201);
  });

  it("only the uploader or the lead can delete", async () => {
    const up = await uploadAs(w.lead.email, PDF, "x.pdf", "application/pdf");
    const id = up.body.document.id as string;
    expect((await (await loginAs(w.member.email)).delete(`/api/documents/${id}`)).status).toBe(403);
    expect((await (await loginAs(w.lead.email)).delete(`/api/documents/${id}`)).status).toBe(204);
    expect(await prisma.document.count()).toBe(0);
  });
});
