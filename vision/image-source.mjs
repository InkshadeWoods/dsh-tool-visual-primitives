import { createHash } from "node:crypto";
import { BlockList, isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Agent } from "undici";

const REMOTE_ADDRESS_BLOCKLIST = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
]) REMOTE_ADDRESS_BLOCKLIST.addSubnet(network, prefix, "ipv4");

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
]) REMOTE_ADDRESS_BLOCKLIST.addSubnet(network, prefix, "ipv6");

function ipv4FromMappedIpv6(address) {
  const match = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  return match?.[1];
}

function isBlockedRemoteAddress(address) {
  const family = isIP(address);
  if (family === 4) return REMOTE_ADDRESS_BLOCKLIST.check(address, "ipv4");
  if (family !== 6) return true;
  const mappedIpv4 = ipv4FromMappedIpv6(address);
  return mappedIpv4
    ? REMOTE_ADDRESS_BLOCKLIST.check(mappedIpv4, "ipv4")
    : REMOTE_ADDRESS_BLOCKLIST.check(address, "ipv6");
}

function validateRemoteAddresses(addresses) {
  const safe = addresses.filter(({ address }) => !isBlockedRemoteAddress(address));
  if (safe.length === 0) throw new Error("image URL must not target a private or reserved network");
  return safe;
}

const SAFE_REMOTE_DISPATCHER = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      lookup(hostname, { all: true, verbatim: true })
        .then((addresses) => {
          const safe = validateRemoteAddresses(addresses);
          const preferred = safe.find(({ family }) => !options.family || family === options.family) ?? safe[0];
          callback(null, preferred.address, preferred.family);
        })
        .catch((error) => callback(error));
    },
  },
});

function detectImageMediaType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 6 && (bytes.subarray(0, 6).toString() === "GIF87a" || bytes.subarray(0, 6).toString() === "GIF89a")) return "image/gif";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}

function normalizeVerifiedImageMediaType(value) {
  const mediaType = String(value || "").trim().toLowerCase();
  return ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mediaType) ? mediaType : null;
}

function imageDimensions(bytes, mediaType) {
  if (mediaType === "image/png" && bytes.length >= 24) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (mediaType === "image/gif" && bytes.length >= 10) {
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }
  if (mediaType === "image/jpeg") {
    let offset = 2;
    while (offset + 9 <= bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      while (bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset++];
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
      }
      offset += length;
    }
  }
  if (mediaType === "image/webp" && bytes.length >= 30) {
    const variant = bytes.subarray(12, 16).toString();
    if (variant === "VP8X") {
      return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    }
    if (variant === "VP8 ") {
      return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    }
    if (variant === "VP8L" && bytes.length >= 25) {
      const b0 = bytes[21];
      const b1 = bytes[22];
      const b2 = bytes[23];
      const b3 = bytes[24];
      return {
        width: 1 + b0 + ((b1 & 0x3f) << 8),
        height: 1 + ((b1 & 0xc0) >> 6) + (b2 << 2) + ((b3 & 0x0f) << 10),
      };
    }
  }
  throw new Error("unable to determine image dimensions");
}

function isCompleteAttachmentReference(attachment) {
  return Number.isInteger(attachment?.bytes)
    && attachment.bytes > 0
    && Number.isInteger(attachment?.width)
    && attachment.width > 0
    && Number.isInteger(attachment?.height)
    && attachment.height > 0;
}

function attachmentObjectHash(attachmentId) {
  const match = /^sha256:([a-f0-9]{64})$/i.exec(String(attachmentId || ""));
  if (!match) throw new Error("unsupported local attachment identifier");
  return match[1].toLowerCase();
}

function createAttachmentHydrationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function hydrateLocalAttachmentReference(attachments, attachment, maxBytes, signal) {
  if (isCompleteAttachmentReference(attachment)) return attachment;
  if (typeof attachments?.root !== "string" || !attachments.root) {
    throw createAttachmentHydrationError("ATTACHMENT_REFERENCE_INCOMPLETE", "image attachment reference is incomplete and cannot be resolved by this storage backend");
  }
  const hash = attachmentObjectHash(attachment?.attachmentId);
  let data;
  try {
    data = Buffer.from(await readFile(join(attachments.root, "objects", hash.slice(0, 2), hash), { signal }));
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw createAttachmentHydrationError("ATTACHMENT_NOT_FOUND", "image attachment object is unavailable");
  }
  if (maxBytes && data.byteLength > maxBytes) {
    throw createAttachmentHydrationError("ATTACHMENT_TOO_LARGE", `image size exceeds maxImageBytes ${maxBytes}`);
  }
  if (createHash("sha256").update(data).digest("hex") !== hash) {
    throw createAttachmentHydrationError("ATTACHMENT_CORRUPT", "image attachment object failed integrity verification");
  }
  const mediaType = detectImageMediaType(data);
  if (!mediaType) throw createAttachmentHydrationError("ATTACHMENT_CORRUPT", "image attachment object has an unsupported format");
  const { width, height } = imageDimensions(data, mediaType);
  return {
    attachmentId: attachment.attachmentId,
    mediaType,
    bytes: data.byteLength,
    width,
    height,
  };
}

function toImageData(bytes, verifiedMediaType) {
  const buffer = Buffer.from(bytes);
  const mediaType = normalizeVerifiedImageMediaType(verifiedMediaType) ?? detectImageMediaType(buffer);
  if (!mediaType) throw new Error("unsupported or invalid image data");
  const imageId = createHash("sha256").update(buffer).digest("hex");
  return {
    imageId,
    mediaType,
    byteLength: buffer.byteLength,
    dataUrl: `data:${mediaType};base64,${buffer.toString("base64")}`,
  };
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
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  validateRemoteAddresses(addresses);
  return url;
}

async function readResponseBytes(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("image download returned an empty body");
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (maxBytes && total > maxBytes) throw new Error(`image size exceeds maxImageBytes ${maxBytes}`);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function readLocalImage(ctx, path, maxBytes, signal) {
  const fs = ctx.get("fs");
  if (!fs) throw new Error("cannot analyze image: no fs service is mounted");
  const target = await fs.resolve(path, {});
  const bytes = await fs.readBytes(target, signal, maxBytes);
  return toImageData(bytes);
}

async function readRemoteImage(url, maxBytes, signal) {
  await assertSafeRemoteUrl(url);
  const response = await fetch(url, { signal, redirect: "error", dispatcher: SAFE_REMOTE_DISPATCHER });
  if (!response.ok) throw new Error(`image download failed with status ${response.status}`);
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (maxBytes && contentLength > maxBytes) throw new Error(`image size exceeds maxImageBytes ${maxBytes}`);
  const bytes = await readResponseBytes(response, maxBytes);
  return toImageData(bytes);
}

async function readAttachmentImage(ctx, attachment, maxBytes, signal) {
  if (!attachment) throw new Error("image attachment reference is required");
  const attachments = ctx.get?.("attachments");
  if (!attachments?.readImage) throw new Error("image attachment service is unavailable");
  const reference = await hydrateLocalAttachmentReference(attachments, attachment, maxBytes, signal);
  const stored = await attachments.readImage(reference, signal);
  if (!stored?.data) throw new Error("image attachment data is unavailable");
  if (maxBytes && stored.data.length > maxBytes) throw new Error(`image size exceeds maxImageBytes ${maxBytes}`);
  return toImageData(stored.data, stored.ref?.mediaType ?? attachment.mediaType);
}

export async function loadImageSource(ctx, source, { maxBytes, signal }) {
  if (source.kind === "path") return readLocalImage(ctx, source.path, maxBytes, signal);
  if (source.kind === "url") return readRemoteImage(source.url, maxBytes, signal);
  if (source.kind === "attachment") return readAttachmentImage(ctx, source.attachment, maxBytes, signal);
  throw new Error("unsupported image source");
}
