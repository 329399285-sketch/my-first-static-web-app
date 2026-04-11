const { randomUUID } = require("crypto");
const { resolveAuth } = require("../lib/auth");
const { getContainerClient, safeSegment, readJson, writeJson, deleteBlob, listBlobNames, json } = require("../lib/storage");

const CONTAINER_NAME = process.env.DOCS_CONTAINER_NAME || "word-card-documents";

module.exports = async function (context, req) {
  const method = String(req.method || "GET").toUpperCase();
  const routeId = req.params?.id ? decodeURIComponent(req.params.id) : "";

  try {
    const auth = await resolveAuth(req);
    if (!auth) {
      context.res = json(401, { ok: false, message: "unauthorized" });
      return;
    }

    const ownerId = resolveOwnerId(req, auth.user);
    if (!ownerId) {
      context.res = json(403, { ok: false, message: "forbidden" });
      return;
    }

    const container = await getContainerClient(CONTAINER_NAME);

    if (method === "GET") {
      if (routeId) {
        const document = await getDocument(container, ownerId, routeId);
        if (!document) {
          context.res = json(404, { ok: false, message: "document_not_found" });
          return;
        }
        context.res = json(200, { ok: true, document });
        return;
      }

      const documents = await listDocuments(container, ownerId);
      context.res = json(200, { ok: true, documents });
      return;
    }

    if (method === "PUT") {
      const body = normalizeBody(req.body);
      const documentId = routeId || String(body.id || randomUUID());
      const now = new Date().toISOString();
      const document = normalizeDocument({
        ...body,
        id: documentId,
        ownerId,
        updatedAt: now,
        createdAt: body.createdAt || now,
      });

      await saveDocument(container, ownerId, document.id, document);
      context.res = json(200, { ok: true, document });
      return;
    }

    if (method === "DELETE") {
      if (!routeId) {
        context.res = json(400, { ok: false, message: "id_required" });
        return;
      }
      await deleteBlob(container, getBlobName(ownerId, routeId));
      context.res = json(200, { ok: true });
      return;
    }

    context.res = json(405, { ok: false, message: "method_not_allowed" });
  } catch (error) {
    context.log.error("documents api failed", error);
    context.res = json(500, { ok: false, message: error?.message || "internal_error" });
  }
};

function resolveOwnerId(req, user) {
  if (!user) return "";
  const targetFromQuery =
    typeof req.query?.get === "function"
      ? req.query.get("targetUser")
      : req.query?.targetUser;
  const target = String(targetFromQuery || req.headers?.["x-target-user"] || req.headers?.["X-Target-User"] || "").trim();
  if (!target) return user.id;
  if (user.role === "admin") return target;
  return target === user.id ? target : "";
}

async function listDocuments(container, ownerId) {
  const prefix = `${safeSegment(ownerId)}/`;
  const names = await listBlobNames(container, prefix);
  const documents = [];

  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const id = getIdFromBlobName(name);
    if (!id) continue;

    const document = await getDocument(container, ownerId, id);
    if (document) documents.push(document);
  }

  documents.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return documents;
}

async function getDocument(container, ownerId, id) {
  const blobName = getBlobName(ownerId, id);
  const parsed = await readJson(container, blobName, null);
  if (!parsed) return null;
  return normalizeDocument(parsed);
}

async function saveDocument(container, ownerId, id, document) {
  await writeJson(container, getBlobName(ownerId, id), document);
}

function normalizeDocument(input) {
  const source = input || {};
  return {
    id: String(source.id || randomUUID()),
    ownerId: String(source.ownerId || ""),
    name: String(source.name || "未命名文档"),
    type: String(source.type || "text/plain"),
    size: Number(source.size || 0),
    createdAt: source.createdAt || null,
    updatedAt: source.updatedAt || null,
    rawText: typeof source.rawText === "string" ? source.rawText : "",
    parsedCards: Array.isArray(source.parsedCards) ? source.parsedCards : [],
    parsedAt: source.parsedAt || null,
  };
}

function normalizeBody(body) {
  if (!body) return {};
  if (typeof body === "object") return body;
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return {};
}

function getBlobName(ownerId, id) {
  return `${safeSegment(ownerId)}/${safeSegment(id)}.json`;
}

function getIdFromBlobName(blobName) {
  const parts = String(blobName || "").split("/");
  const filename = parts[parts.length - 1] || "";
  if (!filename.endsWith(".json")) return "";
  return filename.slice(0, -5);
}
