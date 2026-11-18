import { fromBase64, fromPacked, type PackedBitmap, toBase64 } from "./bitmap.js";
import { DOTS_PER_MM } from "./tspl.js";

/**
 * One label on the print queue, as JSON. This is what a web app posts to its
 * queue and what the agent receives from it.
 */
export interface PrintJob {
	id: string;
	/** Label size in mm. */
	width: number;
	height: number;
	/** Bitmap size in dots. */
	dotsW: number;
	dotsH: number;
	copies: number;
	/** Base64 of ceil(dotsW / 8) * dotsH bytes, most significant bit leftmost, 1 for black. */
	data: string;
}

/** A packed bitmap as a queue job. The label size defaults to the bitmap at 8 dots a mm. */
export function toJob(
	bitmap: PackedBitmap,
	options: { id?: string; widthMm?: number; heightMm?: number; copies?: number } = {},
): PrintJob {
	return {
		id: options.id ?? "",
		width: options.widthMm ?? bitmap.width / DOTS_PER_MM,
		height: options.heightMm ?? bitmap.height / DOTS_PER_MM,
		dotsW: bitmap.width,
		dotsH: bitmap.height,
		copies: options.copies ?? 1,
		data: toBase64(bitmap.data),
	};
}

/** Checks a job from the queue and returns its bitmap. Throws when the job is malformed. */
export function jobBitmap(job: PrintJob): PackedBitmap {
	if (!job || typeof job !== "object" || typeof job.data !== "string")
		throw new Error("The job has no bitmap data.");
	if (!(job.width > 0) || !(job.height > 0))
		throw new Error("The job has no label size.");
	return fromPacked(fromBase64(job.data), job.dotsW, job.dotsH);
}
