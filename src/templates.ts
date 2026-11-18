import type { LabelDesign } from "./layout.js";

/**
 * Example designs. They are starting points: copy one and change it, or
 * write a design from scratch.
 */

/**
 * A shipping label, 80 x 60 mm: a heading and a reference across the top, a
 * rule, then who the parcel goes to.
 *
 * Fields: {name}, {phone}, {address}, {reference}.
 */
export function shippingLabel(): LabelDesign {
	return {
		width: 80,
		height: 60,
		elements: [
			{
				id: "heading",
				kind: "text",
				x: 5,
				y: 5,
				w: 30,
				h: 4.5,
				text: "Ship to",
				weight: 700,
				size: 9,
				align: "left",
				lineHeight: 1.2,
				tracking: 0.15,
				uppercase: true,
			},
			{
				id: "reference",
				kind: "text",
				x: 45,
				y: 5.6,
				w: 30,
				h: 3.2,
				text: "Ref {reference}",
				weight: 500,
				size: 7,
				align: "right",
				lineHeight: 1.2,
			},
			{ id: "rule", kind: "line", x: 5, y: 12, w: 70, h: 0.3 },
			{
				id: "name",
				kind: "text",
				x: 5,
				y: 15.6,
				w: 70,
				h: 5.8,
				text: "{name}",
				weight: 700,
				size: 13,
				align: "left",
				lineHeight: 1.2,
			},
			{
				id: "phone",
				kind: "text",
				x: 5,
				y: 22,
				w: 70,
				h: 4.5,
				text: "{phone}",
				weight: 600,
				size: 10,
				align: "left",
				lineHeight: 1.2,
			},
			{
				id: "address",
				kind: "text",
				x: 5,
				y: 29,
				w: 70,
				h: 26,
				text: "{address}",
				weight: 400,
				size: 9,
				align: "left",
				lineHeight: 1.45,
			},
		],
	};
}

/**
 * A product label, 50 x 30 mm, with the name in two scripts: a Latin title,
 * the same title in Thai below it, then a code and a price inside a frame.
 *
 * Fields: {title}, {titleTh}, {sku}, {price}. A line whose field is blank is
 * left out, so the Thai line is optional.
 */
export function productLabel(): LabelDesign {
	return {
		width: 50,
		height: 30,
		elements: [
			{ id: "frame", kind: "box", x: 2, y: 2, w: 46, h: 26 },
			{
				id: "title",
				kind: "text",
				x: 4.5,
				y: 4.5,
				w: 41,
				h: 5,
				text: "{title}",
				weight: 700,
				size: 11,
				align: "left",
				lineHeight: 1.2,
			},
			{
				id: "titleTh",
				kind: "text",
				x: 4.5,
				y: 10,
				w: 41,
				h: 4.5,
				text: "{titleTh}",
				font: "Noto Sans Thai",
				weight: 500,
				size: 9,
				align: "left",
				lineHeight: 1.35,
			},
			{ id: "divider", kind: "line", x: 4.5, y: 17.5, w: 41, h: 0.25 },
			{
				id: "sku",
				kind: "text",
				x: 4.5,
				y: 20,
				w: 22,
				h: 4,
				text: "{sku}",
				font: "monospace",
				weight: 400,
				size: 8,
				align: "left",
				lineHeight: 1.2,
			},
			{
				id: "price",
				kind: "text",
				x: 26.5,
				y: 19.2,
				w: 19,
				h: 5.5,
				text: "{price}",
				weight: 700,
				size: 12,
				align: "right",
				lineHeight: 1.2,
			},
		],
	};
}
