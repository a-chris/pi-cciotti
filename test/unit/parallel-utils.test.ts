import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	mapConcurrent,
	DEFAULT_GLOBAL_CONCURRENCY_LIMIT,
	Semaphore,
} from "../../src/runs/shared/parallel-utils.ts";



describe("mapConcurrent", () => {
	it("processes all items and preserves order", async () => {
		const items = [10, 20, 30, 40];
		const results = await mapConcurrent(items, 2, async (item) => item * 2);
		assert.deepEqual(results, [20, 40, 60, 80]);
	});

	it("respects concurrency limit", async () => {
		let running = 0;
		let maxRunning = 0;
		const items = [1, 2, 3, 4, 5, 6];

		await mapConcurrent(items, 2, async () => {
			running++;
			maxRunning = Math.max(maxRunning, running);
			await new Promise((r) => setTimeout(r, 10));
			running--;
		});

		assert.ok(maxRunning <= 2, `max concurrent was ${maxRunning}, expected <= 2`);
	});

	it("handles empty input", async () => {
		const results = await mapConcurrent([], 4, async (item: number) => item);
		assert.deepEqual(results, []);
	});

	it("clamps limit=0 to 1 (sequential execution)", async () => {
		let running = 0;
		let maxRunning = 0;
		const items = [1, 2, 3];
		await mapConcurrent(items, 0, async (item) => {
			running++;
			maxRunning = Math.max(maxRunning, running);
			await new Promise((r) => setTimeout(r, 10));
			running--;
			return item * 10;
		});
		assert.equal(maxRunning, 1, "should run sequentially with limit=0");
	});

	it("clamps limit=-1 to 1 (sequential execution)", async () => {
		let running = 0;
		let maxRunning = 0;
		const items = [1, 2, 3];
		await mapConcurrent(items, -1, async (item) => {
			running++;
			maxRunning = Math.max(maxRunning, running);
			await new Promise((r) => setTimeout(r, 10));
			running--;
			return item * 10;
		});
		assert.equal(maxRunning, 1, "should run sequentially with limit=-1");
	});

	it("does not stagger by default", async () => {
		const startTimes: number[] = [];
		const items = [1, 2, 3];

		await mapConcurrent(items, 3, async (_item, i) => {
			startTimes[i] = Date.now();
			await new Promise((r) => setTimeout(r, 10));
		});

		// All workers should start nearly simultaneously
		const d1 = startTimes[1]! - startTimes[0]!;
		const d2 = startTimes[2]! - startTimes[0]!;
		assert.ok(d1 < 20, `worker 1 should start immediately, got ${d1}ms delay`);
		assert.ok(d2 < 20, `worker 2 should start immediately, got ${d2}ms delay`);
	});

	it("notifies scheduling settlement only after workers outliving an early rejection stop", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const started: number[] = [];
		let schedulingSettled = false;
		const run = mapConcurrent([0, 1, 2], 2, async (item) => {
			started.push(item);
			if (item === 0) throw new Error("early rejection");
			await gate;
			return item;
		}, undefined, () => { schedulingSettled = true; });

		await assert.rejects(run, /early rejection/);
		assert.equal(schedulingSettled, false);
		release();
		for (let attempt = 0; attempt < 20 && !schedulingSettled; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		assert.equal(schedulingSettled, true);
		assert.deepEqual(started, [0, 1, 2]);
	});

	it("respects a shared global semaphore across simultaneous calls", async () => {
		const globalSemaphore = new Semaphore(2);
		let running = 0;
		let maxRunning = 0;
		const run = (items: number[]) => mapConcurrent(items, items.length, async (item) => {
			running++;
			maxRunning = Math.max(maxRunning, running);
			await new Promise((r) => setTimeout(r, 10));
			running--;
			return item;
		}, globalSemaphore);

		const results = await Promise.all([
			run([1, 2, 3]),
			run([4, 5, 6]),
		]);

		assert.deepEqual(results, [[1, 2, 3], [4, 5, 6]]);
		assert.ok(maxRunning <= 2, `max concurrent was ${maxRunning}, expected <= 2`);
	});

	it("clamps invalid global semaphore limits to 1", async () => {
		const globalSemaphore = new Semaphore(0);
		let running = 0;
		let maxRunning = 0;

		await mapConcurrent([1, 2, 3], 3, async (item) => {
			running++;
			maxRunning = Math.max(maxRunning, running);
			await new Promise((r) => setTimeout(r, 10));
			running--;
			return item;
		}, globalSemaphore);

		assert.equal(maxRunning, 1);
	});
});

describe("DEFAULT_GLOBAL_CONCURRENCY_LIMIT", () => {
	it("is 20", () => {
		assert.equal(DEFAULT_GLOBAL_CONCURRENCY_LIMIT, 20);
	});
});


