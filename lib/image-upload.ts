import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

// Photos uploaded to public/uploads/<folder> (trainers by staff, group photos by members). Only real
// JPG, PNG and WebP files (checked by their first bytes, not just the type the browser sent) up to 3 MB,
// saved under a new random name so a name can never be guessed or point outside the folder.
export const allowedImageTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
export const maxImageBytes = 3 * 1024 * 1024;

export function isAllowedImage(bytes: Buffer, mimeType: string) {
  if (mimeType === "image/png") {
    return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  }
  if (mimeType === "image/webp") {
    return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return false;
}

export type UploadFolder = "trainers" | "groups";
const uploadName = /^[A-Za-z0-9-]{1,120}\.(jpg|png|webp)$/;

export async function saveUploadedImage(folder: UploadFolder, bytes: Buffer, mimeType: string) {
  const extension = allowedImageTypes.get(mimeType);
  if (!extension) throw new Error("unsupported image type");
  const filename = `${Date.now()}-${randomUUID()}.${extension}`;
  const uploadDir = path.join(process.cwd(), "public", "uploads", folder);
  await mkdir(uploadDir, { recursive: true });
  await writeFile(path.join(uploadDir, filename), bytes);
  return `/uploads/${folder}/${filename}`;
}

// Removes a file this app saved (a replaced or removed photo). Anything else is left alone.
export async function removeUploadedImage(folder: UploadFolder, url: string | null | undefined) {
  const prefix = `/uploads/${folder}/`;
  if (!url || !url.startsWith(prefix)) return;
  const name = url.slice(prefix.length);
  if (!uploadName.test(name)) return;
  try {
    await unlink(path.join(process.cwd(), "public", "uploads", folder, name));
  } catch {
    // Already gone: nothing to do.
  }
}
