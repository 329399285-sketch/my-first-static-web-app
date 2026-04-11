const { createHash, randomBytes, randomUUID } = require("crypto");
const { getContainerClient, safeSegment, readJson, writeJson, deleteBlob, listBlobNames } = require("./storage");

const AUTH_CONTAINER = process.env.AUTH_CONTAINER_NAME || "word-card-auth";
const SESSION_DAYS = normalizeSessionDays(process.env.AUTH_SESSION_DAYS, 30);
const SESSION_TOUCH_INTERVAL_MS = 60 * 1000;
const ONLINE_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_ADMIN_USERNAME = normalizeUsername(process.env.DEFAULT_ADMIN_USERNAME || "xiaoyang");
const DEFAULT_ADMIN_PASSWORD = String(process.env.DEFAULT_ADMIN_PASSWORD || "000823");
const ADMIN_USERNAMES = parseAdminUsernames(process.env.ADMIN_USERNAMES || DEFAULT_ADMIN_USERNAME);

async function getAuthContainer() {
  return getContainerClient(AUTH_CONTAINER);
}

function normalizeSessionDays(input, fallback = 30) {
  const value = Number(input);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.floor(value));
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function userBlobName(username) {
  return `users/${safeSegment(normalizeUsername(username))}.json`;
}

function sessionBlobName(token) {
  return `sessions/${safeSegment(token)}.json`;
}

function passwordHash(password, salt) {
  return createHash("sha256").update(`${salt}:${String(password || "")}`).digest("hex");
}

async function countUsers(container) {
  const names = await listBlobNames(container, "users/");
  return names.filter((name) => name.endsWith(".json")).length;
}

async function registerUser(username, password) {
  const cleanName = normalizeUsername(username);
  if (!/^[-_a-z0-9]{3,32}$/.test(cleanName)) {
    return { ok: false, message: "用户名需为 3-32 位英文/数字/下划线" };
  }
  if (String(password || "").length < 4) {
    return { ok: false, message: "密码至少 4 位" };
  }

  const container = await getAuthContainer();
  const blobName = userBlobName(cleanName);
  const existed = await readJson(container, blobName, null);
  if (existed) {
    return { ok: false, message: "用户名已存在" };
  }

  const userCount = await countUsers(container);
  const user = {
    id: randomUUID(),
    username: cleanName,
    role: userCount === 0 || isConfiguredAdminUsername(cleanName) || cleanName === DEFAULT_ADMIN_USERNAME ? "admin" : "user",
    salt: randomBytes(16).toString("hex"),
    passwordHash: "",
    createdAt: new Date().toISOString(),
  };
  const finalPassword = cleanName === DEFAULT_ADMIN_USERNAME ? DEFAULT_ADMIN_PASSWORD : String(password || "");
  user.passwordHash = passwordHash(finalPassword, user.salt);

  await writeJson(container, blobName, user);
  const promoted = await ensureAtLeastOneAdmin(container, cleanName);
  if (promoted?.username === cleanName) {
    user.role = "admin";
  }

  const session = await createSession(container, user);

  return {
    ok: true,
    user: publicUser(user),
    token: session.token,
  };
}

async function loginUser(username, password) {
  const cleanName = normalizeUsername(username);
  const container = await getAuthContainer();
  let user = await readJson(container, userBlobName(cleanName), null);
  if (!user) {
    if (!isDefaultAdminCredential(cleanName, password)) {
      return { ok: false, message: "账号不存在" };
    }
    user = await upsertDefaultAdminUser(container, null);
  }

  const hashed = passwordHash(password, user.salt);
  if (hashed !== user.passwordHash) {
    if (isDefaultAdminCredential(cleanName, password)) {
      user = await upsertDefaultAdminUser(container, user);
    } else {
      return { ok: false, message: "密码错误" };
    }
  }

  if (isConfiguredAdminUsername(cleanName) && user.role !== "admin") {
    user.role = "admin";
    await writeJson(container, userBlobName(cleanName), user);
  }

  const promoted = await ensureAtLeastOneAdmin(container, cleanName);
  if (promoted?.username === cleanName) {
    user.role = "admin";
  }

  const session = await createSession(container, user);
  return {
    ok: true,
    user: publicUser(user),
    token: session.token,
  };
}

