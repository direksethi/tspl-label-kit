import { type PackedBitmap, packRgba } from "./bitmap.js";
import {
	DEFAULT_FONT,
	fillText,
	type LabelDesign,
	type LabelElement,
	type LabelValues,
	MM_PER_PT,
} from "./layout.js";
import { DOTS_PER_MM } from "./tspl.js";

/**
 * The part of a 2D canvas context the renderer uses. A browser
 * CanvasRenderingContext2D or OffscreenCanvasRenderingContext2D fits, and so
 * should any Node canvas library that follows the same API.
 */
export interface LabelContext {
	fillStyle: unknown;
	strokeStyle: unknown;
	lineWidth: number;
	font: string;
	textAlign: string;
	textBaseline: string;
	/** Not every canvas has it; tracking is skipped where it is missing. */
	letterSpacing?: string;
	save(): void;
	restore(): void;
	translate(x: number, y: number): void;
	fillRect(x: number, y: number, w: number, h: number): void;
	strokeRect(x: number, y: number, w: number, h: number): void;
	fillText(text: string, x: number, y: number): void;
	measureText(text: string): { width: number };
	drawImage(image: any, x: number, y: number, w: number, h: number): void;
	getImageData(x: number, y: number, w: number, h: number): { data: ArrayLike<number> };
}

/** Anything the canvas can draw, with a known size. */
export interface LabelImage {
	width: number;
	height: number;
	naturalWidth?: number;
	naturalHeight?: number;
}

/** Space added on each side of the print, in mm: top 2 moves the print 2 mm down. */
export interface LabelOffset {
	top: number;
	bottom: number;
	left: number;
	right: number;
}

export const NO_OFFSET: LabelOffset = { top: 0, bottom: 0, left: 0, right: 0 };

export interface DrawOptions {
	/** Pixels a millimetre. 8 is printer resolution at 203 dpi; use more for a preview. */
	scale?: number;
	/** Moves everything on the label to correct where the printer puts it. What moves past an edge is cut off. */
	offset?: LabelOffset;
	/** Pictures for image elements, by the element's `image` key. */
	images?: Record<string, LabelImage | undefined>;
	/**
	 * Font families tried after the element's own font, before sans-serif.
	 * Put a Thai family here (for example "Noto Sans Thai") so Thai text in a
	 * Latin font does not fall back to whatever the system picks.
	 */
	fallbackFonts?: string[];
}

/** The canvas size, in pixels, for a design at a scale. */
export function labelPixels(design: { width: number; height: number }, scale = DOTS_PER_MM) {
	return {
		width: Math.round(design.width * scale),
		height: Math.round(design.height * scale),
	};
}

const fontFor = (e: LabelElement, px: number, fallback: string[]) =>
	[
		`${e.weight ?? 400} ${px}px "${e.font ?? DEFAULT_FONT}"`,
		...fallback.map((f) => `"${f}"`),
		"sans-serif",
	].join(", ");

/**
 * In a browser, waits for every font and weight the design uses, so the
 * first draw is the right one: a canvas does not wait for web fonts and
 * silently draws the fallback instead. Elsewhere it does nothing.
 */
export async function loadDesignFonts(elements: LabelElement[], fallbackFonts: string[] = []) {
	const fonts = (globalThis as { document?: { fonts?: { load(font: string, text?: string): Promise<unknown> } } })
		.document?.fonts;
	if (!fonts) return;
	const wanted = new Set(
		elements.filter((e) => e.kind === "text").map((e) => fontFor(e, 16, fallbackFonts)),
	);
	// The sample text makes the browser fetch the Thai subset as well.
	await Promise.all([...wanted].map((f) => fonts.load(f, "Aa ก").catch(() => [])));
}

/**
 * Splits text into lines that fit `max` pixels, keeping its own line breaks.
 * Lines break at whitespace only. Thai is written without spaces between
 * words, so a long Thai line breaks only where the text has a space or a
 * line break of its own.
 */
