/**
 * POST /api/media/upload — deliver the files the analysis asked for.
 *
 * Multipart, one or more files, each named by the reference the export used.
 * Nothing about the request decides where a file goes or whether it is wanted:
 *
 *   - The job must belong to the caller, or there is no job as far as this
 *     route is concerned.
 *   - The reference must already have a row in the media plan. The plan was
 *     written when the job was created, from what the product allows, so an
 *     upload cannot introduce a file the analysis did not ask for.
 *   - The storage key is derived by hashing the job id with the reference. A
 *     client cannot name the file it writes, so a reference full of `../` is
 *     just characters that change a hash.
 *   - The declared type must match what the plan expected, and the bytes must
 *     look like what they claim to be.
 *
 * The response says what was stored and what was refused, without saying why in
 * detail: a caller that is guessing should not be told which guess was closer.
 */

import { AppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { mediaLimits } from "@/lib/media/policy";
import { json, withOwner } from "@/server/http";
import { sniffMimeType } from "@/server/media/sniff";
import { storageKeyFor, writeMedia } from "@/server/media/storage";
import {
  findMediaAsset,
  markRejected,
  markStored,
} from "@/server/repositories/media";
import { getJob } from "@/server/repositories/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Files per request. Enough for a batch, small enough to bound the work. */
const MAX_FILES_PER_REQUEST = 25;

export const POST = withOwner(
  async ({ ownerId, request }) => {
    const form = await request.formData().catch(() => null);
    if (form === null) throw new AppError("INVALID_REQUEST");

    const jobId = form.get("jobId");
    if (typeof jobId !== "string" || jobId.length === 0) {
      throw new AppError("INVALID_REQUEST");
    }

    // Owner-scoped: another owner's job id is a 404, not a 403, because the
    // existence of someone else's analysis is not ours to confirm.
    const job = getJob(jobId, ownerId);
    if (!job) throw new AppError("NOT_FOUND");

    // Media arrives before the analysis runs. Once it has, the plan is spent.
    if (job.status === "PROCESSING" || job.status === "COMPLETED") {
      throw new AppError("INVALID_REQUEST", { detail: "job already started" });
    }

    const entries = form.getAll("file").filter((entry): entry is File => entry instanceof File);
    if (entries.length === 0) throw new AppError("INVALID_REQUEST");
    if (entries.length > MAX_FILES_PER_REQUEST) {
      throw new AppError("INVALID_REQUEST", { detail: "too many files" });
    }

    const limits = mediaLimits();
    const stored: string[] = [];
    const refused: string[] = [];

    for (const file of entries) {
      // The field's filename carries the export-relative reference. It is
      // matched against the plan and never used as a path.
      const reference = file.name;
      const asset = findMediaAsset(jobId, ownerId, reference);

      if (asset === null) {
        // Not in the plan: either not wanted, or not this owner's.
        refused.push(reference);
        continue;
      }
      if (file.size === 0 || file.size > limits.maxFileBytes) {
        markRejected(asset.id);
        refused.push(reference);
        continue;
      }

      const bytes = new Uint8Array(await file.arrayBuffer());

      // What the bytes actually are, not what the upload claimed. A JPEG
      // header is cheap to check and an mp4 renamed to .jpg is exactly the
      // case that would otherwise reach a provider as an image.
      const sniffed = sniffMimeType(bytes);
      if (sniffed === null || !matchesPlan(sniffed, asset.category)) {
        markRejected(asset.id);
        refused.push(reference);
        continue;
      }

      const storageKey = storageKeyFor(ownerId, jobId, reference);
      await writeMedia(storageKey, bytes);
      markStored(asset.id, storageKey, bytes.byteLength, sniffed);
      stored.push(reference);
    }

    log.info("media.uploaded", {
      jobId,
      stored: stored.length,
      refused: refused.length,
    });

    return json({ stored: stored.length, refused: refused.length });
  },
  { rateLimit: true },
);

/** Whether a sniffed type is plausible for the category the plan expected. */
function matchesPlan(mimeType: string, category: string): boolean {
  if (category === "image") return mimeType.startsWith("image/");
  if (category === "voice" || category === "audio") {
    // Ogg and WebM share a container family, and Telegram voice notes are
    // reported inconsistently across export versions.
    return mimeType.startsWith("audio/") || mimeType === "video/webm";
  }
  if (category === "document") return mimeType === "application/pdf";
  return false;
}