function isDefaultAdminCredential(username, password) {
  return normalizeUsername(username) === DEFAULT_ADMIN_USERNAME && String(password || "") === DEFAULT_ADMIN_PASSWORD;
}

async function upsertDefaultAdminUser(container, existingUser = null) {
  const nowIso = new Date().toISOString();
  const user = existingUser || {
    id: randomUUID(),
    username: DEFAULT_ADMIN_USERNAME,
    role: "admin",
    salt: randomBytes(16).toString("hex"),
    passwordHash: "",
    createdAt: nowIso,
  };

  user.username = DEFAULT_ADMIN_USERNAME;
  user.role = "admin";
  if (!user.salt) {
    user.salt = randomBytes(16).toString("hex");
  }
  user.passwordHash = passwordHash(DEFAULT_ADMIN_PASSWORD, user.salt);
  user.updatedAt = nowIso;
  if (!user.createdAt) {
    user.createdAt = nowIso;
  }

  await writeJson(container, userBlobName(user.username), user);
  return user;
}

async function createSession(container, user) {
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expires = new Date(now);
  expires.setDate(expires.getDate() + SESSION_DAYS);

  const session = {
    token,
    userId: user.id,
    username: user.username,
    role: user.role,
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  };

  await writeJson(container, sessionBlobName(token), session);
  return session;
}

async function resolveAuth(req) {
  const token = readToken(req);
  if (!token) return null;

  const container = await getAuthContainer();
  const session = await readJson(container, sessionBlobName(token), null);
  if (!session) return null;

  const expired = !session.expiresAt || new Date(session.expiresAt) <= new Date();
  if (expired) {
    await deleteBlob(container, sessionBlobName(token));
    return null;
  }

  const user = await readJson(container, userBlobName(session.username), null);
  if (!user) {
    await deleteBlob(container, sessionBlobName(token));
    return null;
  }

  if (isConfiguredAdminUsername(user.username) && user.role !== "admin") {
    user.role = "admin";
    await writeJson(container, userBlobName(user.username), user);
  }

  const promoted = await ensureAtLeastOneAdmin(container, user.username);
  if (promoted?.username === normalizeUsername(user.username) && user.role !== "admin") {
    user.role = "admin";
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const lastSeenMs = new Date(session.lastSeenAt || session.createdAt || 0).getTime();
  const expiresAtMs = new Date(session.expiresAt || 0).getTime();
  const nextExpiresAt = new Date(now);
  nextExpiresAt.setDate(nextExpiresAt.getDate() + SESSION_DAYS);
  const shouldRefreshExpiry =
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs - now <= SESSION_TOUCH_INTERVAL_MS * 2;
  const needTouch =
    !session.lastSeenAt ||
    Number.isNaN(lastSeenMs) ||
    now - lastSeenMs >= SESSION_TOUCH_INTERVAL_MS ||
    session.role !== user.role ||
    shouldRefreshExpiry;

  if (needTouch) {
    session.lastSeenAt = nowIso;
    session.role = user.role;
    session.expiresAt = nextExpiresAt.toISOString();
    await writeJson(container, sessionBlobName(token), session);
  }

  return {
    token,
    session,
    user: publicUser(user),
  };
}

async function logoutByToken(token) {
  if (!token) return;
  const container = await getAuthContainer();
  await deleteBlob(container, sessionBlobName(token));
}

async function listUsers(requester) {
  if (!requester || requester.role !== "admin") {
    return { ok: false, message: "forbidden" };
  }

  const container = await getAuthContainer();
  const names = await listBlobNames(container, "users/");
  const activeMap = await buildActiveSessionMap(container);
  const now = Date.now();
  const users = [];

  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const user = await readJson(container, name, null);
    if (!user) continue;

    const username = normalizeUsername(user.username);
    const sessionMeta = activeMap.get(username) || null;
    const lastSeenAt = sessionMeta?.lastSeenAt || null;
    const lastSeenMs = lastSeenAt ? new Date(lastSeenAt).getTime() : NaN;
    const online = Number.isFinite(lastSeenMs) && now - lastSeenMs <= ONLINE_WINDOW_MS;

    users.push({
      ...publicUser(user),
      online,
      lastSeenAt,
      activeSessionCount: Number(sessionMeta?.activeSessionCount || 0),
      onlineSessionCount: Number(sessionMeta?.onlineSessionCount || 0),
      onlineSinceAt: sessionMeta?.onlineSinceAt || null,
      onlineDurationSeconds: Number(sessionMeta?.onlineDurationSeconds || 0),
    });
  }

  users.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    if ((a.activeSessionCount || 0) !== (b.activeSessionCount || 0)) {
      return (b.activeSessionCount || 0) - (a.activeSessionCount || 0);
    }
    return a.username.localeCompare(b.username);
  });

  return { ok: true, users };
}

