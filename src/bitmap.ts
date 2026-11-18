/**
 * One-bit bitmaps as a thermal label printer takes them: one bit a dot, rows
 * of whole bytes, the most significant bit leftmost. In this library a set
 * bit always means black (the head burns that dot). TSPL itself wants the
 * opposite; buildTspl does that flip at the last moment.
 */

export interface PackedBitmap {
	/** Width and height in dots. */
	width: number;
	height: number;
	/** Bytes in one row: ceil(width / 8). The last byte of a row may be padded. */
	rowBytes: number;
	/** rowBytes * height bytes, 1 for black. */
	data: Uint8Array;
}

/**
 * Luminance below this prints black. 160 sits above the midpoint on purpose:
 * a canvas draws thin strokes mostly as mid greys, and the higher cut keeps
 * those anti-aliased edges black instead of dropping them.
 */
export const DEFAULT_THRESHOLD = 160;

export const rowBytesFor = (width: number) => Math.ceil(width / 8);

function emptyBitmap(width: number, height: number): PackedBitmap {
	if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
		throw new RangeError("Bitmap width and height must be positive whole numbers.");
	const rowBytes = rowBytesFor(width);
	return { width, height, rowBytes, data: new Uint8Array(rowBytes * height) };
}

/**
 * Packs RGBA pixels (canvas getImageData order) into dots. Colour becomes
 * luminance with the usual 299/587/114 weights, and alpha is blended over
 * white first, so a transparent pixel counts as paper.
 */
export function packRgba(
	rgba: ArrayLike<number>,
	width: number,
	height: number,
	threshold = DEFAULT_THRESHOLD,
): PackedBitmap {
	const out = emptyBitmap(width, height);
	if (rgba.length < width * height * 4)
		throw new RangeError("The RGBA buffer is smaller than width x height x 4.");
	const { rowBytes, data } = out;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			const a = rgba[i + 3] / 255;
			const lum =
				255 -
				a * (255 - (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000);
			if (lum < threshold) data[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
		}
	}
	return out;
}

/** Packs greyscale pixels, one byte each, 0 black to 255 white. */
export function packGrey(
	grey: ArrayLike<number>,
	width: number,
	height: number,
	threshold = DEFAULT_THRESHOLD,
): PackedBitmap {
	const out = emptyBitmap(width, height);
	if (grey.length < width * height)
		throw new RangeError("The greyscale buffer is smaller than width x height.");
	const { rowBytes, data } = out;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (grey[y * width + x] < threshold)
				data[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
		}
	}
	return out;
}

/** Wraps bytes that are already packed (1 for black) and checks their length. */
export function fromPacked(data: Uint8Array, width: number, height: number): PackedBitmap {
	const out = emptyBitmap(width, height);
	if (data.length !== out.data.length)
		throw new RangeError(
			`Expected ${out.data.length} bytes for ${width} x ${height} dots, got ${data.length}.`,
		);
	return { ...out, data };
}

export function getDot(bitmap: PackedBitmap, x: number, y: number) {
	return (bitmap.data[y * bitmap.rowBytes + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
}

/**
 * Turns the bitmap half a turn. Done dot by dot rather than by reversing
 * bytes, because a width that is not a multiple of 8 leaves padding bits at
 * the end of each row and they must stay at the end.
 */
export function rotate180(bitmap: PackedBitmap): PackedBitmap {
	const { width, height, rowBytes, data } = bitmap;
	const out = new Uint8Array(data.length);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (data[y * rowBytes + (x >> 3)] & (0x80 >> (x & 7))) {
				const nx = width - 1 - x;
				const ny = height - 1 - y;
				out[ny * rowBytes + (nx >> 3)] |= 0x80 >> (nx & 7);
			}
		}
	}
	return { width, height, rowBytes, data: out };
}

/** Works in browsers and Node without Buffer. Chunked so large labels do not overflow the call stack. */
export function toBase64(bytes: Uint8Array) {
	let s = "";
	for (let i = 0; i < bytes.length; i += 0x8000)
		s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(s);
}

export function fromBase64(text: string) {
	const s = atob(text);
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
	return out;
}

/**
 * Binary PBM (P4) happens to use the same packing as this library: rows of
 * whole bytes, most significant bit leftmost, 1 for black. That makes it a
 * convenient file format for one-bit labels and for looking at a job on
 * screen.
 */
export function encodePbm(bitmap: PackedBitmap) {
	const head = `P4\n${bitmap.width} ${bitmap.height}\n`;
	const out = new Uint8Array(head.length + bitmap.data.length);
	for (let i = 0; i < head.length; i++) out[i] = head.charCodeAt(i);
	out.set(bitmap.data, head.length);
	return out;
}

export function decodePbm(bytes: Uint8Array): PackedBitmap {
	let pos = 0;
	const token = () => {
		for (;;) {
			while (pos < bytes.length && /\s/.test(String.fromCharCode(bytes[pos]))) pos++;
			if (bytes[pos] !== 0x23) break;
			// A comment runs to the end of its line.
			while (pos < bytes.length && bytes[pos] !== 0x0a) pos++;
		}
		let s = "";
		while (pos < bytes.length && !/\s/.test(String.fromCharCode(bytes[pos])))
			s += String.fromCharCode(bytes[pos++]);
		return s;
	};
	if (token() !== "P4")
		throw new Error("Only binary PBM (P4) files are supported.");
	const width = Number(token());
	const height = Number(token());
	// Exactly one whitespace byte separates the header from the dots.
	pos++;
	const out = emptyBitmap(width, height);
	const data = bytes.subarray(pos, pos + out.data.length);
	if (data.length !== out.data.length)
		throw new Error("The PBM file is shorter than its header says.");
	return { ...out, data: new Uint8Array(data) };
}
