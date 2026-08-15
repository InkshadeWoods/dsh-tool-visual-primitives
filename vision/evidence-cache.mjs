function fingerprint(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function createEvidenceCache(limit = 64) {
  const entries = new Map();
  return {
    get(key) {
      const value = entries.get(key);
      if (value !== undefined) {
        entries.delete(key);
        entries.set(key, value);
      }
      return value;
    },
    set(key, value) {
      entries.set(key, value);
      if (entries.size > limit) entries.delete(entries.keys().next().value);
    },
  };
}

export function buildEvidenceCacheKey({ imageId, mode, detail, usesPrimitives, prompt }) {
  return [imageId, mode, detail, usesPrimitives ? "primitives" : "plain", fingerprint(prompt.trim())].join(":");
}
