/**
 * What a file actually is, from its first bytes.
 *
 * An upload's declared content type is a claim by the uploader. This is the
 * check that makes it a fact, and it exists for one specific case: a file that
 * says `image/jpeg` and is really something else reaching a vision provider as
 * an image. Magic numbers are cheap, and the set of formats V3 accepts is
 * small enough to enumerate.
 *
 * Returns null for anything unrecognised, which the caller treats as a refusal.
 * Guessing is the failure mode this function exists to prevent.
 */

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.byteLength < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/** ASCII at an offset, for container formats that name themselves. */
function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.byteLength < offset + length) return "";
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

export function sniffMimeType(bytes: Uint8Array): string | null {
  // --- Images ------------------------------------------------------------
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return "image/webp";
  }

  // --- Documents ---------------------------------------------------------
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";

  // --- Audio -------------------------------------------------------------
  if (ascii(bytes, 0, 4) === "OggS") return "audio/ogg";
  if (ascii(bytes, 0, 4) === "fLaC") return "audio/flac";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") {
    return "audio/wav";
  }
  // ID3-tagged or bare MPEG audio frame.
  if (ascii(bytes, 0, 3) === "ID3") return "audio/mpeg";
  if (startsWith(bytes, [0xff, 0xfb]) || startsWith(bytes, [0xff, 0xf3])) {
    return "audio/mpeg";
  }
  // ISO base media: m4a and mp4 share it, so the brand decides.
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (brand.startsWith("M4A") || brand === "mp42" || brand === "isom") {
      return "audio/mp4";
    }
    return "video/mp4";
  }
  // Matroska/WebM. Reported as video even when it holds only audio, which the
  // caller allows for voice notes because Telegram exports are inconsistent.
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";

  return null;
}
