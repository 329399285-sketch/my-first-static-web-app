const { resolveAuth, listUsers } = require("../lib/auth");
const { json, getContainerClient, listBlobNames, safeSegment, readJson } = require("../lib/storage");

const DOCS_CONTAINER_NAME = process.env.DOCS_CONTAINER_NAME || "word-card-documents";

module.exports = async function (context, req) {
  const method = String(req.method || "GET").toUpperCase();

  try {
    if (method !== "GET") {
      context.res = json(405, { ok: false, message: "method_not_allowed" });
      return;
    }

    const auth = await resolveAuth(req);
    if (!auth) {
      context.res = json(401, { ok: false, message: "unauthorized" });
      return;
    }

    const result = await listUsers(auth.user);
    if (!result.ok) {
      context.res = json(403, { ok: false, message: result.message || "forbidden" });
      return;
    }

    const users = await attachDocumentSummary(result.users, context);
    context.res = json(200, { ok: true, users });
  } catch (error) {
    context.log.error("users api failed", error);
    context.res = json(500, { ok: false, message: error?.message || "internal_error" });
  }
};

async function attachDocumentSummary(users, context) {
  const list = Array.isArray(users) ? users : [];
  if (!list.length) return [];

  try {
    const container = await getContainerClient(DOCS_CONTAINER_NAME);
    const names = await listBlobNames(container, "");
    const summary = new Map();

    for (const name of names) {
      if (!String(name).endsWith(".json")) continue;
      const ownerPrefix = String(name).split("/")[0] || "";
      if (!ownerPrefix) continue;

      const meta = summary.get(ownerPrefix) || {
        documentCount: 0,
        parsedDocumentCount: 0,
        totalCardCount: 0,
        totalDocSize: 0,
        lastDocumentUpdatedAt: null,
      };

      meta.documentCount += 1;
      const document = await readJson(container, name, null);
      if (document) {
        const size = Number(document.size || 0);
        if (Number.isFinite(size) && size > 0) {
          meta.totalDocSize += size;
        }

        const parsedCards = Array.isArray(document.parsedCards) ? document.parsedCards : [];
        if (parsedCards.length) {
          meta.parsedDocumentCount += 1;
          meta.totalCardCount += parsedCards.length;
        }

        const updatedAt = document.updatedAt || document.parsedAt || document.createdAt || null;
        if (updatedAt) {
          const updatedMs = new Date(updatedAt).getTime();
          const prevMs = meta.lastDocumentUpdatedAt ? new Date(meta.lastDocumentUpdatedAt).getTime() : NaN;
          if (!Number.isFinite(prevMs) || (Number.isFinite(updatedMs) && updatedMs > prevMs)) {
            meta.lastDocumentUpdatedAt = updatedAt;
          }
        }
      }

      summary.set(ownerPrefix, meta);
    }

    return list.map((user) => {
      const key = safeSegment(user?.id || "");
      const meta = summary.get(key) || {
        documentCount: 0,
        parsedDocumentCount: 0,
        totalCardCount: 0,
        totalDocSize: 0,
        lastDocumentUpdatedAt: null,
      };
      return {
        ...user,
        documentCount: meta.documentCount,
        parsedDocumentCount: meta.parsedDocumentCount,
        totalCardCount: meta.totalCardCount,
        totalDocSize: meta.totalDocSize,
        lastDocumentUpdatedAt: meta.lastDocumentUpdatedAt,
      };
    });
  } catch (error) {
    context.log.warn("attach document summary failed", error);
    return list.map((user) => ({
      ...user,
      documentCount: null,
      parsedDocumentCount: null,
      totalCardCount: null,
      totalDocSize: null,
      lastDocumentUpdatedAt: null,
    }));
  }
}
