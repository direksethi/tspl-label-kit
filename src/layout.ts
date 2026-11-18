/**
 * A label design is a label size and the things drawn on it, all measured in
 * millimetres from the top left. Text may carry {fields}, filled in for each
 * label from a plain object of values.
 */

export type LabelElementKind = "text" | "image" | "line" | "box";
export type LabelAlign = "left" | "center" | "right";

export interface LabelElement {
	id: string;
	kind: LabelElementKind;
	/** Top left corner and size, in mm. A line's height is its thickness. */
	x: number;
	y: number;
	w: number;
	h: number;
	/** Text elements only. */
	text?: string;
	font?: string;
	/** 100 to 900. */
	weight?: number;
	/** In points. */
	size?: number;
	align?: LabelAlign;
	/** A multiple of the font size. */
	lineHeight?: number;
	/** Extra space between letters, in em. */
	tracking?: number;
	uppercase?: boolean;
	/** Image elements only: the key of the picture in the renderer's `images`. */
	image?: string;
}

export interface LabelSize {
	/** Label size in mm, across the roll then along it. */
	width: number;
	height: number;
}

export interface LabelDesign extends LabelSize {
	elements: LabelElement[];
}

/** Values for the {fields} in a design's text. */
export type LabelValues = Record<string, string | number | null | undefined>;

/** Limits used by cleanSize. The defaults suit an 80 mm, 203 dpi desktop printer. */
export interface SizeLimits {
	minMm: number;
	maxWidthMm: number;
	maxHeightMm: number;
	fallback: LabelSize;
}

export const DEFAULT_SIZE: LabelSize = { width: 80, height: 60 };
export const DEFAULT_LIMITS: SizeLimits = {
	minMm: 15,
	maxWidthMm: 80,
	maxHeightMm: 200,
	fallback: DEFAULT_SIZE,
};

/** Common die-cut roll sizes, width by height in mm. */
export const COMMON_SIZES: LabelSize[] = [
	{ width: 80, height: 60 },
	{ width: 60, height: 40 },
	{ width: 50, height: 30 },
	{ width: 40, height: 30 },
	{ width: 70, height: 50 },
	{ width: 80, height: 50 },
	{ width: 100, height: 50 },
	{ width: 100, height: 100 },
	{ width: 100, height: 150 },
];

export const MM_PER_PT = 25.4 / 72;
export const DEFAULT_FONT = "sans-serif";

/** Whether the text contains Thai script. */
export const hasThai = (text: string) => /[฀-๿]/.test(text);

const FIELD = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Fills the {fields} that `values` has a key for; other braces are left as
 * typed. A line whose fields are all blank is left out, so "Ref {reference}"
 * prints nothing when there is no reference.
 */
export function fillText(text: string, values: LabelValues) {
	const known = (k: string) => Object.hasOwn(values, k);
	const value = (k: string) => String(values[k] ?? "").trim();
	return text
		.split("\n")
		.flatMap((line) => {
			const keys = [...line.matchAll(FIELD)].map((m) => m[1]).filter(known);
			if (keys.length && keys.every((k) => !value(k))) return [];
			return [line.replace(FIELD, (all, k: string) => (known(k) ? value(k) : all))];
		})
		.join("\n");
}

/** The names of the {fields} a design uses, in order of first appearance. */
export function fieldsOf(elements: LabelElement[]) {
	const out = new Set<string>();
	for (const e of elements)
		for (const m of (e.text ?? "").matchAll(FIELD)) out.add(m[1]);
	return [...out];
}

/**
 * A design's elements drawn at another label size: positions stretch with
 * the label, and type scales with the smaller of the two stretches so it
 * never overflows. A line keeps its thickness and an image keeps its shape.
 */
export function resizeElements(
	elements: LabelElement[],
	from: LabelSize,
	to: LabelSize,
): LabelElement[] {
	if (from.width === to.width && from.height === to.height) return elements;
	const sx = to.width / from.width;
	const sy = to.height / from.height;
	const s = Math.min(sx, sy);
	return elements.map((e) => ({
		...e,
		x: e.x * sx,
		y: e.y * sy,
		w: e.kind === "image" ? e.w * s : e.w * sx,
		h: e.kind === "line" ? e.h : e.kind === "image" ? e.h * s : e.h * sy,
		...(e.size ? { size: e.size * s } : {}),
	}));
}

/** A design drawn at another label size (see resizeElements). */
export function atSize(design: LabelDesign, size: LabelSize): LabelDesign {
	return {
		width: size.width,
		height: size.height,
		elements: resizeElements(design.elements, design, size),
	};
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const num = (v: unknown, fallback: number) =>
	typeof v === "number" && Number.isFinite(v) ? v : fallback;
const KINDS: LabelElementKind[] = ["text", "image", "line", "box"];
const ALIGNS: LabelAlign[] = ["left", "center", "right"];
const MAX_ELEMENTS = 60;
const MAX_COORD_MM = 200;

/** Any input as a label size, within what the printer can take. */
export function cleanSize(
	width: unknown,
	height: unknown,
	limits: SizeLimits = DEFAULT_LIMITS,
): LabelSize {
	return {
		width: clamp(num(width, limits.fallback.width), limits.minMm, limits.maxWidthMm),
		height: clamp(num(height, limits.fallback.height), limits.minMm, limits.maxHeightMm),
	};
}

/**
 * Any input as design elements: known kinds, numbers in range, at most 60.
 * Use it on designs that come from storage or from a request body.
 */
export function cleanElements(input: unknown): LabelElement[] {
	if (!Array.isArray(input)) return [];
	return input.slice(0, MAX_ELEMENTS).flatMap((raw, i): LabelElement[] => {
		if (!raw || typeof raw !== "object") return [];
		const r = raw as Record<string, unknown>;
		const kind = KINDS.includes(r.kind as LabelElementKind)
			? (r.kind as LabelElementKind)
			: null;
		if (!kind) return [];
		const el: LabelElement = {
			id: typeof r.id === "string" && r.id.length <= 40 ? r.id : `el${i}`,
			kind,
			x: clamp(num(r.x, 0), -MAX_COORD_MM, MAX_COORD_MM),
			y: clamp(num(r.y, 0), -MAX_COORD_MM, MAX_COORD_MM),
			w: clamp(num(r.w, 10), 0.1, MAX_COORD_MM),
			h: clamp(num(r.h, 1), 0.1, MAX_COORD_MM),
		};
		if (kind === "image") {
			el.image = typeof r.image === "string" && r.image.length <= 60 ? r.image : "";
		}
		if (kind === "text") {
			el.text = typeof r.text === "string" ? r.text.slice(0, 2000) : "";
			el.font = typeof r.font === "string" && r.font.length <= 60 ? r.font : DEFAULT_FONT;
			el.weight = clamp(Math.round(num(r.weight, 400) / 100) * 100, 100, 900);
			el.size = clamp(num(r.size, 8), 2, 200);
			el.align = ALIGNS.includes(r.align as LabelAlign) ? (r.align as LabelAlign) : "left";
			el.lineHeight = clamp(num(r.lineHeight, 1.2), 0.6, 4);
			el.tracking = clamp(num(r.tracking, 0), -0.2, 1);
			el.uppercase = r.uppercase === true;
		}
		return [el];
	});
}
