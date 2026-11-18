#!/usr/bin/env node
/**
 * A reference print queue, held in memory, with no dependencies. It shows
 * the whole contract the agent expects and is enough to try the kit end to
 * end. A real application would keep the jobs in its database and put the
 * "add a job" route behind its own sign-in.
 *
 *   LABEL_QUEUE_TOKEN=change-me node examples/queue-server.mjs
 *
 * Routes (all need "Authorization: Bearer <token>"):
 *   POST /jobs            add a job: {width, height, dotsW, dotsH, copies, data}
 *   GET  /jobs/:id        its status: queued, printing, printed or failed
 *   GET  /printer         whether the agent has asked for work lately
 *   POST /next            agent: the next job, or 204
 *   POST /jobs/:id        agent: {status: "printed"} or {status: "failed", error}
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const TOKEN = process.env.LABEL_QUEUE_TOKEN;
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";
if (!TOKEN) {
	console.error("LABEL_QUEUE_TOKEN is not set.");
	process.exit(1);
}

/** The agent asks every few seconds; quieter than this and it counts as offline. */
const ONLINE_MS = 20_000;
/** A job the agent took but never reported on is given up after this. */
const STUCK_MS = 2 * 60_000;
const MAX_COPIES = 50;

const jobs = new Map();
const agent = { lastSeen: null, info: null };

const send = (res, status, body) => {
	res.writeHead(status, body === undefined ? {} : { "content-type": "application/json" });
	res.end(body === undefined ? undefined : JSON.stringify(body));
};

const readJson = async (req) => {
	const chunks = [];
	for await (const chunk of req) chunks.push(chunk);
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
	} catch {
		return {};
	}
};

const publicJob = (j) => ({ id: j.id, status: j.status, error: j.error, copies: j.copies });

createServer(async (req, res) => {
	const url = new URL(req.url, "http://queue");
	if (req.headers.authorization !== `Bearer ${TOKEN}`)
		return send(res, 401, { error: "Not allowed." });
	const now = Date.now();
	const jobPath = url.pathname.match(/^\/jobs\/([^/]+)$/);

	if (req.method === "POST" && url.pathname === "/jobs") {
		const body = await readJson(req);
		const dotsW = Math.round(Number(body.dotsW));
		const dotsH = Math.round(Number(body.dotsH));
		const data = typeof body.data === "string" ? body.data : "";
		// The bitmap must be exactly ceil(dotsW / 8) * dotsH bytes once decoded.
		const bytes = Buffer.from(data, "base64").length;
		if (
			!(body.width > 0) ||
			!(body.height > 0) ||
			!/^[A-Za-z0-9+/]+=*$/.test(data) ||
			bytes !== Math.ceil(dotsW / 8) * dotsH
		)
			return send(res, 400, { error: "The label could not be prepared for the printer." });
		const job = {
			id: randomUUID(),
			width: body.width,
			height: body.height,
			dotsW,
			dotsH,
			copies: Math.min(MAX_COPIES, Math.max(1, Math.round(Number(body.copies) || 1))),
			data,
			status: "queued",
			error: null,
			createdAt: now,
			claimedAt: null,
		};
		jobs.set(job.id, job);
		return send(res, 201, { job: publicJob(job) });
	}

	if (req.method === "GET" && jobPath) {
		const job = jobs.get(jobPath[1]);
		return job ? send(res, 200, { job: publicJob(job) }) : send(res, 404, { error: "Not found." });
	}

	if (req.method === "GET" && url.pathname === "/printer") {
		return send(res, 200, {
			online: agent.lastSeen !== null && now - agent.lastSeen < ONLINE_MS,
			lastSeen: agent.lastSeen,
			info: agent.info,
		});
	}

	// The next label to print, or 204. Asking is also how the agent shows it is online.
	if (req.method === "POST" && url.pathname === "/next") {
		agent.lastSeen = now;
		agent.info = (url.searchParams.get("info") ?? "").slice(0, 200) || null;
		for (const job of jobs.values()) {
			if (job.status === "printing" && job.claimedAt < now - STUCK_MS) {
				job.status = "failed";
				job.error = "The printer did not confirm this label.";
				job.data = "";
			}
		}
		// A Map keeps insertion order, so the first queued job is the oldest.
		const job = [...jobs.values()].find((j) => j.status === "queued");
		if (!job) return send(res, 204);
		job.status = "printing";
		job.claimedAt = now;
		const { id, width, height, dotsW, dotsH, copies, data } = job;
		return send(res, 200, { id, width, height, dotsW, dotsH, copies, data });
	}

	if (req.method === "POST" && jobPath) {
		const body = await readJson(req);
		const job = jobs.get(jobPath[1]);
		if (job && job.status === "printing") {
			const ok = body.status === "printed";
			job.status = ok ? "printed" : "failed";
			job.error = ok ? null : String(body.error ?? "The printer reported a problem.").slice(0, 300);
			// The bitmap is no longer needed once the job is settled.
			job.data = "";
		}
		return send(res, 200, { ok: true });
	}

	return send(res, 404, { error: "Not found." });
}).listen(PORT, HOST, () => {
	console.log(`Label queue listening on http://${HOST}:${PORT}`);
});
