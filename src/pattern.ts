import { type PackedBitmap, rowBytesFor } from "./bitmap.js";
import { DOTS_PER_MM } from "./tspl.js";

/**
 * A calibration label: a one dot frame on the very edge, millimetre ticks
 * along the top and left (longer every 5 and 10 mm), and a solid 5 mm square
 * in the top left corner. Print it to see how far the print sits from the
 * label's edges, then correct with REFERENCE x (across) and SHIFT (along).
 * A side of the frame that is missing on paper has fallen off the label.
 */
export function testPattern(widthMm: number, heightMm: number, dotsPerMm = DOTS_PER_MM): PackedBitmap {
	const width = Math.round(widthMm * dotsPerMm);
	const height = Math.round(heightMm * dotsPerMm);
	const rowBytes = rowBytesFor(width);
	const data = new Uint8Array(rowBytes * height);
	const set = (x: number, y: number) => {
		if (x >= 0 && y >= 0 && x < width && y < height)
			data[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
	};
	const rect = (x: number, y: number, w: number, h: number) => {
		for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j);
	};
	rect(0, 0, width, 1);
	rect(0, height - 1, width, 1);
	rect(0, 0, 1, height);
	rect(width - 1, 0, 1, height);
	const tick = (mm: number) => Math.round((mm % 10 === 0 ? 3 : mm % 5 === 0 ? 2 : 1) * dotsPerMm);
	for (let mm = 1; mm < widthMm; mm++) rect(Math.round(mm * dotsPerMm), 0, 1, tick(mm));
	for (let mm = 1; mm < heightMm; mm++) rect(0, Math.round(mm * dotsPerMm), tick(mm), 1);
	const corner = Math.round(5 * dotsPerMm);
	rect(corner, corner, corner, corner);
	return { width, height, rowBytes, data };
}
