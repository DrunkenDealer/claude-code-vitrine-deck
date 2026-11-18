import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const CACHE_PATH = resolve(process.cwd(), ".headline-cache.json");

async function readCache() {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(await readFile(CACHE_PATH, "utf8"));
  } catch {
    return {};
  }
}

async function writeCache(cache) {
  await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));
}

export async function generateHeadline(description) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set — required for --headline-from-description"
    );
  }
  const cache = await readCache();
  if (cache[description]) return cache[description];

  let Anthropic;
  try {
    ({ default: Anthropic } = await import("@anthropic-ai/sdk"));
  } catch {
    throw new Error(
      "@anthropic-ai/sdk is not installed. Run: npm install @anthropic-ai/sdk"
    );
  }

  const client = new Anthropic();
  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 64,
    messages: [
      {
        role: "user",
        content: `Write one punchy app-store screenshot headline (3-6 words, no quotes, no period) for this app: ${description}`,
      },
    ],
  });
  const text = msg.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim()
    .replace(/^["']|["']$/g, "");

  cache[description] = text;
  await writeCache(cache);
  return text;
}
