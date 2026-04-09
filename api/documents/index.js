const { BlobServiceClient } = require("@azure/storage-blob");
const { randomUUID } = require("crypto");

const CONTAINER_NAME = process.env.DOCS_CONTAINER_NAME || "word-card-documents";

module.exports = async function (context, req) {
  const method = String(req.method || "GET").toUpperCase();
  const routeId = req.params?.id ? decodeURIComponent(req.params.id) : "";
  const userId = getUserId(req);

  try {
    const container = await getContainerClient();

    if (method === "GET") {
      if (routeId) {
        const document = await getDocument(container, userId, routeId);
        if (!document) {
          context.res = json(404, { error: "document_not_found" });
          return;
        }
        context.res = json(200, { document });
        return;
      }

      const documents = await listDocuments(container, userId);
      context.res = json(200, { documents });
      return;
    }

    if (method === "PUT") {
      const body = normalizeBody(req.body);
      const documentId = routeId || String(body.id || randomUUID());
      const now = new Date().toISOString();

      const document = normalizeDocument({
        ...body,
        id: documentId,
        updatedAt: now,
        createdAt: body.createdAt || now,
      });

      await saveDocument(container, userId, document.id, document);
      context.res = json(200, { ok: true, document });
      return;
    }

    if (method === "DELETE") {
      if (!routeId) {
        context.res = json(400, { error: "id_required" });
        return;
      }

      const blobName = getBlobName(userId, routeId);
      await container.getBlockBlobClient(blobName).deleteIfExists();
      context.res = json(200, { ok: true });
      return;
    }

    context.res = json(405, { error: "method_not_allowed" });
  } catch (error) {
    context.log.error("documents api failed", error);
    context.res = json(500, {
      error: "internal_error",
      message: error?.message || "unknown error",
    });
  }
};

async function getContainerClient() {
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connStr) {
    throw new Error("AZURE_STORAGE_CONNECTION_STRING is not set.");
  }

  const serviceClient = BlobServiceClient.fromConnectionString(connStr);
  const container = serviceClient.getContainerClient(CONTAINER_NAME);
  await container.createIfNotExists();
  return container;
}

async function listDocuments(container, userId) {
  const prefix = `${safeSegment(userId)}/`;
  const documents = [];

  for await (const blob of container.listBlobsFlat({ prefix })) {
    const id = getIdFromBlobName(blob.name);
    if (!id) continue;

    const document = await getDocument(container, userId, id);
    if (document) documents.push(document);
  }

  documents.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return documents;
}

async function getDocument(container, userId, id) {
  const blobClient = container.getBlockBlobClient(getBlobName(userId, id));
  const exists = await blobClient.exists();
  if (!exists) return null;

  const response = await blobClient.download();
  const text = await streamToString(response.readableStreamBody);
  const parsed = JSON.parse(text || "{}");
  return normalizeDocument(parsed);
}

async function saveDocument(container, userId, id, document) {
  const blobClient = container.getBlockBlobClient(getBlobName(userId, id));
  const body = JSON.stringify(document);
  await blobClient.upload(body, Buffer.byteLength(body), {
    blobHTTPHeaders: {
      blobContentType: "application/json; charset=utf-8",
    },
  });
}

function normalizeDocument(input) {
  const source = input || {};
  return {
    id: String(source.id || randomUUID()),
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

function getBlobName(userId, id) {
  return `${safeSegment(userId)}/${safeSegment(id)}.json`;
}

function getIdFromBlobName(blobName) {
  const parts = String(blobName || "").split("/");
  const filename = parts[parts.length - 1] || "";
  if (!filename.endsWith(".json")) return "";
  return filename.slice(0, -5);
}

function safeSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, "_") || "default";
}

function getUserId(req) {
  const principalHeader = req.headers?.["x-ms-client-principal"];
  if (!principalHeader) return "public";

  try {
    const decoded = Buffer.from(principalHeader, "base64").toString("utf8");
    const principal = JSON.parse(decoded);
    return principal.userId || principal.userDetails || "public";
  } catch {
    return "public";
  }
}

function json(status, body) {
  return {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body,
  };
}

async function streamToString(readableStream) {
  if (!readableStream) return "";

  return new Promise((resolve, reject) => {
    const chunks = [];
    readableStream.on("data", (data) => chunks.push(Buffer.from(data)));
    readableStream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    readableStream.on("error", reject);
  });
}
