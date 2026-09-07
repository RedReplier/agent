#!/usr/bin/env bun

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { createServer, type IncomingMessage } from 'node:http';

import { RestClient } from './rest-client.js';
import {
  oauthConfigFromEnv,
  handleProtectedResourceMetadata,
  sendUnauthorized,
  looksLikeJwt,
  verifyOauthJwt,
} from './oauth.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const isHttpMode = process.argv.includes('--http');
const HTTP_PORT = parseInt(process.env.PORT ?? '3100', 10);

const API_BASE_URL =
  process.env.REDREPLIER_API_URL ?? 'https://ai.redreplier.com/ai-app/api/v1';
const API_TOKEN = process.env.REDREPLIER_API_TOKEN ?? '';

if (!API_TOKEN && !isHttpMode) {
  console.error(
    'Error: REDREPLIER_API_TOKEN environment variable is required.\n' +
      'Create one at https://redreplier.com/api-tokens',
  );
  process.exit(1);
}

const api = new RestClient(API_BASE_URL, API_TOKEN);

const oauthConfig = oauthConfigFromEnv({
  resourceUrl: 'https://mcp.redreplier.com/mcp',
  resourceName: 'RedReplier',
});

// ---------------------------------------------------------------------------
// Shared enums (mirror the back-end Prisma enums)
// ---------------------------------------------------------------------------

const MentionStatus = z.enum(['NEW', 'APPROVED', 'REJECTED']);
const MentionSource = z.enum([
  'REDDIT_POST',
  'REDDIT_COMMENT',
  'TWITTER',
  'BLUESKY',
  'HACKERNEWS',
]);
const RelevanceBucket = z.enum([
  'VERY_LOW',
  'LOW',
  'MEDIUM',
  'HIGH',
  'VERY_HIGH',
]);
const MentionSort = z.enum(['RELEVANCE', 'RECENT']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const resultSchema = (description: string) => ({
  result: z.unknown().describe(description),
});

function toolResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data ?? null, null, 2) }],
    structuredContent: { result: data ?? null },
  };
}

function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text' as const, text: `Error: ${message}` }],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// MCP Server – tool registration
// ---------------------------------------------------------------------------

