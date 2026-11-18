import { describe, expect, it } from "vitest";
import { buildTspl, fromPacked, testPattern } from "../src/index.js";

const ascii = (bytes: Uint8Array) => String.fromCharCode(...bytes);

describe("buildTspl", () => {
	const bitmap = fromPacked(new Uint8Array([0x80, 0x40, 0x00, 0x00]), 10, 2);

	it("writes the command sequence around the raw bitmap", () => {
		const out = buildTspl(bitmap, { widthMm: 80, heightMm: 60, copies: 3 });
		const head =
			"SIZE 80 mm,60 mm\r\nGAP 2 mm,0 mm\r\nDIRECTION 1\r\nREFERENCE 0,0\r\nSHIFT 0\r\nCLS\r\nBITMAP 0,0,2,2,0,";
		const tail = "\r\nPRINT 3,1\r\n";
		expect(ascii(out.subarray(0, head.length))).toBe(head);
		expect(ascii(out.subarray(out.length - tail.length))).toBe(tail);
		expect(out.length).toBe(head.length + 4 + tail.length);
	});

	it("inverts the dots, because TSPL prints 0 bits", () => {
		const out = buildTspl(bitmap);
		const start = ascii(out).indexOf("BITMAP 0,0,2,2,0,") + "BITMAP 0,0,2,2,0,".length;
		expect([...out.subarray(start, start + 4)]).toEqual([0x7f, 0xbf, 0xff, 0xff]);
	});

	it("derives the label size from the bitmap at 8 dots a mm", () => {
		const out = buildTspl(testPattern(50, 30));
		expect(ascii(out.subarray(0, 18))).toBe("SIZE 50 mm,30 mm\r\n");
		expect(ascii(out)).toContain("BITMAP 0,0,50,240,0,");
	});

	it("applies gap, reference, shift and rotation", () => {
		const out = buildTspl(bitmap, {
			gapMm: 3,
			referenceX: 14.4,
			shiftY: -5,
			rotate: true,
			direction: 0,
			widthMm: 57.126,
			heightMm: 0.25,
		});
		const text = ascii(out);
		expect(text).toContain("SIZE 57.13 mm,0.25 mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 0\r\nREFERENCE 14,0\r\nSHIFT 0\r\n");
		const marker = "BITMAP 0,0,2,2,0,";
		const start = text.indexOf(marker) + marker.length;
		// Rotated: the dots at (0,0) and (9,0) land at (9,1) and (0,1).
		expect([...out.subarray(start, start + 4)]).toEqual([0xff, 0xff, 0x7f, 0xbf]);
		expect(text.endsWith("\r\nPRINT 1,1\r\n")).toBe(true);
	});

	it("refuses a bitmap whose bytes do not match its size", () => {
		expect(() =>
			buildTspl({ width: 10, height: 2, rowBytes: 2, data: new Uint8Array(3) }),
		).toThrow(/Expected 4 bytes/);
	});
});

describe("testPattern", () => {
	it("frames the label and marks the top left", () => {
		const p = testPattern(20, 15);
		expect([p.width, p.height, p.rowBytes]).toEqual([160, 120, 20]);
		// Top and bottom rows are solid.
		expect([...p.data.subarray(0, 20)]).toEqual(Array(20).fill(0xff));
		expect([...p.data.subarray(119 * 20)]).toEqual(Array(20).fill(0xff));
		// The solid square starts 5 mm in.
		expect(p.data[40 * 20 + 5]).toBe(0xff);
		expect(p.data[39 * 20 + 5]).toBe(0x00);
	});
});
