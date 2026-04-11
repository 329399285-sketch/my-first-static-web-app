const { resolveAuth, listUsers } = require("../lib/auth");
const { json } = require("../lib/storage");

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
      context.res = json(403, { ok: false, message: "forbidden" });
      return;
    }

    context.res = json(200, { ok: true, users: result.users });
  } catch (error) {
    context.log.error("users api failed", error);
    context.res = json(500, { ok: false, message: error?.message || "internal_error" });
  }
};