async function deleteUser(requester, userId) {
  if (!requester || requester.role !== "admin") {
    return { ok: false, message: "forbidden" };
  }

  const cleanUserId = String(userId || "").trim();
  if (!cleanUserId) {
    return { ok: false, message: "user_id_required" };
  }

  const container = await getAuthContainer();
  const names = await listBlobNames(container, "users/");
  let targetUser = null;

  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const user = await readJson(container, name, null);
    if (!user) continue;
    if (String(user.id || "") === cleanUserId) {
      targetUser = user;
      break;
    }
  }

  if (!targetUser) {
    return { ok: false, message: "user_not_found" };
  }

  if (String(targetUser.id) === String(requester.id)) {
    return { ok: false, message: "cannot_delete_self" };
  }

  if ((targetUser.role || "user") === "admin") {
    return { ok: false, message: "cannot_delete_admin" };
  }

  await deleteBlob(container, userBlobName(targetUser.username));

  const sessionNames = await listBlobNames(container, "sessions/");
  const targetUsername = normalizeUsername(targetUser.username);
  let removedSessionCount = 0;
  for (const name of sessionNames) {
    if (!name.endsWith(".json")) continue;
    const session = await readJson(container, name, null);
    if (!session) continue;

    const isMatchedByUserId = String(session.userId || "") === String(targetUser.id);
    const isMatchedByUsername = normalizeUsername(session.username) === targetUsername;
    if (!isMatchedByUserId && !isMatchedByUsername) continue;

    await deleteBlob(container, name);
    removedSessionCount += 1;
  }

  return {
    ok: true,
    user: publicUser(targetUser),
    removedSessionCount,
  };
}

async function buildActiveSessionMap(container) {
  const names = await listBlobNames(container, "sessions/");
  const now = Date.now();
  const map = new Map();

  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const session = await readJson(container, name, null);
    if (!session) continue;

    const expiresAtMs = new Date(session.expiresAt || 0).getTime();
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
      await deleteBlob(container, name);
      continue;
    }

    const username = normalizeUsername(session.username);
    const lastSeenAt = session.lastSeenAt || session.createdAt || null;
    const createdAt = session.createdAt || session.lastSeenAt || null;
    if (!username || !lastSeenAt) continue;

    const lastSeenMs = new Date(lastSeenAt).getTime();
    if (!Number.isFinite(lastSeenMs)) continue;
    const createdAtMs = new Date(createdAt || 0).getTime();
    const isOnline = now - lastSeenMs <= ONLINE_WINDOW_MS;

    const current = map.get(username) || {
      lastSeenAt: null,
      lastSeenMs: 0,
      activeSessionCount: 0,
      onlineSessionCount: 0,
      onlineSinceAt: null,
      onlineSinceMs: Number.POSITIVE_INFINITY,
    };

    current.activeSessionCount += 1;
    if (!current.lastSeenAt || lastSeenMs > current.lastSeenMs) {
      current.lastSeenAt = new Date(lastSeenMs).toISOString();
      current.lastSeenMs = lastSeenMs;
    }

    if (isOnline) {
      current.onlineSessionCount += 1;
      const sinceMs = Number.isFinite(createdAtMs) ? createdAtMs : lastSeenMs;
      if (sinceMs < current.onlineSinceMs) {
        current.onlineSinceMs = sinceMs;
        current.onlineSinceAt = new Date(sinceMs).toISOString();
      }
    }

    map.set(username, current);
  }

  for (const [username, entry] of map.entries()) {
    const onlineDurationSeconds =
      entry.onlineSessionCount > 0 && entry.onlineSinceAt
        ? Math.max(0, Math.floor((now - new Date(entry.onlineSinceAt).getTime()) / 1000))
        : 0;

    map.set(username, {
      lastSeenAt: entry.lastSeenAt || null,
      activeSessionCount: entry.activeSessionCount || 0,
      onlineSessionCount: entry.onlineSessionCount || 0,
      onlineSinceAt: entry.onlineSessionCount > 0 ? entry.onlineSinceAt : null,
      onlineDurationSeconds,
    });
  }

  return map;
}

