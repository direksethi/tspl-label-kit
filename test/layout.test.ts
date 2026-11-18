import { describe, expect, it } from "vitest";
import {
	atSize,
	cleanElements,
	cleanSize,
	fieldsOf,
	fillText,
	hasThai,
	productLabel,
	resizeElements,
	shippingLabel,
} from "../src/index.js";

describe("layout", () => {
	it("fills known fields and leaves other braces alone", () => {
		expect(
			fillText("{name} / {phone}\n{address} {other}", {
				name: " Alex Example ",
				phone: "555 0100",
				address: 10110,
			}),
		).toBe("Alex Example / 555 0100\n10110 {other}");
	});

	it("leaves out a line whose fields are all blank", () => {
		const values = { name: "Alex Example", phone: "", reference: undefined };
		expect(fillText("Ref {reference}\n{name}", values)).toBe("Alex Example");
		expect(fillText("{name} {phone}", values)).toBe("Alex Example ");
		expect(fillText("Ref {reference}", { reference: "A-1010" })).toBe("Ref A-1010");
		expect(fillText("Plain line\n{unknown}", {})).toBe("Plain line\n{unknown}");
	});

	it("keeps Thai text as it is", () => {
		expect(hasThai("สวัสดี")).toBe(true);
		expect(hasThai("Hello")).toBe(false);
		expect(fillText("{titleTh}\n{title}", { titleTh: "ชาเขียว", title: "Green tea" })).toBe(
			"ชาเขียว\nGreen tea",
		);
	});

	it("lists the fields a design uses", () => {
		expect(fieldsOf(shippingLabel().elements)).toEqual(["reference", "name", "phone", "address"]);
		expect(fieldsOf(productLabel().elements)).toEqual(["title", "titleTh", "sku", "price"]);
	});

	it("keeps sizes within what the printer takes", () => {
		expect(cleanSize(60, 40)).toEqual({ width: 60, height: 40 });
		expect(cleanSize(200, 2)).toEqual({ width: 80, height: 15 });
		expect(cleanSize("x", null)).toEqual({ width: 80, height: 60 });
		expect(
			cleanSize(200, 300, {
				minMm: 10,
				maxWidthMm: 104,
				maxHeightMm: 250,
				fallback: { width: 100, height: 150 },
			}),
		).toEqual({ width: 104, height: 250 });
	});

	it("drops unknown elements and clamps the rest", () => {
		const out = cleanElements([
			{ kind: "nope" },
			{ id: "t", kind: "text", x: 1, y: 2, w: 3, h: 4, size: 1, weight: 650, align: "middle" },
			null,
			{ kind: "image", image: "logo", w: 900 },
		]);
		expect(out).toHaveLength(2);
		expect(out[0]).toMatchObject({
			id: "t",
			size: 2,
			weight: 700,
			align: "left",
			font: "sans-serif",
			uppercase: false,
		});
		expect(out[1]).toMatchObject({ id: "el3", kind: "image", image: "logo", w: 200, h: 1 });
		expect(cleanElements("nope")).toEqual([]);
	});

	it("passes the example designs through unchanged apart from defaults", () => {
		for (const design of [shippingLabel(), productLabel()]) {
			expect(cleanElements(design.elements)).toEqual(
				design.elements.map((e) =>
					e.kind === "text" ? { font: "sans-serif", tracking: 0, uppercase: false, ...e } : e,
				),
			);
			for (const e of design.elements) {
				expect(e.x + e.w).toBeLessThanOrEqual(design.width);
				expect(e.y + e.h).toBeLessThanOrEqual(design.height);
			}
		}
	});

	it("scales a layout to another label size", () => {
		const design = shippingLabel();
		const half = atSize(design, { width: 40, height: 30 });
		const rule = half.elements.find((e) => e.id === "rule");
		const name = half.elements.find((e) => e.id === "name");
		expect(rule).toMatchObject({ x: 2.5, w: 35, h: 0.3 });
		expect(name?.size).toBeCloseTo(6.5);
		// Type follows the smaller stretch; an image keeps its shape.
		const [image, text] = resizeElements(
			[
				{ id: "i", kind: "image", x: 0, y: 0, w: 20, h: 10, image: "logo" },
				{ id: "t", kind: "text", x: 0, y: 0, w: 20, h: 10, size: 10 },
			],
			{ width: 80, height: 60 },
			{ width: 80, height: 30 },
		);
		expect(image).toMatchObject({ w: 10, h: 5 });
		expect(text).toMatchObject({ w: 20, h: 5, size: 5 });
		expect(resizeElements(design.elements, design, design)).toBe(design.elements);
	});
});
