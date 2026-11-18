import { type PackedBitmap, rotate180 } from "./bitmap.js";

/** A 203 dpi print head is 8 dots a millimetre. A 300 dpi head is about 11.8. */
export const DOTS_PER_MM = 8;

export interface TsplOptions {
	/** Label size in mm, across the roll then along it. Defaults to the bitmap at 8 dots a mm. */
	widthMm?: number;
	heightMm?: number;
	/** The backing gap between labels, in mm. 2 is the common die-cut roll. */
	gapMm?: number;
	/** How many labels to print. */
	copies?: number;
	/** Dots to move the print across the roll (REFERENCE x). */
	referenceX?: number;
	/** Dots to move the print along the roll (SHIFT), 0 or more. */
	shiftY?: number;
	/** Turns the bitmap half a turn, so it reads the right way up as it feeds out. */
	rotate?: boolean;
	/** TSPL DIRECTION, 0 or 1. */
	direction?: 0 | 1;
}

const whole = (n: number | undefined, fallback: number) =>
	Number.isFinite(n) ? Math.round(n as number) : fallback;

/** Millimetres as TSPL takes them: at most two decimals, no trailing zeros. */
const mm = (n: number) => String(Math.round(n * 100) / 100);

/**
 * The TSPL program that prints one bitmap as a full label:
 *
 *   SIZE w mm,h mm
 *   GAP g mm,0 mm
 *   DIRECTION 1
 *   REFERENCE x,0
 *   SHIFT y
 *   CLS
 *   BITMAP 0,0,rowBytes,height,0,<raw bytes>
 *   PRINT copies,1
 *
 * Things that are easy to get wrong:
 *
 * - Lines end in CR LF. The bitmap bytes follow the comma after the mode
 *   straight away, with no quoting, escaping or length prefix; the printer
 *   counts rowBytes * height bytes and then expects the next line.
 * - In BITMAP data a 0 bit is a black dot and a 1 bit is left white, the
 *   reverse of how nearly everything else stores a one-bit image. This
 *   library keeps 1 for black everywhere and inverts here. Padding bits at
 *   the end of a row become 1 after the flip, so they stay white.
 * - BITMAP width is in bytes, height is in dots.
 * - SIZE, GAP, DIRECTION, REFERENCE and SHIFT are remembered by the printer
 *   between jobs, so every job sends all of them rather than trusting what
 *   an earlier job or another program left behind.
 * - The header is plain ASCII. The result must reach the device as bytes;
 *   passing it through a text encoding corrupts the bitmap.
 */
export function buildTspl(bitmap: PackedBitmap, options: TsplOptions = {}): Uint8Array {
	const { width, height, rowBytes } = bitmap;
	if (bitmap.data.length !== rowBytes * height || rowBytes !== Math.ceil(width / 8))
		throw new RangeError(
			`Expected ${Math.ceil(width / 8) * height} bytes for ${width} x ${height} dots, got ${bitmap.data.length}.`,
		);
	const widthMm = options.widthMm ?? width / DOTS_PER_MM;
	const heightMm = options.heightMm ?? height / DOTS_PER_MM;
	if (!(widthMm > 0) || !(heightMm > 0))
		throw new RangeError("Label width and height must be more than 0 mm.");
	const copies = Math.max(1, whole(options.copies, 1));
	const gapMm = Number.isFinite(options.gapMm) ? Math.max(0, options.gapMm as number) : 2;
	const referenceX = whole(options.referenceX, 0);
	const shiftY = Math.max(0, whole(options.shiftY, 0));
	const direction = options.direction === 0 ? 0 : 1;

	const dots = options.rotate ? rotate180(bitmap).data : bitmap.data;
	const head = [
		`SIZE ${mm(widthMm)} mm,${mm(heightMm)} mm`,
		`GAP ${mm(gapMm)} mm,0 mm`,
		`DIRECTION ${direction}`,
		`REFERENCE ${referenceX},0`,
		`SHIFT ${shiftY}`,
		"CLS",
		`BITMAP 0,0,${rowBytes},${height},0,`,
	].join("\r\n");
	const tail = `\r\nPRINT ${copies},1\r\n`;

	const out = new Uint8Array(head.length + dots.length + tail.length);
	for (let i = 0; i < head.length; i++) out[i] = head.charCodeAt(i);
	for (let i = 0; i < dots.length; i++) out[head.length + i] = ~dots[i] & 0xff;
	for (let i = 0; i < tail.length; i++)
		out[head.length + dots.length + i] = tail.charCodeAt(i);
	return out;
}
