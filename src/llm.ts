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

// Tokens one call used, split the way they're billed.
export type Usage = { input: number; cache_write_5m: number; cache_write_1h: number; cache_read: number; output: number };
export type LlmResult<T> = { data: T; costUsd: number | null; usage: Usage; backend: "sdk" | "cli" };

// List prices, $ per million tokens (Anthropic API, as of 2026-10-06). Cache writes cost 1.25x input
// for the 5-minute TTL and 2x for the 1-hour TTL. Haiku's cache-read price isn't published in our
// source, so it assumes the usual 0.1x of input.
export const PRICES: Record<string, { input: number; cache_read: number; output: number }> = {
  "claude-opus-5-5": { input: 4, cache_read: 0.2, output: 20 },
  "claude-sonnet-5-5": { input: 2, cache_read: 0.2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, cache_read: 0.01, output: 0.5 },
};

export function priceUsage(u: Usage, model = MODEL): number | null {
  const p = PRICES[model];
  if (!p) return null;
  return (u.input * p.input + u.cache_write_5m * p.input * 1.25 + u.cache_write_1h * p.input * 2 + u.cache_read * p.cache_read + u.output * p.output) / 1e6;
}

type RawUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } | null;
};

function toUsage(u: RawUsage): Usage {
  const w5 = u.cache_creation?.ephemeral_5m_input_tokens ?? 0;
  const w1 = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  // Without the TTL split, count cache writes at the cheaper 5-minute rate.
  const unsplit = (u.cache_creation_input_tokens ?? 0) - w5 - w1;
  return { input: u.input_tokens, cache_write_5m: w5 + Math.max(unsplit, 0), cache_write_1h: w1, cache_read: u.cache_read_input_tokens ?? 0, output: u.output_tokens };
}

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
  const usage = toUsage(res.usage);
  return { data: res.parsed_output, costUsd: priceUsage(usage), usage, backend: "sdk" };
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
  return { data: schema.parse(res.structured_output), costUsd: res.total_cost_usd ?? null, usage: toUsage(res.usage), backend: "cli" };
}
