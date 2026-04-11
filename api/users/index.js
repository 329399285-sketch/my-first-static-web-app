const { resolveAuth, listUsers, deleteUser } = require("../lib/auth");
const { json, getContainerClient, listBlobNames, safeSegment, readJson, deleteBlob } = require("../lib/storage");

const DOCS_CONTAINER_NAME = process.env.DOCS_CONTAINER_NAME || "word-card-documents";

module.exports = async function (context, req) {
  const method = String(req.method || "GET").toUpperCase();

  try {
    if (method === "GET") {
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
      return;
    }

    if (method === "DELETE") {
      const auth = await resolveAuth(req);
      if (!auth) {
        context.res = json(401, { ok: false, message: "unauthorized" });
        return;
      }

      const targetUserId = readDeleteTargetUserId(req);
      if (!targetUserId) {
        context.res = json(400, { ok: false, message: "user_id_required" });
        return;
      }

      const result = await deleteUser(auth.user, targetUserId);
      if (!result.ok) {
        const statusByMessage = {
          forbidden: 403,
          user_not_found: 404,
          cannot_delete_self: 400,
          cannot_delete_admin: 400,
          user_id_required: 400,
        };
        context.res = json(statusByMessage[result.message] || 400, {
          ok: false,
          message: result.message || "delete_user_failed",
        });
        return;
      }

      const removedDocumentCount = await deleteUserDocuments(targetUserId, context);
      context.res = json(200, {
        ok: true,
        user: result.user,
        removedSessionCount: Number(result.removedSessionCount || 0),
        removedDocumentCount,
      });
      return;
    }

    context.res = json(405, { ok: false, message: "method_not_allowed" });
  } catch (error) {
    context.log.error("users api failed", error);
    context.res = json(500, { ok: false, message: error?.message || "internal_error" });
  }
};

function readDeleteTargetUserId(req) {
  const query = req?.query;
  if (query) {
    if (typeof query.get === "function") {
      const fromMap = query.get("userId") || query.get("id") || query.get("targetUser") || "";
      if (fromMap) return String(fromMap).trim();
    } else {
      const fromObj = query.userId || query.id || query.targetUser || "";
      if (fromObj) return String(fromObj).trim();
    }
  }

  const body = normalizeBody(req?.body);
  return String(body.userId || body.id || "").trim();
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

async function deleteUserDocuments(ownerId, context) {
  const container = await getContainerClient(DOCS_CONTAINER_NAME);
  const prefix = `${safeSegment(ownerId)}/`;
  const names = await listBlobNames(container, prefix);

  let removed = 0;
  for (const name of names) {
    await deleteBlob(container, name);
    removed += 1;
  }

  context.log.info("deleted user documents", { ownerId, removed });
  return removed;
}
