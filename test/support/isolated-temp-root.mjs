import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const configuredTempRoot = process.env.PI_CCIOTTI_TEMP_ROOT?.trim();
const tempRoot = configuredTempRoot
	? path.resolve(configuredTempRoot)
	: fs.mkdtempSync(path.join(os.tmpdir(), "pi-cciotti-test-root-"));
process.env.PI_CCIOTTI_TEMP_ROOT = tempRoot;

const nestedTestProcess = process.env.PI_CCIOTTI_TEST_LOADER === "1";
const isolatedHome = path.join(tempRoot, "home");
process.env.HOME = isolatedHome;
process.env.USERPROFILE = isolatedHome;
if (!nestedTestProcess) delete process.env.PI_CODING_AGENT_DIR;
process.env.PI_CCIOTTI_TEST_LOADER = "1";

if (!configuredTempRoot) {
	process.on("exit", () => fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
}
