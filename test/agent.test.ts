import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fromPacked, jobBitmap, type PrintJob, toJob } from "../src/index.js";
import { describeDeviceError, findPrinter, runAgent } from "../src/node.js";

const job: PrintJob = toJob(fromPacked(new Uint8Array([0x80, 0x40]), 10, 1), {
	id: "job-1",
	widthMm: 40,
	heightMm: 30,
	copies: 2,
});

/** A queue that hands out the given jobs once each and records every request. */
function fakeQueue(jobs: unknown[]) {
	const requests: { url: string; auth: string | null; body: unknown }[] = [];
	const pending = [...jobs];
	const fetchStub = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		const headers = new Headers(init?.headers);
		requests.push({
			url,
			auth: headers.get("authorization"),
			body: init?.body ? JSON.parse(String(init.body)) : null,
		});
		if (url.includes("/next")) {
			const next = pending.shift();
			return next ? Response.json(next) : new Response(null, { status: 204 });
		}
		return Response.json({ ok: true });
	}) as typeof fetch;
	return { requests, fetch: fetchStub };
}

const quiet = { log: () => {}, sleep: async () => {} };

describe("agent", () => {
	it("prints a job and reports it", async () => {
		const out = join(mkdtempSync(join(tmpdir(), "tspl-")), "out.tspl");
		const queue = fakeQueue([job]);
		const result = await runAgent({
			queueUrl: "http://queue.test/api/",
			token: "test-token",
			printer: { device: out },
			tspl: { referenceX: 14, rotate: true },
			once: true,
			fetch: queue.fetch,
			...quiet,
		});
		expect(result).toEqual({ printed: 1 });
		const bytes = readFileSync(out);
		const head =
			"SIZE 40 mm,30 mm\r\nGAP 2 mm,0 mm\r\nDIRECTION 1\r\nREFERENCE 14,0\r\nSHIFT 0\r\nCLS\r\nBITMAP 0,0,2,1,0,";
		expect(bytes.subarray(0, head.length).toString("latin1")).toBe(head);
		// Rotated then inverted: dots at x = 0 and 9 are the same pair after a half turn.
		expect([...bytes.subarray(head.length, head.length + 2)]).toEqual([0x7f, 0xbf]);
		expect(bytes.subarray(head.length + 2).toString("latin1")).toBe("\r\nPRINT 2,1\r\n");

		expect(queue.requests.map((r) => r.url.replace(/\?.*/, ""))).toEqual([
			"http://queue.test/api/next",
			"http://queue.test/api/jobs/job-1",
			"http://queue.test/api/next",
		]);
		expect(queue.requests[0].url).toMatch(/info=.*ready/);
		expect(queue.requests.every((r) => r.auth === "Bearer test-token")).toBe(true);
		expect(queue.requests[1].body).toEqual({ status: "printed" });
	});

	it("reports a failure when the printer is missing or the job is malformed", async () => {
		const queue = fakeQueue([job, { ...job, id: "job-2", dotsW: 99 }]);
		const sent: string[] = [];
		const result = await runAgent({
			queueUrl: "http://queue.test",
			token: "t",
			printer: { sysRoot: "/nonexistent" },
			once: true,
			fetch: queue.fetch,
			send: async (device) => void sent.push(device),
			...quiet,
		});
		expect(result).toEqual({ printed: 0 });
		expect(sent).toEqual([]);
		expect(queue.requests[0].url).toMatch(/printer%20not%20found/);
		expect(queue.requests[1].body).toEqual({
			status: "failed",
			error: "The label printer is not connected.",
		});

		const second = fakeQueue([{ ...job, id: "job-2", dotsW: 99 }]);
		await runAgent({
			queueUrl: "http://queue.test",
			token: "t",
			printer: { device: "/dev/null" },
			once: true,
			fetch: second.fetch,
			send: async (device) => void sent.push(device),
			...quiet,
		});
		expect(sent).toEqual([]);
		expect(second.requests[1].body).toMatchObject({ status: "failed" });
		expect((second.requests[1].body as { error: string }).error).toMatch(/Expected 13 bytes/);
	});

	it("stops with an error in once mode when the queue cannot be reached", async () => {
		await expect(
			runAgent({
				queueUrl: "http://queue.test",
				token: "t",
				once: true,
				fetch: (async () => new Response(null, { status: 401 })) as typeof fetch,
				...quiet,
			}),
		).rejects.toThrow(/HTTP 401/);
	});
});

describe("device", () => {
	it("finds the lp device by USB id", () => {
		const root = mkdtempSync(join(tmpdir(), "usbmisc-"));
		const add = (name: string, vendor: string, product: string) => {
			// lpN/device is the interface; the ids sit one level up.
			mkdirSync(join(root, name, "device"), { recursive: true });
			writeFileSync(join(root, name, "idVendor"), `${vendor}\n`);
			writeFileSync(join(root, name, "idProduct"), `${product}\n`);
		};
		add("lp0", "04b8", "0202");
		add("lp1", "0471", "0055");
		add("hiddev0", "0471", "0055");
		expect(findPrinter({ sysRoot: root })).toBe("/dev/usb/lp1");
		expect(findPrinter({ sysRoot: root, usbId: "04B8:0202" })).toBe("/dev/usb/lp0");
		expect(findPrinter({ sysRoot: root, usbId: "1234:5678" })).toBeNull();
		expect(findPrinter({ sysRoot: root, device: "/dev/usb/lp9" })).toBe("/dev/usb/lp9");
		expect(findPrinter({ sysRoot: join(root, "missing") })).toBeNull();
	});

	it("puts device errors in plain words", () => {
		expect(describeDeviceError({ code: "EACCES" })).toMatch(/not allowed/);
		expect(describeDeviceError({ code: "ENOENT" })).toMatch(/not connected/);
		expect(describeDeviceError(new Error("Something else"))).toBe("Something else");
	});
});

describe("jobs", () => {
	it("round trips a bitmap through the job format", () => {
		expect(job).toMatchObject({ width: 40, height: 30, dotsW: 10, dotsH: 1, copies: 2, data: "gEA=" });
		expect([...jobBitmap(job).data]).toEqual([0x80, 0x40]);
		expect(toJob(fromPacked(new Uint8Array(480 * 80), 640, 480))).toMatchObject({ width: 80, height: 60 });
		expect(() => jobBitmap({ ...job, width: 0 })).toThrow(/label size/);
	});
});
