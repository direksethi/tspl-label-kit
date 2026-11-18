import { describe, expect, it } from "vitest";
import {
	decodePbm,
	encodePbm,
	fromBase64,
	fromPacked,
	getDot,
	packGrey,
	packRgba,
	rotate180,
	toBase64,
} from "../src/index.js";

describe("bitmap packing", () => {
	it("packs dots a bit each, leftmost first, black as 1", () => {
		// 10 x 1: black, white, then black at x = 9.
		const rgba = new Uint8ClampedArray(10 * 4).fill(255);
		for (const x of [0, 9]) rgba.set([0, 0, 0, 255], x * 4);
		const { rowBytes, data } = packRgba(rgba, 10, 1);
		expect(rowBytes).toBe(2);
		expect([...data]).toEqual([0x80, 0x40]);
		expect(toBase64(data)).toBe("gEA=");
	});

	it("counts transparent pixels as paper and weighs colour by luminance", () => {
		const rgba = new Uint8ClampedArray([
			0, 0, 0, 0, // transparent black: paper
			0, 0, 0, 255, // black
			255, 255, 0, 255, // yellow is light: paper
			0, 0, 255, 255, // blue is dark: ink
			0, 0, 0, 64, // a quarter black over white is 191: paper
			0, 0, 0, 128, // half black over white is about 127: ink
		]);
		expect([...packRgba(rgba, 6, 1).data]).toEqual([0b01010100]);
	});

	it("applies the threshold to greyscale", () => {
		const grey = [0, 159, 160, 255];
		expect([...packGrey(grey, 4, 1).data]).toEqual([0b11000000]);
		expect([...packGrey(grey, 4, 1, 128).data]).toEqual([0b10000000]);
	});

	it("starts every row on a byte boundary", () => {
		// 9 x 2, all black: the 7 padding bits of each row stay 0.
		const { rowBytes, data } = packGrey(new Uint8Array(18), 9, 2);
		expect(rowBytes).toBe(2);
		expect([...data]).toEqual([0xff, 0x80, 0xff, 0x80]);
	});

	it("rejects buffers and sizes that do not match", () => {
		expect(() => packRgba(new Uint8Array(4), 2, 1)).toThrow(RangeError);
		expect(() => packGrey(new Uint8Array(1), 0, 1)).toThrow(RangeError);
		expect(() => fromPacked(new Uint8Array(3), 10, 2)).toThrow(/Expected 4 bytes/);
	});

	it("turns a bitmap half a turn without moving the padding", () => {
		// 10 x 2 with one dot at the top left.
		const bitmap = fromPacked(new Uint8Array([0x80, 0, 0, 0]), 10, 2);
		const turned = rotate180(bitmap);
		expect([...turned.data]).toEqual([0, 0, 0, 0x40]);
		expect(getDot(turned, 9, 1)).toBe(true);
		expect([...rotate180(turned).data]).toEqual([...bitmap.data]);
	});

	it("round trips base64 and PBM", () => {
		const bitmap = fromPacked(new Uint8Array([0x80, 0x40, 0xff, 0xc0]), 10, 2);
		expect([...fromBase64(toBase64(bitmap.data))]).toEqual([...bitmap.data]);
		const pbm = encodePbm(bitmap);
		expect(String.fromCharCode(...pbm.subarray(0, 8))).toBe("P4\n10 2\n");
		expect(decodePbm(pbm)).toEqual(bitmap);
		const commented = new Uint8Array([
			...new TextEncoder().encode("P4\n# made by a test\n10 2\n"),
			...bitmap.data,
		]);
		expect(decodePbm(commented)).toEqual(bitmap);
		expect(() => decodePbm(new TextEncoder().encode("P1\n1 1\n1"))).toThrow(/P4/);
		expect(() => decodePbm(pbm.subarray(0, pbm.length - 1))).toThrow(/shorter/);
	});
});
