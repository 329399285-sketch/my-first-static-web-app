const { createHash, randomBytes, randomUUID } = require("crypto");
const { getContainerClient, safeSegment, readJson, writeJson, deleteBlob, listBlobNames } = require("./storage");

const AUTH_CONTAINER = process.env.AUTH_CONTAINER_NAME || "word-card-auth";
const SESSION_DAYS = Number(process.env.AUTH_SESSION_DAYS || 30);

async function getAuthContainer() {
  return getContainerClient(AUTH_CONTAINER);
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
    role: userCount === 0 ? "admin" : "user",
    salt: randomBytes(16).toString("hex"),
    passwordHash: "",
    createdAt: new Date().toISOString(),
  };
  user.passwordHash = passwordHash(password, user.salt);

  await writeJson(container, blobName, user);
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
  const user = await readJson(container, userBlobName(cleanName), null);
  if (!user) {
    return { ok: false, message: "账号不存在" };
  }

  const hashed = passwordHash(password, user.salt);
  if (hashed !== user.passwordHash) {
    return { ok: false, message: "密码错误" };
  }

  const session = await createSession(container, user);
  return {
    ok: true,
    user: publicUser(user),
    token: session.token,
  };
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
  const users = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const user = await readJson(container, name, null);
    if (user) users.push(publicUser(user));
  }

  users.sort((a, b) => a.username.localeCompare(b.username));
  return { ok: true, users };
}

function readToken(req) {
  const auth = readHeader(req, "authorization");
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const fromHeader = readHeader(req, "x-auth-token");
  return String(fromHeader || "").trim() || "";
}

function readHeader(req, headerName) {
  const headers = req?.headers;
  if (!headers) return "";

  if (typeof headers.get === "function") {
    return headers.get(headerName) || headers.get(String(headerName).toLowerCase()) || "";
  }

  return headers[headerName] || headers[String(headerName).toLowerCase()] || headers[String(headerName).toUpperCase()] || "";
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
  readToken,
  publicUser,
};
