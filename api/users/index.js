const { resolveAuth, listUsers } = require("../lib/auth");
const { json, getContainerClient, listBlobNames, safeSegment } = require("../lib/storage");

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

    const users = await attachDocumentCount(result.users, context);
    context.res = json(200, { ok: true, users });
  } catch (error) {
    context.log.error("users api failed", error);
    context.res = json(500, { ok: false, message: error?.message || "internal_error" });
  }
};

async function attachDocumentCount(users, context) {
  const list = Array.isArray(users) ? users : [];
  if (!list.length) return [];

  try {
    const container = await getContainerClient(DOCS_CONTAINER_NAME);
    const names = await listBlobNames(container, "");
    const counter = new Map();

    for (const name of names) {
      if (!String(name).endsWith(".json")) continue;
      const ownerPrefix = String(name).split("/")[0] || "";
      if (!ownerPrefix) continue;
      counter.set(ownerPrefix, (counter.get(ownerPrefix) || 0) + 1);
    }

    return list.map((user) => {
      const key = safeSegment(user?.id || "");
      return {
        ...user,
        documentCount: counter.get(key) || 0,
      };
    });
  } catch (error) {
    context.log.warn("attach document count failed", error);
    return list.map((user) => ({ ...user, documentCount: null }));
  }
}