async function ensureAtLeastOneAdmin(container, preferredUsername = "") {
  const names = await listBlobNames(container, "users/");
  const users = [];
  let hasAdmin = false;

  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const user = await readJson(container, name, null);
    if (!user) continue;
    users.push(user);
    if (user.role === "admin") hasAdmin = true;
  }

  if (!users.length || hasAdmin) return null;

  const preferred = normalizeUsername(preferredUsername);
  let target = users.find((item) => normalizeUsername(item.username) === preferred) || null;
  if (!target) {
    target = users
      .slice()
      .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())[0] || null;
  }
  if (!target) return null;

  target.role = "admin";
  target.updatedAt = new Date().toISOString();
  await writeJson(container, userBlobName(target.username), target);
  return { username: normalizeUsername(target.username) };
}

function parseAdminUsernames(input) {
  return new Set(
    String(input || "")
      .split(",")
      .map((item) => normalizeUsername(item))
      .filter(Boolean)
  );
}

function isConfiguredAdminUsername(username) {
  return ADMIN_USERNAMES.has(normalizeUsername(username));
}

function readToken(req) {
  const fromQuery =
    readQuery(req, "authToken") ||
    readQuery(req, "token") ||
    readQuery(req, "x-auth-token");
  if (looksLikeSessionToken(fromQuery)) {
    return String(fromQuery).trim();
  }

  const fromRawUrl = readTokenFromRawUrl(req);
  if (looksLikeSessionToken(fromRawUrl)) {
    return String(fromRawUrl).trim();
  }

  const fromHeader = readHeader(req, "x-auth-token");
  if (looksLikeSessionToken(fromHeader)) {
    return String(fromHeader).trim();
  }

  const auth = readHeader(req, "authorization");
  const bearer = parseBearerToken(auth);
  if (looksLikeSessionToken(bearer)) {
    return bearer;
  }

  return "";
}

function readHeader(req, headerName) {
  const headers = req?.headers;
  if (!headers) return "";

  if (typeof headers.get === "function") {
    return headers.get(headerName) || headers.get(String(headerName).toLowerCase()) || "";
  }

  return headers[headerName] || headers[String(headerName).toLowerCase()] || headers[String(headerName).toUpperCase()] || "";
}

function readQuery(req, key) {
  const query = req?.query;
  if (!query) return "";

  if (typeof query.get === "function") {
    return query.get(key) || query.get(String(key).toLowerCase()) || "";
  }

  return query[key] || query[String(key).toLowerCase()] || query[String(key).toUpperCase()] || "";
}

function readTokenFromRawUrl(req) {
  const rawUrl =
    req?.originalUrl ||
    req?.rawUrl ||
    req?.url ||
    req?.headers?.["x-ms-original-url"] ||
    req?.headers?.["X-MS-ORIGINAL-URL"] ||
    "";

  const text = String(rawUrl || "").trim();
  if (!text) return "";

  try {
    const parsed = new URL(text, "https://localhost");
    return (
      parsed.searchParams.get("authToken") ||
      parsed.searchParams.get("token") ||
      parsed.searchParams.get("x-auth-token") ||
      ""
    );
  } catch {
    const queryStart = text.indexOf("?");
    if (queryStart < 0) return "";
    const search = text.slice(queryStart + 1);
    const params = new URLSearchParams(search);
    return params.get("authToken") || params.get("token") || params.get("x-auth-token") || "";
  }
}

function parseBearerToken(authHeader) {
  const value = String(authHeader || "").trim();
  if (!/^bearer\s+/i.test(value)) return "";
  return value.replace(/^bearer\s+/i, "").trim();
}

function looksLikeSessionToken(input) {
  const token = String(input || "").trim();
  return /^[a-f0-9]{64}$/i.test(token);
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role || "user",
    createdAt: user.createdAt || null,
  };
}

module.exports = {
  registerUser,
  loginUser,
  resolveAuth,
  logoutByToken,
  listUsers,
  deleteUser,
  readToken,
  publicUser,
};
