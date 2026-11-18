#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { runAgent } from "./agent.js";
import { decodePbm, type PackedBitmap } from "./bitmap.js";
import { describeDeviceError, findPrinter, sendToPrinter } from "./device.js";
import { jobBitmap, type PrintJob } from "./job.js";
import { testPattern } from "./pattern.js";
import { buildTspl, DOTS_PER_MM } from "./tspl.js";

const HELP = `tspl-label: print bitmaps on TSPL label printers over USB

Usage
  tspl-label print <file>      Print a binary PBM (P4) file or a job JSON file
  tspl-label test-pattern      Print a calibration label (needs --width and --height)
  tspl-label agent             Poll an HTTP queue and print what it hands out

Options (the environment variable in brackets is used when the flag is absent)
  --width <mm>           Label width  (print: bitmap width / 8)
  --height <mm>          Label height (print: bitmap height / 8)
  --copies <n>           Number of labels, 1
  --gap <mm>             Gap between labels, 2                      [GAP_MM]
  --reference-x <dots>   Move the print across the roll, 0          [REFERENCE_X]
  --shift-y <dots>       Move the print along the roll, 0 or more   [SHIFT_Y]
  --rotate               Turn the label half a turn                 [ROTATE=1]
  --device <path>        Printer device, for example /dev/usb/lp0   [PRINTER_DEVICE]
  --usb-id <vid:pid>     Find the device by USB id, 0471:0055       [PRINTER_USB_ID]
  --out <file>           Dry run: write the TSPL bytes to a file instead of the printer
  --once                 agent: stop when the queue is empty
  --help

Agent settings
  LABEL_QUEUE_URL        Base URL of the queue (required)
  LABEL_QUEUE_TOKEN      Bearer token for the queue (required)
  POLL_MS                Poll interval in ms, 2000
`;

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

const numberOr = (v: string | undefined, fallback: number | undefined, name: string) => {
	if (v === undefined || v === "") return fallback;
	const n = Number(v);
	if (!Number.isFinite(n)) fail(`${name} must be a number.`);
	return n;
};

async function main() {
	const { values: flags, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			width: { type: "string" },
			height: { type: "string" },
			copies: { type: "string" },
			gap: { type: "string" },
			"reference-x": { type: "string" },
			"shift-y": { type: "string" },
			rotate: { type: "boolean" },
			device: { type: "string" },
			"usb-id": { type: "string" },
			out: { type: "string" },
			once: { type: "boolean" },
			help: { type: "boolean", short: "h" },
		},
	});
	const [command, file] = positionals;
	if (flags.help || !command) {
		console.log(HELP);
		process.exit(command || flags.help ? 0 : 1);
	}

	const env = process.env;
	const tspl = {
		gapMm: numberOr(flags.gap ?? env.GAP_MM, 2, "--gap"),
		referenceX: numberOr(flags["reference-x"] ?? env.REFERENCE_X, 0, "--reference-x"),
		shiftY: numberOr(flags["shift-y"] ?? env.SHIFT_Y, 0, "--shift-y"),
		rotate: flags.rotate ?? env.ROTATE === "1",
	};
	// A dry run names a file as the device, so nothing reaches a printer.
	const printer = {
		device: flags.out ?? flags.device ?? env.PRINTER_DEVICE,
		usbId: flags["usb-id"] ?? env.PRINTER_USB_ID,
	};

	if (command === "agent") {
		const queueUrl = env.LABEL_QUEUE_URL;
		const token = env.LABEL_QUEUE_TOKEN;
		if (!queueUrl) fail("LABEL_QUEUE_URL is not set.");
		if (!token) fail("LABEL_QUEUE_TOKEN is not set.");
		const stop = new AbortController();
		process.on("SIGINT", () => stop.abort());
		process.on("SIGTERM", () => stop.abort());
		await runAgent({
			queueUrl,
			token,
			printer,
			tspl,
			pollMs: numberOr(env.POLL_MS, 2000, "POLL_MS"),
			once: flags.once,
			signal: stop.signal,
		});
		return;
	}

	let bitmap: PackedBitmap;
	let widthMm = numberOr(flags.width, undefined, "--width");
	let heightMm = numberOr(flags.height, undefined, "--height");
	let copies = numberOr(flags.copies, 1, "--copies");
	if (command === "test-pattern") {
		if (!widthMm || !heightMm) fail("test-pattern needs --width and --height in mm.");
		bitmap = testPattern(widthMm, heightMm);
	} else if (command === "print") {
		if (!file) fail("print needs a file: a binary PBM (P4) or a job JSON.");
		const bytes = await readFile(file);
		if (bytes[0] === 0x7b) {
			const job = JSON.parse(bytes.toString("utf8")) as PrintJob;
			bitmap = jobBitmap(job);
			widthMm ??= job.width;
			heightMm ??= job.height;
			if (flags.copies === undefined) copies = job.copies;
		} else bitmap = decodePbm(bytes);
	} else fail(`Unknown command "${command}".\n\n${HELP}`);

	widthMm ??= bitmap.width / DOTS_PER_MM;
	heightMm ??= bitmap.height / DOTS_PER_MM;
	const program = buildTspl(bitmap, { ...tspl, widthMm, heightMm, copies });
	if (flags.out) {
		await writeFile(flags.out, program);
		console.log(
			`Wrote ${program.length} bytes to ${flags.out} (${bitmap.width} x ${bitmap.height} dots, ${widthMm} x ${heightMm} mm). Nothing was sent to a printer.`,
		);
		return;
	}
	const device = findPrinter(printer);
	if (!device)
		fail("No printer found. Pass --device, or --usb-id with the id that lsusb shows.");
	try {
		await sendToPrinter(device, program);
	} catch (e) {
		fail(describeDeviceError(e));
	}
	console.log(`Sent ${program.length} bytes to ${device}.`);
}

main().catch((e) => fail(String(e?.message ?? e)));
