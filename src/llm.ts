// One structured-output call to Claude, two transports:
//   - ANTHROPIC_API_KEY set: the Anthropic SDK (what production would use).
//   - otherwise: the local `claude` CLI in headless mode, using the developer's login.
// Both return the same parsed object, so the agent and eval don't care which ran.

import { spawn } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export const MODEL = process.env.MATCHER_MODEL ?? "claude-opus-5-5";
const EFFORT = (process.env.MATCHER_EFFORT ?? "medium") as "low" | "medium" | "high";

export type LlmResult<T> = { data: T; costUsd: number | null; backend: "sdk" | "cli" };

export const backend = (): "sdk" | "cli" => (process.env.ANTHROPIC_API_KEY ? "sdk" : "cli");

export async function structured<S extends z.ZodType>(system: string, user: string, schema: S): Promise<LlmResult<z.infer<S>>> {
  return backend() === "sdk" ? viaSdk(system, user, schema) : viaCli(system, user, schema);
}

let client: Anthropic | undefined;

async function viaSdk<S extends z.ZodType>(system: string, user: string, schema: S): Promise<LlmResult<z.infer<S>>> {
  client ??= new Anthropic();
  const res = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { effort: EFFORT, format: betaZodOutputFormat(schema) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  if (res.stop_reason === "refusal") throw new Error(`refusal: ${res.stop_details?.category ?? "unknown"}`);
  if (!res.parsed_output) throw new Error(`no parsed output (stop_reason=${res.stop_reason})`);
  return { data: res.parsed_output, costUsd: null, backend: "sdk" };
}

async function viaCli<S extends z.ZodType>(system: string, user: string, schema: S): Promise<LlmResult<z.infer<S>>> {
  // Strip everything Claude Code would otherwise load (MCP servers, plugins, skills,
  // settings). Without this, each call carries ~480K tokens of unrelated context.
  const args = [
    "-p",
    "--model", MODEL,
    "--effort", EFFORT,
    "--tools", "",
    "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--setting-sources", "",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--output-format", "json",
    "--system-prompt", system,
    "--json-schema", JSON.stringify(z.toJSONSchema(schema, { target: "draft-7" })),
  ];
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(`claude exited ${code}: ${stderr.slice(0, 500)}`))));
    child.stdin.end(user);
  });
  const res = JSON.parse(out);
  if (res.is_error || !res.structured_output) throw new Error(`cli error: ${String(res.result).slice(0, 300)}`);
  return { data: schema.parse(res.structured_output), costUsd: res.total_cost_usd ?? null, backend: "cli" };
}
