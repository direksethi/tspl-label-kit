import { hostname } from "node:os";
import { describeDeviceError, type FindOptions, findPrinter, sendToPrinter } from "./device.js";
import { jobBitmap, type PrintJob } from "./job.js";
import { buildTspl, type TsplOptions } from "./tspl.js";

/**
 * The print agent. It runs on the machine the printer is plugged into, asks
 * an HTTP queue for labels every couple of seconds and prints them. Nothing
 * listens here: the agent only makes outgoing requests, so the machine needs
 * no open port, public address or tunnel.
 *
 * The queue contract is two requests (see the README):
 *
 *   POST {queueUrl}/next?info=...   200 with a job, or 204 when there is none
 *   POST {queueUrl}/jobs/{id}       {"status":"printed"} or {"status":"failed","error":"..."}
 */
export interface AgentConfig {
	/** Base URL of the queue, without a trailing slash. */
	queueUrl: string;
	/** Sent as "Authorization: Bearer <token>". */
	token: string;
	printer?: FindOptions;
	/** Print settings applied to every job: gapMm, referenceX, shiftY, rotate. */
	tspl?: Pick<TsplOptions, "gapMm" | "referenceX" | "shiftY" | "rotate" | "direction">;
	pollMs?: number;
	/** Stop when the queue is empty instead of polling forever. */
	once?: boolean;
	signal?: AbortSignal;
	log?: (...args: unknown[]) => void;
	/** Replaceable for tests. */
	fetch?: typeof fetch;
	send?: (device: string, tspl: Uint8Array) => Promise<void>;
	sleep?: (ms: number) => Promise<void>;
}

const REQUEST_TIMEOUT_MS = 15_000;
const REPORT_ATTEMPTS = 5;

export async function runAgent(config: AgentConfig) {
	const queueUrl = config.queueUrl.replace(/\/+$/, "");
	const pollMs = Math.max(500, config.pollMs ?? 2000);
	const doFetch = config.fetch ?? fetch;
	const send = config.send ?? sendToPrinter;
	const sleep = config.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	const log = config.log ?? ((...args: unknown[]) => console.log(new Date().toISOString(), ...args));
	const stopped = () => config.signal?.aborted === true;

	const call = (path: string, init: RequestInit = {}) =>
		doFetch(`${queueUrl}${path}`, {
			...init,
			headers: {
				authorization: `Bearer ${config.token}`,
				"content-type": "application/json",
			},
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});

	// The label is already on paper (or already failed) by now, so the result
	// is retried a few times rather than lost to one dropped request.
	const report = async (id: string, body: { status: "printed" | "failed"; error?: string }) => {
		for (let i = 0; i < REPORT_ATTEMPTS; i++) {
			try {
				const res = await call(`/jobs/${encodeURIComponent(id)}`, {
					method: "POST",
					body: JSON.stringify(body),
				});
				if (res.ok) return true;
			} catch {}
			await sleep(2000);
		}
		log(`Could not report ${id} as ${body.status}`);
		return false;
	};

	log(`Label agent for ${queueUrl}, polling every ${pollMs} ms`);
	let lastProblem = "";
	let printed = 0;
	while (!stopped()) {
		// Looked up on every pass, so replugging the printer needs no restart.
		const device = findPrinter(config.printer);
		// Asking for work doubles as a heartbeat: the queue can show this line
		// to whoever is about to print, before they send a label nowhere.
		const info = `${hostname()} ${device ? `ready ${device}` : "printer not found"}`;
		let job: PrintJob | null = null;
		try {
			const res = await call(`/next?info=${encodeURIComponent(info)}`, { method: "POST" });
			if (res.status === 200) job = (await res.json()) as PrintJob;
			else if (res.status !== 204) throw new Error(`HTTP ${res.status}`);
			if (lastProblem) log("Connected again");
			lastProblem = "";
		} catch (e) {
			// Logged once per distinct problem, not once per poll.
			const problem = String((e as Error)?.message ?? e);
			if (problem !== lastProblem) log("Cannot reach the queue:", problem);
			lastProblem = problem;
			if (config.once) throw new Error(`Cannot reach the queue: ${problem}`);
			await sleep(pollMs * 3);
			continue;
		}
		if (!job) {
			if (config.once) break;
			await sleep(pollMs);
			continue;
		}
		try {
			if (!device) throw Object.assign(new Error("not connected"), { code: "ENODEV" });
			const tspl = buildTspl(jobBitmap(job), {
				...config.tspl,
				widthMm: job.width,
				heightMm: job.height,
				copies: job.copies,
			});
			await send(device, tspl);
			printed++;
			log(`Printed ${job.id} (${job.width}x${job.height} mm, ${job.copies}x)`);
			await report(job.id, { status: "printed" });
		} catch (e) {
			const error = describeDeviceError(e);
			log(`Failed ${job.id}:`, error);
			await report(job.id, { status: "failed", error });
		}
	}
	return { printed };
}
