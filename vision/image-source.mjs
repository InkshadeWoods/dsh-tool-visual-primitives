import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

const MIME_MAP = { jpg: "jpeg", jpeg: "jpeg", png: "png", gif: "gif", webp: "webp", bmp: "bmp" };

function toImageData(bytes, mediaType) {
  const buffer = Buffer.from(bytes);
  const imageId = createHash("sha256").update(buffer).digest("hex");
  return { imageId, mediaType, dataUrl: `data:image/${mediaType};base64,${buffer.toString("base64")}` };
}

function extToMediaType(path) {
  const ext = path.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase();
  return MIME_MAP[ext] || "jpeg";
}

function isPrivateAddress(address) {
  if (address === "::1" || address === "::" || address.toLowerCase().startsWith("fe80:")) return true;
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

async function assertSafeRemoteUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("image URL must be valid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("image URL must use http or https");
  if (url.username || url.password) throw new Error("image URL must not include credentials");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) throw new Error("image URL must not target localhost");
  const addresses = await lookup(hostname, { all: true });
  if (addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("image URL must not target a private network");
  return url;
}

async function readLocalImage(ctx, path, maxBytes, signal) {
  const fs = ctx.get("fs");
  if (!fs) throw new Error("cannot analyze image: no fs service is mounted");
  const target = await fs.resolve(path, {});
  const bytes = await fs.readBytes(target, signal, maxBytes);
  return toImageData(bytes, extToMediaType(path));
}

async function readRemoteImage(url, maxBytes, signal) {
  await assertSafeRemoteUrl(url);
  const response = await fetch(url, { signal, redirect: "error" });
  if (!response.ok) throw new Error(`image download failed with status ${response.status}`);
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (maxBytes && contentLength > maxBytes) throw new Error(`image size exceeds maxImageBytes ${maxBytes}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (maxBytes && bytes.length > maxBytes) throw new Error(`image size exceeds maxImageBytes ${maxBytes}`);
  const contentType = response.headers.get("content-type") || "";
  const rawMediaType = /^image\/([a-z0-9.+-]+)/i.exec(contentType)?.[1]?.toLowerCase() || "jpeg";
  return toImageData(bytes, rawMediaType.startsWith("svg") ? "jpeg" : rawMediaType);
}

async function readAttachmentImage(ctx, attachment, maxBytes, signal) {
  if (!attachment) throw new Error("image attachment reference is required");
  const stored = await ctx.attachments?.readImage(attachment, signal);
  if (!stored?.data) throw new Error("image attachment data is unavailable");
  if (maxBytes && stored.data.length > maxBytes) throw new Error(`image size exceeds maxImageBytes ${maxBytes}`);
  const rawMediaType = stored.ref?.mediaType ?? attachment.mediaType ?? "image/png";
  const mediaType = rawMediaType.split("/").pop()?.toLowerCase() || "png";
  return toImageData(stored.data, MIME_MAP[mediaType] || mediaType);
}

export async function loadImageSource(ctx, source, { maxBytes, signal }) {
  if (source.kind === "path") return readLocalImage(ctx, source.path, maxBytes, signal);
  if (source.kind === "url") return readRemoteImage(source.url, maxBytes, signal);
  if (source.kind === "attachment") return readAttachmentImage(ctx, source.attachment, maxBytes, signal);
  throw new Error("unsupported image source");
}
