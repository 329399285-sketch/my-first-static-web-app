const { registerUser, loginUser, resolveAuth, logoutByToken, readToken } = require("../lib/auth");
const { json } = require("../lib/storage");

module.exports = async function (context, req) {
  const method = String(req.method || "GET").toUpperCase();
  const action = String(req.params?.action || "").toLowerCase();

  try {
    if (method === "POST" && action === "register") {
      const body = normalizeBody(req.body);
      const result = await registerUser(body.username, body.password);
      context.res = result.ok
        ? json(200, result)
        : json(400, { ok: false, message: result.message || "register_failed" });
      return;
    }

    if (method === "POST" && action === "login") {
      const body = normalizeBody(req.body);
      const result = await loginUser(body.username, body.password);
      context.res = result.ok
        ? json(200, result)
        : json(401, { ok: false, message: result.message || "login_failed" });
      return;
    }

    if (method === "GET" && action === "me") {
      const auth = await resolveAuth(req);
      if (!auth) {
        context.res = json(401, { ok: false, message: "unauthorized" });
        return;
      }
      context.res = json(200, { ok: true, user: auth.user });
      return;
    }

    if (method === "POST" && action === "logout") {
      const token = readToken(req);
      if (token) await logoutByToken(token);
      context.res = json(200, { ok: true });
      return;
    }

    context.res = json(404, { ok: false, message: "not_found" });
  } catch (error) {
    context.log.error("auth api failed", error);
    context.res = json(500, { ok: false, message: error?.message || "internal_error" });
  }
};

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
