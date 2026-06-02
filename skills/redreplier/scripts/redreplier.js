#!/usr/bin/env node
/**
 * RedReplier Agent Skill CLI
 * A zero-dependency Node.js script for Reddit, Hacker News, X, and Bluesky keyword monitoring via the RedReplier API.
 *
 * MIT Licensed — https://github.com/redreplier/agent
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

const API_BASE = "https://ai.redreplier.com/ai-app";
const CONFIG_DIR = path.join(os.homedir(), ".config", "redreplier");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const LOCAL_CONFIG = path.join(process.cwd(), ".redreplier", "config.json");

// ── Config ──────────────────────────────────────────────────────────────────

function getApiKey() {
  if (process.env.REDREPLIER_API_KEY) return process.env.REDREPLIER_API_KEY;
  if (fs.existsSync(LOCAL_CONFIG)) {
    try {
      return JSON.parse(fs.readFileSync(LOCAL_CONFIG, "utf8")).apiKey;
    } catch {}
  }
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")).apiKey;
    } catch {}
  }
  return null;
}

function saveApiKey(key, global = true) {
  const dir = global ? CONFIG_DIR : path.join(process.cwd(), ".redreplier");
  const file = global ? CONFIG_FILE : LOCAL_CONFIG;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ apiKey: key }, null, 2));
}

// ── HTTP ────────────────────────────────────────────────────────────────────

async function request(method, endpoint, body = null) {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(
      "No API key found. Run: ./scripts/redreplier.js setup --key redreplier_xxxxx",
    );
    error("Get your API key at: https://redreplier.com/api-tokens");
    process.exit(1);
  }
  const url = `${API_BASE}${endpoint}`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : { ok: true };
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    error(`API error (${res.status}): ${JSON.stringify(data)}`);
    process.exit(1);
  }
  return data;
}

// ── Output ──────────────────────────────────────────────────────────────────

function output(data) {
  console.log(JSON.stringify(data, null, 2));
}

function error(msg) {
  console.error(`\x1b[31mError:\x1b[0m ${msg}`);
}

function info(msg) {
  console.error(`\x1b[36mInfo:\x1b[0m ${msg}`);
}

// ── Arg parsing ─────────────────────────────────────────────────────────────

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        parsed[key] = true;
      } else {
        parsed[key] = next;
        i++;
      }
    }
  }
  return parsed;
}

function appendCsv(params, key, value) {
  if (!value) return;
  String(value)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .forEach((v) => params.append(key, v));
}

// ── Commands ────────────────────────────────────────────────────────────────

const COMMANDS = {
  setup: async (args) => {
    const parsed = parseArgs(args);
    const key = parsed.key || parsed["api-key"];
    if (!key) {
      error("Usage: ./scripts/redreplier.js setup --key redreplier_xxxxx");
      error("Get your API key at: https://redreplier.com/api-tokens");
      process.exit(1);
    }
    const global = !parsed.local;
    saveApiKey(key, global);
    info(`API key saved ${global ? "globally" : "locally"}.`);
    output({ status: "configured", location: global ? "global" : "local" });
  },

  // ── Websites ──────────────────────────────────────────────────────────────

  websites: async () => {
    output(await request("GET", "/api/v1/websites"));
  },

  "websites:get": async (args) => {
    const parsed = parseArgs(args);
    if (!parsed.id) {
      error("Usage: ./scripts/redreplier.js websites:get --id <website_id>");
      process.exit(1);
    }
    output(await request("GET", `/api/v1/websites/${parsed.id}`));
  },

  "websites:create": async (args) => {
    const parsed = parseArgs(args);
    if (!parsed.url) {
      error(
        'Usage: ./scripts/redreplier.js websites:create --url "https://example.com" [--name "Name"] [--keywords a,b,c] [--description "..."]',
      );
      process.exit(1);
    }
    const body = { url: parsed.url };
    if (parsed.name) body.name = parsed.name;
    if (parsed.description) body.description = parsed.description;
    if (parsed.keywords)
      body.keywords = parsed.keywords.split(",").map((k) => k.trim()).filter(Boolean);
    output(await request("POST", "/api/v1/websites", body));
  },

  "websites:update": async (args) => {
    const parsed = parseArgs(args);
    if (!parsed.id) {
      error(
        'Usage: ./scripts/redreplier.js websites:update --id <website_id> [--name "..."] [--description "..."]',
      );
      process.exit(1);
    }
    const body = {};
    if (parsed.name) body.name = parsed.name;
    if (parsed.description) body.description = parsed.description;
    output(await request("PATCH", `/api/v1/websites/${parsed.id}`, body));
  },

  "websites:delete": async (args) => {
    const parsed = parseArgs(args);
    if (!parsed.id) {
      error("Usage: ./scripts/redreplier.js websites:delete --id <website_id>");
      process.exit(1);
    }
    output(await request("DELETE", `/api/v1/websites/${parsed.id}`));
  },

  "websites:analyze": async (args) => {
    const parsed = parseArgs(args);
    if (!parsed.url) {
      error('Usage: ./scripts/redreplier.js websites:analyze --url "https://example.com"');
      process.exit(1);
    }
    output(
      await request("POST", "/api/v1/websites/analyze-description", {
        url: parsed.url,
      }),
    );
  },

  // ── Keywords ────────────────────────────────────────────────────────────

  "keywords:add": async (args) => {
    const parsed = parseArgs(args);
    if (!parsed.website || !parsed.keywords) {
      error(
        'Usage: ./scripts/redreplier.js keywords:add --website <website_id> --keywords "my product,competitor"',
      );
      process.exit(1);
    }
    const keywords = parsed.keywords.split(",").map((k) => k.trim()).filter(Boolean);
    output(
      await request("POST", `/api/v1/websites/${parsed.website}/keywords`, {
        keywords,
      }),
    );
  },

  "keywords:edit": async (args) => {
    const parsed = parseArgs(args);
    if (!parsed.id || !parsed.value) {
      error(
        'Usage: ./scripts/redreplier.js keywords:edit --id <keyword_id> --value "new keyword"',
      );
      process.exit(1);
    }
    output(
      await request("PATCH", `/api/v1/keywords/${parsed.id}`, {
        value: parsed.value,
      }),
    );
  },

  "keywords:disable": async (args) => {
    const parsed = parseArgs(args);
    if (!parsed.id) {
      error("Usage: ./scripts/redreplier.js keywords:disable --id <keyword_id>");
      process.exit(1);
    }
    output(await request("POST", `/api/v1/keywords/${parsed.id}/disable`));
  },

  "keywords:enable": async (args) => {
    const parsed = parseArgs(args);
    if (!parsed.id) {
      error("Usage: ./scripts/redreplier.js keywords:enable --id <keyword_id>");
      process.exit(1);
    }
    output(await request("POST", `/api/v1/keywords/${parsed.id}/enable`));
  },

  "keywords:delete": async (args) => {
    const parsed = parseArgs(args);
    if (!parsed.id) {
      error("Usage: ./scripts/redreplier.js keywords:delete --id <keyword_id>");
      process.exit(1);
    }
    output(await request("DELETE", `/api/v1/keywords/${parsed.id}`));
  },

  "keywords:activate": async () => {
    output(await request("POST", "/api/v1/keywords/activate-pending"));
  },

  "keywords:activate-preview": async () => {
    output(await request("GET", "/api/v1/keywords/activate-pending/preview"));
  },

  "keywords:billing-preview": async (args) => {
    const parsed = parseArgs(args);
    const count = parsed.count ?? parsed.keywords;
    if (count === undefined) {
      error(
        "Usage: ./scripts/redreplier.js keywords:billing-preview --count <desiredKeywordCount>",
      );
      process.exit(1);
    }
    output(
      await request(
        "GET",
        `/api/v1/keywords/billing-preview?desiredKeywordCount=${encodeURIComponent(count)}`,
      ),
    );
  },

  "keywords:usage": async () => {
    output(await request("GET", "/api/v1/keywords/change-usage"));
  },

  // ── Mentions ────────────────────────────────────────────────────────────

  mentions: async (args) => {
    const parsed = parseArgs(args);
    const params = new URLSearchParams();
    if (parsed.website) params.set("websiteId", parsed.website);
    appendCsv(params, "statuses", parsed.status);
    appendCsv(params, "scoreBuckets", parsed.buckets);
    appendCsv(params, "keywords", parsed.keywords);
    appendCsv(params, "sources", parsed.sources);
    if (parsed.sort) params.set("sort", parsed.sort);
    if (parsed["include-low"]) params.set("includeLowRelevance", "true");
    if (parsed.from) params.set("from", parsed.from);
    if (parsed.to) params.set("to", parsed.to);
    if (parsed.limit) params.set("limit", parsed.limit);
    if (parsed.offset) params.set("offset", parsed.offset);
    const qs = params.toString();
    output(await request("GET", `/api/v1/mentions${qs ? `?${qs}` : ""}`));
  },

  "mentions:count": async (args) => {
    const parsed = parseArgs(args);
    const params = new URLSearchParams();
    if (parsed.website) params.set("websiteId", parsed.website);
    appendCsv(params, "statuses", parsed.status);
    appendCsv(params, "scoreBuckets", parsed.buckets);
    appendCsv(params, "keywords", parsed.keywords);
    appendCsv(params, "sources", parsed.sources);
    if (parsed["include-low"]) params.set("includeLowRelevance", "true");
    if (parsed.from) params.set("from", parsed.from);
    if (parsed.to) params.set("to", parsed.to);
    const qs = params.toString();
    output(await request("GET", `/api/v1/mentions/count${qs ? `?${qs}` : ""}`));
  },

  "mentions:status": async (args) => {
    const parsed = parseArgs(args);
    if (!parsed.id || !parsed.status) {
      error(
        "Usage: ./scripts/redreplier.js mentions:status --id <mention_id> --status APPROVED|REJECTED|NEW",
      );
      process.exit(1);
    }
    output(
      await request("PATCH", `/api/v1/mentions/${parsed.id}/status`, {
        status: parsed.status,
      }),
    );
  },

  "mentions:explain": async (args) => {
    const parsed = parseArgs(args);
    if (!parsed.id) {
      error("Usage: ./scripts/redreplier.js mentions:explain --id <mention_id>");
      process.exit(1);
    }
    output(await request("POST", `/api/v1/mentions/${parsed.id}/explain`));
  },

  // ── Alert settings ────────────────────────────────────────────────────────

  alerts: async () => {
    output(await request("GET", "/api/v1/alert-settings"));
  },

  "alerts:update": async (args) => {
    const parsed = parseArgs(args);
    if (parsed.enabled === undefined) {
      error(
        "Usage: ./scripts/redreplier.js alerts:update --enabled true|false [--cadence 60|240|720|1440]",
      );
      process.exit(1);
    }
    const body = { enabled: parsed.enabled === true || parsed.enabled === "true" };
    if (parsed.cadence) body.cadenceMinutes = parseInt(parsed.cadence, 10);
    output(await request("PUT", "/api/v1/alert-settings", body));
  },

  help: async () => {
    output({
      name: "RedReplier Agent Skill",
      version: "1.0.0",
      commands: Object.keys(COMMANDS).filter((c) => c !== "help"),
      docs: "https://redreplier.com",
      api_tokens: "https://redreplier.com/api-tokens",
    });
  },
};

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const command = process.argv[2] || "help";
  const args = process.argv.slice(3);

  if (!COMMANDS[command]) {
    error(`Unknown command: ${command}`);
    error(`Available: ${Object.keys(COMMANDS).join(", ")}`);
    process.exit(1);
  }

  try {
    await COMMANDS[command](args);
  } catch (err) {
    error(err.message);
    process.exit(1);
  }
}

main();
