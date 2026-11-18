import { describe, expect, it } from "vitest";
import {
	drawLabel,
	type LabelContext,
	type LabelDesign,
	labelPixels,
	renderLabel,
	wrapText,
} from "../src/index.js";

/**
 * A stand-in for a canvas context: it records the calls, measures every
 * character as 10 px wide, and keeps real pixels for fillRect only.
 */
function fakeContext(width: number, height: number) {
	const calls: unknown[][] = [];
	const pixels = new Uint8ClampedArray(width * height * 4);
	let dx = 0;
	let dy = 0;
	const saved: [number, number][] = [];
	const ctx: LabelContext & { calls: unknown[][] } = {
		calls,
		fillStyle: "#000",
		strokeStyle: "#000",
		lineWidth: 1,
		font: "",
		textAlign: "left",
		textBaseline: "alphabetic",
		letterSpacing: "0px",
		save: () => void saved.push([dx, dy]),
		restore: () => {
			[dx, dy] = saved.pop() ?? [0, 0];
		},
		translate: (x, y) => {
			dx += x;
			dy += y;
		},
		fillRect(x, y, w, h) {
			calls.push(["fillRect", x + dx, y + dy, w, h]);
			const v = this.fillStyle === "#fff" ? 255 : 0;
			for (let j = Math.max(0, Math.round(y + dy)); j < Math.min(height, Math.round(y + dy + h)); j++)
				for (let i = Math.max(0, Math.round(x + dx)); i < Math.min(width, Math.round(x + dx + w)); i++)
					pixels.set([v, v, v, 255], (j * width + i) * 4);
		},
		strokeRect(x, y, w, h) {
			calls.push(["strokeRect", x + dx, y + dy, w, h, this.lineWidth]);
		},
		fillText(text, x, y) {
			calls.push(["fillText", text, x + dx, y + dy, this.font, this.textAlign, this.letterSpacing]);
		},
		measureText: (text) => ({ width: text.length * 10 }),
		drawImage: (image, x, y, w, h) => void calls.push(["drawImage", image, x + dx, y + dy, w, h]),
		getImageData: () => ({ data: pixels }),
	};
	return ctx;
}

describe("render", () => {
	it("sizes the canvas in dots", () => {
		expect(labelPixels({ width: 80, height: 60 })).toEqual({ width: 640, height: 480 });
		expect(labelPixels({ width: 50, height: 30 }, 4)).toEqual({ width: 200, height: 120 });
	});

	it("wraps at spaces and keeps line breaks", () => {
		const ctx = fakeContext(1, 1);
		expect(wrapText(ctx, "one two three\nfour", 70)).toEqual(["one two", "three", "four"]);
		// A word longer than the line is not split.
		expect(wrapText(ctx, "unbreakable word", 50)).toEqual(["unbreakable", "word"]);
		// Thai has no spaces between words, so it only breaks where the text has one.
		expect(wrapText(ctx, "ชาเขียวมะลิ ร้อน", 50)).toEqual(["ชาเขียวมะลิ", "ร้อน"]);
	});

	it("draws text with its font, alignment, tracking and leading", async () => {
		const design: LabelDesign = {
			width: 40,
			height: 20,
			elements: [
				{
					id: "t",
					kind: "text",
					x: 5,
					y: 2,
					w: 30,
					h: 10,
					text: "{name}\nRef {reference}",
					font: "Example Sans",
					weight: 700,
					size: 72 / 25.4, // 1 mm, so 8 px at 8 dots a mm
					align: "right",
					lineHeight: 1.5,
					tracking: 0.25,
					uppercase: true,
				},
			],
		};
		const ctx = fakeContext(320, 160);
		await drawLabel(ctx, design, { name: "Alex", reference: "" }, { fallbackFonts: ["Noto Sans Thai"] });
		const texts = ctx.calls.filter((c) => c[0] === "fillText");
		expect(texts).toHaveLength(1);
		const [, text, x, y, font, align, spacing] = texts[0];
		expect(text).toBe("ALEX");
		expect(x).toBeCloseTo(280);
		expect(y).toBeCloseTo(16 + 6);
		expect(font).toMatch(/^700 8(\.0+\d*)?px "Example Sans", "Noto Sans Thai", sans-serif$/);
		expect(align).toBe("right");
		expect(spacing).toMatch(/^2(\.0+\d*)?px$/);
		expect(ctx.letterSpacing).toBe("0px");
	});

	it("draws lines, boxes and images, moved by the offset", async () => {
		const design: LabelDesign = {
			width: 20,
			height: 10,
			elements: [
				{ id: "l", kind: "line", x: 1, y: 1, w: 10, h: 0.05 },
				{ id: "b", kind: "box", x: 2, y: 2, w: 10, h: 5 },
				{ id: "i", kind: "image", x: 0, y: 0, w: 10, h: 10, image: "mark" },
				{ id: "missing", kind: "image", x: 0, y: 0, w: 10, h: 10, image: "none" },
			],
		};
		const mark = { width: 200, height: 100 };
		const ctx = fakeContext(160, 80);
		await drawLabel(ctx, design, {}, {
			images: { mark },
			offset: { top: 1, bottom: 0, left: 0, right: 0.5 },
		});
		// The paper is filled before the offset applies.
		expect(ctx.calls[0]).toEqual(["fillRect", 0, 0, 160, 80]);
		// A hairline is still one dot thick.
		expect(ctx.calls[1]).toEqual(["fillRect", 4, 16, 80, 1]);
		expect(ctx.calls[2]).toEqual(["strokeRect", 13, 25, 78, 38, 2]);
		// The image fits its box by width and keeps its 2:1 shape.
		expect(ctx.calls[3]).toEqual(["drawImage", mark, -4, 8, 80, 40]);
		expect(ctx.calls).toHaveLength(4);
	});

	it("renders to packed dots at printer resolution", async () => {
		const design: LabelDesign = {
			width: 2,
			height: 1,
			elements: [{ id: "l", kind: "line", x: 0, y: 0, w: 1, h: 0.5 }],
		};
		const ctx = fakeContext(16, 8);
		const bitmap = await renderLabel(ctx, design);
		expect([bitmap.width, bitmap.height, bitmap.rowBytes]).toEqual([16, 8, 2]);
		expect([...bitmap.data]).toEqual([0xff, 0, 0xff, 0, 0xff, 0, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
	});
});