export function wrapText(
	ctx: Pick<LabelContext, "measureText">,
	text: string,
	max: number,
) {
	const out: string[] = [];
	for (const para of text.split("\n")) {
		const words = para.split(/(\s+)/).filter((w) => w.length);
		let line = "";
		for (const word of words) {
			const next = line + word;
			if (line.trim() && ctx.measureText(next.trimEnd()).width > max) {
				out.push(line.trimEnd());
				line = word.trimStart();
			} else line = next;
		}
		out.push(line.trimEnd());
	}
	return out;
}

/**
 * Draws the design onto a context: white paper, black ink. The canvas must
 * already be labelPixels(design, scale) in size.
 */
export async function drawLabel(
	ctx: LabelContext,
	design: LabelDesign,
	values: LabelValues = {},
	options: DrawOptions = {},
) {
	const scale = options.scale ?? DOTS_PER_MM;
	const offset = options.offset ?? NO_OFFSET;
	const fallback = options.fallbackFonts ?? [];
	const size = labelPixels(design, scale);
	await loadDesignFonts(design.elements, fallback);

	ctx.save();
	ctx.fillStyle = "#fff";
	ctx.fillRect(0, 0, size.width, size.height);
	ctx.fillStyle = "#000";
	ctx.strokeStyle = "#000";
	ctx.translate((offset.left - offset.right) * scale, (offset.top - offset.bottom) * scale);

	for (const e of design.elements) {
		const x = e.x * scale;
		const y = e.y * scale;
		const w = e.w * scale;
		const h = e.h * scale;
		if (e.kind === "line") {
			// Never thinner than one dot, or it disappears at printer resolution.
			ctx.fillRect(x, y, w, Math.max(h, 1));
		} else if (e.kind === "box") {
			const t = Math.max(0.25 * scale, 1);
			ctx.lineWidth = t;
			ctx.strokeRect(x + t / 2, y + t / 2, w - t, h - t);
		} else if (e.kind === "image") {
			const img = options.images?.[e.image ?? ""];
			if (!img) continue;
			// Fits the box, keeping its shape, from the top left.
			const ratio = (img.naturalWidth ?? img.width) / (img.naturalHeight ?? img.height);
			const dw = Math.min(w, h * ratio);
			ctx.drawImage(img, x, y, dw, dw / ratio);
		} else {
			let text = fillText(e.text ?? "", values);
			if (e.uppercase) text = text.toUpperCase();
			const px = (e.size ?? 8) * MM_PER_PT * scale;
			ctx.font = fontFor(e, px, fallback);
			if ("letterSpacing" in ctx) ctx.letterSpacing = `${(e.tracking ?? 0) * px}px`;
			ctx.textBaseline = "middle";
			ctx.textAlign = e.align ?? "left";
			const lead = (e.lineHeight ?? 1.2) * px;
			const ax = e.align === "right" ? x + w : e.align === "center" ? x + w / 2 : x;
			wrapText(ctx, text, w).forEach((line, i) => {
				ctx.fillText(line, ax, y + lead * (i + 0.5));
			});
			if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
		}
	}
	ctx.restore();
}

/**
 * Draws the design at printer resolution and packs it into dots. The canvas
 * must already be labelPixels(design, dotsPerMm) in size.
 */
export async function renderLabel(
	ctx: LabelContext,
	design: LabelDesign,
	values: LabelValues = {},
	options: Omit<DrawOptions, "scale"> & { dotsPerMm?: number; threshold?: number } = {},
): Promise<PackedBitmap> {
	const scale = options.dotsPerMm ?? DOTS_PER_MM;
	const { width, height } = labelPixels(design, scale);
	await drawLabel(ctx, design, values, { ...options, scale });
	const { data } = ctx.getImageData(0, 0, width, height);
	return packRgba(data, width, height, options.threshold);
}
