"use client";

/**
 * Client-side avatar / icon image processing.
 *
 * Strategy: we don't want to set up CloudBase Storage just to ship avatars,
 * so we encode each image to a base64 JPEG dataURL and store it in the same
 * row as the rest of the profile / server doc. CloudBase rows have a 512KB
 * cap, so we down-scale to a square 256x256 at quality 0.85 — typical
 * output is 15–35KB.
 *
 * When user counts grow beyond ~10k or row sizes start mattering, swap the
 * implementation in `processAvatarFile` to upload via `app.uploadFile()`
 * and return the resulting fileID / temp URL. All call sites continue to
 * use the same `avatarUrl` string field.
 */

const TARGET_SIZE = 256; // px
const QUALITY = 0.85;
const MAX_INPUT_BYTES = 8 * 1024 * 1024; // reject anything > 8 MB up-front

export type ProcessAvatarResult =
  | { ok: true; dataUrl: string; bytes: number }
  | { ok: false; error: string };

/**
 * Read a file, draw it into a center-cropped 256x256 canvas, export as JPEG
 * dataURL. Returns the dataURL on success or a friendly error message.
 */
export async function processAvatarFile(
  file: File,
): Promise<ProcessAvatarResult> {
  if (!file) return { ok: false, error: "未选择文件" };
  if (!file.type.startsWith("image/")) {
    return { ok: false, error: "请选择图片文件（JPG/PNG/WebP/GIF）" };
  }
  if (file.size > MAX_INPUT_BYTES) {
    return {
      ok: false,
      error: `图片过大（${(file.size / 1024 / 1024).toFixed(1)}MB），请选择 8MB 以内的图片`,
    };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (e) {
    return {
      ok: false,
      error: `无法解码图片：${e instanceof Error ? e.message : "格式不支持"}`,
    };
  }

  const canvas = document.createElement("canvas");
  canvas.width = TARGET_SIZE;
  canvas.height = TARGET_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return { ok: false, error: "浏览器不支持 canvas，无法处理图片" };
  }

  // Center-crop to a square, then scale to 256.
  const minSide = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - minSide) / 2;
  const sy = (bitmap.height - minSide) / 2;
  ctx.drawImage(
    bitmap,
    sx,
    sy,
    minSide,
    minSide,
    0,
    0,
    TARGET_SIZE,
    TARGET_SIZE,
  );
  bitmap.close();

  const dataUrl = canvas.toDataURL("image/jpeg", QUALITY);
  // Approximate byte count: base64 chars × 3/4 minus padding.
  const b64 = dataUrl.split(",", 2)[1] || "";
  const bytes = Math.floor((b64.length * 3) / 4);
  return { ok: true, dataUrl, bytes };
}

/**
 * True if a string looks like a base64 image dataURL we can render directly
 * via <img src=…>. Used by render code to choose between letter+color vs
 * actual image rendering.
 */
export function isAvatarUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.startsWith("data:image/") || /^https?:\/\//.test(value);
}

// ─── Chat image attachment processing ───────────────────────────────────────

const IMG_MAX_W = 1200;
const IMG_MAX_H = 900;
const IMG_QUALITY = 0.80;
const IMG_MAX_INPUT = 20 * 1024 * 1024; // 20 MB source cap

export type ProcessImageResult =
  | { ok: true; dataUrl: string; width: number; height: number; bytes: number }
  | { ok: false; error: string };

/**
 * Resize and compress an image file for use as a chat attachment.
 * Down-scales to fit within 1200×900 while preserving aspect ratio,
 * then encodes as JPEG at quality 0.80. Typical output: 30–150 KB.
 */
export async function processImageFile(
  file: File,
): Promise<ProcessImageResult> {
  if (!file.type.startsWith("image/")) {
    return { ok: false, error: "请选择图片文件（JPG/PNG/WebP/GIF）" };
  }
  if (file.size > IMG_MAX_INPUT) {
    return {
      ok: false,
      error: `图片过大（${(file.size / 1024 / 1024).toFixed(1)} MB），请选择 20 MB 以内的文件`,
    };
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, error: "无法解码图片，请尝试其他格式" };
  }
  const scale = Math.min(1, IMG_MAX_W / bitmap.width, IMG_MAX_H / bitmap.height);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", IMG_QUALITY);
  const bytes = Math.round((dataUrl.length * 3) / 4);
  return { ok: true, dataUrl, width: w, height: h, bytes };
}

/**
 * Derive a 1–2 character "letter avatar" from a username, used as the
 * fallback when no uploaded image is present. Algorithm:
 *
 *   1. If the name contains any CJK (Chinese / Japanese / Korean ideograph)
 *      character, use the FIRST one — Chinese names look best as a single
 *      square ideograph.
 *   2. Else strip non-alphanumerics and take the first 1–2 letters/digits,
 *      uppercased. Western names render as monogram-style initials.
 *   3. Falls back to "?" if nothing usable is found (e.g. a name made of
 *      only punctuation).
 *
 * Replaces the old user-editable "头像字母" input — usernames already
 * convey identity, so a separate letter field was just busywork.
 */
export function deriveAvatarText(username: string | null | undefined): string {
  if (!username) return "?";
  const cjk = username.match(/[\u3400-\u9fff\uf900-\ufaff]/);
  if (cjk) return cjk[0];
  const alphaNum = username.replace(/[^a-zA-Z0-9]/g, "");
  if (alphaNum.length === 0) return "?";
  return alphaNum.slice(0, 2).toUpperCase();
}
