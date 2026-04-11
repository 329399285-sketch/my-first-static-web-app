const { BlobServiceClient } = require("@azure/storage-blob");

function getConnectionString() {
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connStr) {
    throw new Error("AZURE_STORAGE_CONNECTION_STRING is not set.");
  }
  return connStr;
}

async function getContainerClient(containerName) {
  const service = BlobServiceClient.fromConnectionString(getConnectionString());
  const container = service.getContainerClient(containerName);
  await container.createIfNotExists();
  return container;
}

function safeSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, "_") || "default";
}

async function readJson(container, blobName, fallback = null) {
  const client = container.getBlockBlobClient(blobName);
  const exists = await client.exists();
  if (!exists) return fallback;

  const downloaded = await client.download();
  const text = await streamToString(downloaded.readableStreamBody);
  try {
    return JSON.parse(text || "{}");
  } catch {
    return fallback;
  }
}

async function writeJson(container, blobName, data) {
  const client = container.getBlockBlobClient(blobName);
  const text = JSON.stringify(data);
  await client.upload(text, Buffer.byteLength(text), {
    blobHTTPHeaders: {
      blobContentType: "application/json; charset=utf-8",
    },
  });
}

async function deleteBlob(container, blobName) {
  const client = container.getBlockBlobClient(blobName);
  await client.deleteIfExists();
}

async function listBlobNames(container, prefix = "") {
  const names = [];
  for await (const blob of container.listBlobsFlat({ prefix })) {
    names.push(blob.name);
  }
  return names;
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
    readableStream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    readableStream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    readableStream.on("error", reject);
  });
}

module.exports = {
  getContainerClient,
  safeSegment,
  readJson,
  writeJson,
  deleteBlob,
  listBlobNames,
  json,
};
