import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { SUBAGENT_DELEGATION_DESCRIPTION } from "../../src/extension/tool-description.ts";
import { PARENT_WAIT_ESCAPE_HATCH } from "../../src/runs/background/wait-tool.ts";
import { SUBAGENT_CHILD_ENV } from "../../src/runs/shared/child-runtime-config.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

interface PreparedLoadout {
  hiddenDeclarations?: readonly string[];
  descriptions?: Record<string, string>;
}

interface RegisteredShape {
  name: string;
  description: string;
}

/**
 * Register the extension against a stub pi in a child process and report what the
 * `subagent` loadout hook returns, plus the names that stayed registered.
 *
 * The hook is what makes the surface smaller without disabling anything, so the
 * assertion needs the real registered object: a hand-built ToolDefinition would
 * prove the shape of the return value but not that the shipped tool carries it.
 */
function loadPreparedLoadout(env: Record<string, string>): { prepared: PreparedLoadout | null; registered: RegisteredShape[] } {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cciotti-loadout-"));
  const script = `
    import registerSubagentExtension from "./src/extension/index.ts";
    const registered = [];
    const fakePi = new Proxy({
      events: { on() { return () => {}; }, emit() {} },
      registerTool(tool) { registered.push({ name: tool.name, description: tool.description, prepared: tool.prepareLoadout ? tool.prepareLoadout({ declared: [], callable: [], registered: [], getExposure: () => "direct", getNamespace: () => undefined, getPromptGuidelines: () => [] }) : null }); },
    }, {
      get(target, prop) {
        if (prop in target) return target[prop];
        return () => undefined;
      },
    });
    registerSubagentExtension(fakePi);
    const delegation = registered.find((tool) => tool.name === "subagent");
    process.stdout.write(JSON.stringify({
      prepared: delegation ? delegation.prepared : null,
      registered: registered.map((tool) => ({ name: tool.name, description: tool.description })),
    }));
  `;
  try {
    const output = execFileSync(
      process.execPath,
      ["--experimental-strip-types", "--import", "./test/support/register-loader.mjs", "--input-type=module", "--eval", script],
      {
        cwd: projectRoot,
        env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, ...env },
        encoding: "utf-8",
      },
    );
    // SAFETY: the inline script writes exactly one JSON object of this shape.
    return JSON.parse(output) as { prepared: PreparedLoadout | null; registered: RegisteredShape[] };
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
}

function parentEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  delete env[SUBAGENT_CHILD_ENV];
  return env;
}

describe("subagent prepareLoadout", { timeout: 120000 }, () => {
  it("hides the bg_wait declaration and folds its escape hatch in when the wait tool is enabled", () => {
    const { prepared, registered } = loadPreparedLoadout(parentEnv());
    assert.ok(prepared, "subagent must carry a prepareLoadout hook");
    assert.deepEqual(prepared.hiddenDeclarations, ["bg_wait"]);
    assert.equal(
      prepared.descriptions?.subagent,
      `${SUBAGENT_DELEGATION_DESCRIPTION}\n\n${PARENT_WAIT_ESCAPE_HATCH}`,
      "hiding bg_wait must keep its parent-only guardrail readable on subagent",
    );
    // The guardrail stays stated once across what the model actually reads.
    const matches = (prepared.descriptions?.subagent ?? "").match(/already notify this session natively/gi) ?? [];
    assert.equal(matches.length, 1, "escape hatch must not be restated");
    assert.ok(
      registered.some((tool) => tool.name === "bg_wait"),
      "hidden declarations stay registered and callable",
    );
  });

  it("hides nothing when the wait tool is disabled", () => {
    const { prepared } = loadPreparedLoadout({ ...parentEnv(), PI_SUBAGENT_WAIT_TOOL_ENABLED: "0" });
    assert.ok(prepared, "subagent must keep its hook when bg_wait is disabled");
    assert.deepEqual(prepared.hiddenDeclarations, []);
    assert.equal(prepared.descriptions, undefined);
  });
});