function createMcpServer(apiClient?: RestClient): McpServer {
  const client = apiClient ?? api;
  const server = new McpServer({
    name: 'redreplier',
    version: '1.0.0',
  });

  // ── Websites ────────────────────────────────────────────────────────────

  server.registerTool(
    'list_websites',
    {
      title: 'List Monitored Websites',
      description:
        'List all monitored websites for this account, each with its keywords (value + status: PENDING, ACTIVE, DISABLED, SUSPENDED). Start here — you need website IDs and keyword IDs for most other tools.',
      inputSchema: {},
      outputSchema: resultSchema(
        'Array of monitored websites, each with its ID, URL, name, description, and keywords with their statuses.',
      ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        return toolResult(await client.get('/websites'));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'get_website',
    {
      title: 'Get Monitored Website',
      description:
        'Get a single monitored website by ID, including all of its keywords and their statuses.',
      inputSchema: {
        websiteId: z.string().describe('Monitored website ID (UUID)'),
      },
      outputSchema: resultSchema(
        'The monitored website with its keywords and their statuses.',
      ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ websiteId }) => {
      try {
        return toolResult(await client.get(`/websites/${websiteId}`));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'create_website',
    {
      title: 'Add Website to Monitor',
      description:
        'Add a website to monitor across Reddit, Hacker News, X, and Bluesky. Keywords start as PENDING and only go live (ACTIVE) once they fit the plan — call activate_pending_keywords afterwards. The first website for an account also seeds keywords from the shared feed. If you omit description, the back-end scrapes and AI-generates one.',
      inputSchema: {
        url: z.string().describe('Full website URL (e.g. "https://example.com")'),
        name: z.string().optional().describe('Display name for the website'),
        keywords: z
          .array(z.string().max(255))
          .optional()
          .describe('Initial keywords to monitor (added as PENDING)'),
        description: z
          .string()
          .max(5000)
          .optional()
          .describe(
            'Manual description (skips scraping/AI). Used as context when scoring mention relevance',
          ),
      },
      outputSchema: resultSchema(
        'The created website record with its description and initial keywords with their statuses.',
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        return toolResult(await client.post('/websites', input));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'update_website',
    {
      title: 'Update Monitored Website',
      description:
        "Update a monitored website's display name or description. The description feeds the AI relevance scoring, so keep it accurate.",
      inputSchema: {
        websiteId: z.string().describe('Monitored website ID (UUID)'),
        name: z.string().optional().describe('New display name'),
        description: z
          .string()
          .max(5000)
          .optional()
          .describe('New description (used for relevance scoring)'),
      },
      outputSchema: resultSchema(
        'The updated website record with its new name and description.',
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ websiteId, ...body }) => {
      try {
        return toolResult(await client.patch(`/websites/${websiteId}`, body));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'delete_website',
    {
      title: 'Stop Monitoring Website',
      description:
        'Stop monitoring a website (soft delete). Its keywords stop matching new mentions.',
      inputSchema: {
        websiteId: z.string().describe('Monitored website ID (UUID)'),
      },
      outputSchema: resultSchema('Confirmation that the website was deleted.'),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ websiteId }) => {
      try {
        return toolResult(await client.delete(`/websites/${websiteId}`));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'analyze_website',
    {
      title: 'Analyze Website',
      description:
        'Scrape a URL and generate an AI description of the business — useful to preview/seed the description before creating a website. Consumes AI quota.',
      inputSchema: {
        url: z.string().describe('Website URL to analyze'),
      },
      outputSchema: resultSchema(
        'The AI-generated business description for the analyzed URL.',
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ url }) => {
      try {
        return toolResult(
          await client.post('/websites/analyze-description', { url }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  // ── Keywords ──────────────────────────────────────────────────────────────

  server.registerTool(
    'add_keywords',
    {
      title: 'Add Keywords',
      description:
        'Add keywords to a website. New keywords are added as PENDING, then any that fit the plan are promoted to ACTIVE automatically. Keywords beyond the plan stay PENDING until activate_pending_keywords (which may require a plan upgrade).',
      inputSchema: {
        websiteId: z.string().describe('Monitored website ID (UUID)'),
        keywords: z
          .array(z.string().max(255))
          .min(1)
          .describe('Keywords to add (e.g. ["my product", "competitor name"])'),
      },
      outputSchema: resultSchema(
        'The added keywords with their IDs and resulting statuses (ACTIVE or PENDING).',
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ websiteId, keywords }) => {
      try {
        return toolResult(
          await client.post(`/websites/${websiteId}/keywords`, { keywords }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'edit_keyword',
    {
      title: 'Edit Keyword',
      description:
        "Change a keyword's text. Editing a grader-suspended keyword is free; editing a live keyword counts against the monthly change allowance (see keyword_change_usage). The new value is re-graded and keeps any paid slot it already held.",
      inputSchema: {
        keywordId: z.string().describe('Keyword ID (UUID)'),
        value: z.string().max(255).describe('New keyword text'),
      },
      outputSchema: resultSchema(
        'The updated keyword with its new value and status.',
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ keywordId, value }) => {
      try {
        return toolResult(await client.patch(`/keywords/${keywordId}`, { value }));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'disable_keyword',
    {
      title: 'Disable Keyword',
      description:
        'Stop monitoring a keyword (sets it DISABLED). Disabling is unlimited and immediate; any price reduction is applied at the end of the billing cycle.',
      inputSchema: {
        keywordId: z.string().describe('Keyword ID (UUID)'),
      },
      outputSchema: resultSchema('The keyword with its status set to DISABLED.'),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ keywordId }) => {
      try {
        return toolResult(await client.post(`/keywords/${keywordId}/disable`));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'enable_keyword',
    {
      title: 'Enable Keyword',
      description:
        'Re-activate a disabled keyword. If it fits the current plan it goes ACTIVE immediately; otherwise it becomes PENDING and an upgrade is required.',
      inputSchema: {
        keywordId: z.string().describe('Keyword ID (UUID)'),
      },
      outputSchema: resultSchema(
        'The keyword with its resulting status (ACTIVE or PENDING).',
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ keywordId }) => {
      try {
        return toolResult(await client.post(`/keywords/${keywordId}/enable`));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'delete_keyword',
    {
      title: 'Delete Keyword',
      description:
        'Permanently delete a keyword. Only PENDING keywords can be deleted — disable ACTIVE keywords and edit SUSPENDED ones instead.',
      inputSchema: {
        keywordId: z.string().describe('Keyword ID (UUID)'),
      },
      outputSchema: resultSchema('Confirmation that the keyword was deleted.'),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ keywordId }) => {
      try {
        return toolResult(await client.delete(`/keywords/${keywordId}`));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'activate_pending_keywords',
    {
      title: 'Activate Pending Keywords',
      description:
        'Activate PENDING keywords. Promotes everything that fits the current plan for free; if more keywords remain pending it charges the upgrade needed to cover them. Returns the updated websites. Use preview_activate_pending first to see the cost.',
      inputSchema: {},
      outputSchema: resultSchema(
        'The updated websites reflecting the newly activated keyword statuses.',
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        return toolResult(await client.post('/keywords/activate-pending'));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'preview_activate_pending',
    {
      title: 'Preview Pending Keyword Activation',
      description:
        'Preview the billing impact of activating all currently pending keywords (current vs target plan, prorated immediate charge) without making any change.',
      inputSchema: {},
      outputSchema: resultSchema(
        'Billing preview with the current plan, target plan, and prorated immediate charge.',
      ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        return toolResult(await client.get('/keywords/activate-pending/preview'));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'preview_keyword_billing',
    {
      title: 'Preview Keyword Billing',
      description:
        'Preview the plan and price required for a desired number of active keywords, without changing anything.',
      inputSchema: {
        desiredKeywordCount: z
          .number()
          .int()
          .min(0)
          .describe('Total number of active keywords you want'),
      },
      outputSchema: resultSchema(
        'The plan and price required for the desired number of active keywords.',
      ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ desiredKeywordCount }) => {
      try {
        return toolResult(
          await client.get('/keywords/billing-preview', { desiredKeywordCount }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'keyword_change_usage',
    {
      title: 'Get Keyword Edit Allowance',
      description:
        'Get the current monthly keyword-EDIT allowance and how much is used (limit -1 means unlimited). Adding and disabling keywords are unlimited; only edits count.',
      inputSchema: {},
      outputSchema: resultSchema(
        'The monthly keyword-edit allowance limit and the amount used.',
      ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        return toolResult(await client.get('/keywords/change-usage'));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  // ── Mentions ────────────────────────────────────────────────────────────

  server.registerTool(
    'list_mentions',
    {
      title: 'List Mentions',
      description:
        'List mentions matched for this account across Reddit, Hacker News, X, and Bluesky, AI-scored for relevance (0-100). By default REJECTED mentions are excluded and anything scoring below 30 is hidden — set includeLowRelevance to see everything. Filter by website, status, score bucket, keyword, source, and ingestion date.',
      inputSchema: {
        websiteId: z.string().optional().describe('Filter to one website (UUID)'),
        statuses: z
          .array(MentionStatus)
          .optional()
          .describe('Filter by status (NEW, APPROVED, REJECTED)'),
        scoreBuckets: z
          .array(RelevanceBucket)
          .optional()
          .describe(
            'Relevance buckets: VERY_LOW (<10), LOW (10-29), MEDIUM (30-49), HIGH (50-74), VERY_HIGH (75+)',
          ),
        includeLowRelevance: z
          .boolean()
          .optional()
          .describe('Include mentions scoring below 30 (hidden by default)'),
        keywords: z
          .array(z.string())
          .optional()
          .describe('Filter to mentions matched by these keywords'),
        sources: z
          .array(MentionSource)
          .optional()
          .describe(
            'Filter by source: REDDIT_POST, REDDIT_COMMENT, TWITTER (X), BLUESKY, HACKERNEWS',
          ),
        sort: MentionSort.optional().describe(
          'RELEVANCE (default, highest score first) or RECENT (newest first)',
        ),
        from: z
          .string()
          .optional()
          .describe('Only mentions ingested at/after this ISO 8601 datetime'),
        to: z
          .string()
          .optional()
          .describe('Only mentions ingested at/before this ISO 8601 datetime'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .default(50)
          .describe('Max results (1-500)'),
        offset: z.number().int().min(0).optional().default(0).describe('Pagination offset'),
      },
      outputSchema: resultSchema(
        'Array of mentions, each with its source, matched keyword, relevance score, status, and content.',
      ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        return toolResult(await client.get('/mentions', input));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'count_mentions',
    {
      title: 'Count Mentions',
      description:
        'Count mentions matching the same filters as list_mentions (without returning the rows). Useful for pagination and dashboards.',
      inputSchema: {
        websiteId: z.string().optional().describe('Filter to one website (UUID)'),
        statuses: z.array(MentionStatus).optional(),
        scoreBuckets: z.array(RelevanceBucket).optional(),
        includeLowRelevance: z.boolean().optional(),
        keywords: z.array(z.string()).optional(),
        sources: z.array(MentionSource).optional(),
        from: z.string().optional().describe('ISO 8601 datetime'),
        to: z.string().optional().describe('ISO 8601 datetime'),
      },
      outputSchema: resultSchema(
        'The number of mentions matching the given filters.',
      ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        return toolResult(await client.get('/mentions/count', input));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'update_mention_status',
    {
      title: 'Update Mention Status',
      description:
        "Set a mention's status. APPROVED marks it as a real lead/relevant; REJECTED hides it (and excludes it from default lists); NEW resets it to the inbox.",
      inputSchema: {
        mentionId: z.string().describe('Mention ID (UUID)'),
        status: MentionStatus.describe('New status: NEW, APPROVED, or REJECTED'),
      },
      outputSchema: resultSchema('The mention with its updated status.'),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ mentionId, status }) => {
      try {
        return toolResult(
          await client.patch(`/mentions/${mentionId}/status`, { status }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'explain_mention',
    {
      title: 'Explain Mention Score',
      description:
        'Get (and lazily generate) the AI relevance reasoning and tags for a single mention — why it was scored the way it was.',
      inputSchema: {
        mentionId: z.string().describe('Mention ID (UUID)'),
      },
      outputSchema: resultSchema(
        'The AI relevance reasoning and tags for the mention.',
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ mentionId }) => {
      try {
        return toolResult(await client.post(`/mentions/${mentionId}/explain`));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  // ── Alert settings ────────────────────────────────────────────────────────

  server.registerTool(
    'get_alert_settings',
    {
      title: 'Get Alert Settings',
      description:
        'Get the email-alert settings: whether alerts are enabled, the cadence in minutes, the fastest cadence the plan allows, and the available cadence options.',
      inputSchema: {},
      outputSchema: resultSchema(
        "The alert settings: enabled flag, cadence in minutes, the plan's fastest allowed cadence, and available cadence options.",
      ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        return toolResult(await client.get('/alert-settings'));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'update_alert_settings',
    {
      title: 'Update Alert Settings',
      description:
        "Enable/disable mention email alerts and set the cadence. cadenceMinutes must be one of 60, 240, 720, 1440 and is clamped up to the plan's fastest allowed interval. Omit cadenceMinutes to use the plan default.",
      inputSchema: {
        enabled: z.boolean().describe('Turn email alerts on or off'),
        cadenceMinutes: z
          .number()
          .int()
          .optional()
          .describe('Alert frequency in minutes: 60 (hourly), 240 (4h), 720 (12h), 1440 (daily)'),
      },
      outputSchema: resultSchema(
        'The saved alert settings with the enabled flag and effective cadence.',
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        return toolResult(await client.put('/alert-settings', input));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  return server;
}

// ---------------------------------------------------------------------------
// Transport — stdio (local) or HTTP (deployed, single URL)
// ---------------------------------------------------------------------------

const SSE_ACCEPT = 'application/json, text/event-stream';

// The MCP SDK 406s unless Accept lists both types. `@hono/node-server` v1 rebuilds the
// request from rawHeaders, so headers.accept alone is not enough.
const forceStreamableAccept = (req: IncomingMessage) => {
  req.headers.accept = SSE_ACCEPT;

  const raw = req.rawHeaders;
  const index = raw.findIndex((entry, i) => i % 2 === 0 && entry.toLowerCase() === 'accept');

  if (index === -1) raw.push('Accept', SSE_ACCEPT);
  else raw[index + 1] = SSE_ACCEPT;
};

async function main() {
  if (isHttpMode) {
    const httpServer = createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');

      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
          'Access-Control-Allow-Headers':
            'Content-Type, Authorization, mcp-session-id',
        });
        res.end();
        return;
      }

      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      if (req.url === '/.well-known/glama.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            $schema: 'https://glama.ai/mcp/schemas/connector.json',
            maintainers: [{ email: 'taras.shinkarenko@gmail.com' }],
          })
        );
        return;
      }

      if (req.url === '/.well-known/openai-apps-challenge') {
        const challenge = process.env.OPENAI_APPS_CHALLENGE;
        if (challenge) {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(challenge);
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
        return;
      }

      if (handleProtectedResourceMetadata(oauthConfig, req, res)) {
        return;
      }

      if (req.url === '/mcp') {
        // Extract Bearer token from the incoming request
        const authHeader = req.headers.authorization ?? '';
        const bearerToken = authHeader.startsWith('Bearer ')
          ? authHeader.slice(7)
          : authHeader;

        if (!bearerToken && oauthConfig.oauthRequired) {
          sendUnauthorized(oauthConfig, res, 'Authentication required');
          return;
        }

        if (bearerToken && looksLikeJwt(bearerToken)) {
          const verdict = await verifyOauthJwt(oauthConfig, bearerToken);
          if (!verdict.valid) {
            sendUnauthorized(oauthConfig, res, verdict.error);
            return;
          }
        }

        const token = bearerToken || API_TOKEN;
        const reqApi = new RestClient(API_BASE_URL, token);

        const wantsSse = (req.headers.accept ?? '').includes('text/event-stream');
        if (!wantsSse) forceStreamableAccept(req);

        // Stateless mode requires a fresh transport per request
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: !wantsSse,
        });
        const reqServer = createMcpServer(reqApi);
        await reqServer.connect(transport);
        try {
          await transport.handleRequest(req, res);
        } catch (err) {
          console.error('MCP handleRequest error:', err);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(err) }));
          }
        }
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    httpServer.listen(HTTP_PORT, () => {
      console.error(
        `RedReplier MCP server (HTTP) listening on port ${HTTP_PORT}`,
      );
      console.error(`Connect with: https://your-domain/mcp`);
    });
  } else {
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
