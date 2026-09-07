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
        "List every website this account monitors, each with its keywords (id, value, status: PENDING, ACTIVE, DISABLED, SUSPENDED). Call this first: most other tools need a websiteId or keywordId from it. Reading also promotes any PENDING keyword that fits the plan's free headroom to ACTIVE, without ever charging. Use get_website instead when you already hold a websiteId and want one record. Only ACTIVE keywords match new mentions, so a long PENDING list explains a quiet inbox. Scope is the account behind the API token.",
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
        'Get one monitored website by ID with its full keyword list and statuses (PENDING, ACTIVE, DISABLED, SUSPENDED). Use it to re-check keyword statuses after add_keywords, enable_keyword, or activate_pending_keywords; use list_websites instead when you do not have the ID yet or want every site. websiteId comes from list_websites or create_website. Returns 404 when the website does not exist or belongs to another account, and 400 when websiteId is not a UUID.',
      inputSchema: {
        websiteId: z.string().describe('Monitored website ID (UUID) from list_websites'),
      },
      outputSchema: resultSchema(
        'The monitored website with its keyword list, each keyword carrying id, value, and status.',
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
        'Add a website to monitor across Reddit, Hacker News, X, and Bluesky. The domain must be new to this account: a duplicate returns 400, and re-adding a domain removed with delete_website revives that record. description is the context every mention is scored against. Omit it and the server scrapes the URL to write one, spending one AI generation from the plan quota; if that scrape fails or the quota is exhausted the site is created with description null and its mentions go unscored (reason "Scoring skipped: website description missing"), so check the response and set one with update_website or analyze_website. Pass your own description to skip the scrape. Initial keywords are stored PENDING: list_websites or add_keywords promotes those that fit the plan for free, and activate_pending_keywords covers the rest, possibly for a charge. AI-suggested keywords are added in the background and show up on the website later. Returns 400 when the plan has no website slots left.',
      inputSchema: {
        url: z.string().describe('Full website URL (e.g. "https://example.com")'),
        name: z.string().optional().describe('Display name for the website'),
        keywords: z
          .array(z.string().max(255))
          .optional()
          .describe(
            'Initial keywords, stored as PENDING; list_websites promotes those that fit the plan for free',
          ),
        description: z
          .string()
          .max(5000)
          .optional()
          .describe(
            'Product summary the AI scores every mention against; without it new mentions are not scored. Draft one with analyze_website',
          ),
      },
      outputSchema: resultSchema(
        'The created website with its id, domain, description, and keywords (initial ones PENDING).',
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
        "Update a monitored website's display name and/or description. Only the fields you pass change: omitted fields keep their value, and an empty description clears it. The description is the context the AI scores every new mention against, so keep it an accurate summary of the product; mentions already scored are not rescored. Use analyze_website to draft a description from the live site before saving it here. URL and keywords cannot change through this tool: use add_keywords, edit_keyword, or disable_keyword for keywords. Returns the updated website with its keyword list.",
      inputSchema: {
        websiteId: z.string().describe('Monitored website ID (UUID)'),
        name: z.string().optional().describe('New display name'),
        description: z
          .string()
          .max(5000)
          .optional()
          .describe('New scoring context; an empty string clears it, omit to keep the current one'),
      },
      outputSchema: resultSchema(
        'The updated website with its name, description, and keyword list.',
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
        'Stop monitoring a website (soft delete). The site and its keywords leave list_websites immediately and stop matching new mentions; there is no restore tool, but create_website with the same URL revives the record. Use this only when the whole site should go: use disable_keyword to pause one keyword and keep the site, and delete_keyword for a PENDING keyword you never want. Confirm with the user first and name the domain, not just the ID. Returns { deleted: true }; 404 if the ID is unknown to this account.',
      inputSchema: {
        websiteId: z.string().describe('Monitored website ID (UUID)'),
      },
      outputSchema: resultSchema('{ deleted: true } once the website is soft-deleted.'),
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
        'Scrape a URL and return an AI-written business description as { description }, without creating or changing any website. Use it to draft or preview the text before create_website or update_website, then pass the result as their description. Consumes one AI generation from the monthly quota unless a precomputed description already exists for that domain, and refunds it if generation fails. Returns 400 when the quota is exhausted or url is not a valid URL, and an error when the page has too little readable text.',
      inputSchema: {
        url: z.string().describe('Full website URL to scrape (e.g. "https://example.com")'),
      },
      outputSchema: resultSchema(
        '{ description }: the AI-written business description, ready to pass to create_website or update_website.',
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
        "Add keywords to a monitored website. Values are trimmed, lowercased, and de-duplicated; ones already ACTIVE on that site are skipped, and re-adding a DISABLED one resets it to PENDING (prefer enable_keyword). Each new keyword starts PENDING, then as many as fit the plan's free headroom flip to ACTIVE at once, with no charge. The rest stay PENDING and match nothing until activate_pending_keywords, which may charge an upgrade; run preview_activate_pending first. Adding is unlimited. Use edit_keyword to reword an existing keyword. Returns the whole website with its updated keyword list, not only the new keywords.",
      inputSchema: {
        websiteId: z.string().describe('Monitored website ID (UUID)'),
        keywords: z
          .array(z.string().max(255))
          .min(1)
          .describe(
            'Keywords to add (e.g. ["my product", "competitor name"]); trimmed, lowercased, and de-duplicated, max 255 characters each',
          ),
      },
      outputSchema: resultSchema(
        'The whole website with its full keyword list (id, value, status), including the new keywords as ACTIVE or PENDING.',
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
        "Change a keyword's text in place, keeping its ID and any paid slot. Edits are unlimited on every plan (keyword_change_usage reports limit -1). The new value is re-graded for noise; an ACTIVE keyword stays ACTIVE, while a PENDING, DISABLED, or SUSPENDED one goes ACTIVE if the plan has a free slot and PENDING otherwise. Use this to fix a SUSPENDED keyword the grader rejected, or to reword instead of adding a variant with add_keywords. A case-only change is a no-op; a value already on the website returns 400.",
      inputSchema: {
        keywordId: z.string().describe('Keyword ID (UUID)'),
        value: z
          .string()
          .max(255)
          .describe('New keyword text; trimmed and lowercased, must not duplicate another keyword on the same website'),
      },
      outputSchema: resultSchema(
        'The updated keyword with its new value and resulting status (ACTIVE or PENDING).',
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
        'Stop monitoring one keyword: sets it DISABLED and it stops matching new mentions immediately. Unlimited and reversible with enable_keyword. Billing does not drop right away: the keyword keeps its paid slot until the end of the current billing cycle, so re-enabling it in the same cycle is free but a new keyword cannot reuse that slot for free; any price reduction is scheduled for the cycle boundary. Use delete_keyword instead for a PENDING keyword you never want. Calling it on an already DISABLED keyword returns it unchanged.',
      inputSchema: {
        keywordId: z.string().describe('Keyword ID (UUID)'),
      },
      outputSchema: resultSchema('The keyword with status DISABLED; its paid slot is held until the billing cycle ends.'),
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
        'Re-activate one DISABLED keyword. It goes ACTIVE at once when it fits the plan or was disabled earlier in this billing cycle (it still holds its slot). Otherwise it is set PENDING and the required plan upgrade is charged immediately; it flips ACTIVE once the payment settles, so re-check with get_website. Use activate_pending_keywords instead to bring every PENDING keyword live in one call, and add_keywords for a keyword that does not exist yet. Preview cost with preview_keyword_billing first. Returns 400 without an active subscription; an ACTIVE keyword is returned unchanged.',
      inputSchema: {
        keywordId: z.string().describe('Keyword ID (UUID)'),
      },
      outputSchema: resultSchema(
        'The keyword with status ACTIVE, or PENDING when an upgrade was charged and its payment has not settled yet.',
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
        'Permanently delete one keyword. Only PENDING keywords qualify (never billed, never live), so there is no billing effect and no undo. Any other status returns 400 "Only pending keywords can be removed": use disable_keyword for an ACTIVE keyword, edit_keyword to fix a SUSPENDED one, and delete_website to drop a whole site. Prefer this over leaving unwanted PENDING keywords in place, because activate_pending_keywords would otherwise try to pay for them. Returns { deleted: true }.',
      inputSchema: {
        keywordId: z.string().describe('Keyword ID (UUID)'),
      },
      outputSchema: resultSchema('{ deleted: true } once the PENDING keyword is removed.'),
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
        'Activate every PENDING keyword across the account in two steps: promote as many as the current plan covers for free, then charge an immediate prorated upgrade to cover the remainder (keywords disabled this cycle still hold slots and count). Keywords covered by the upgrade stay PENDING in the response and flip ACTIVE once the payment settles; re-check with list_websites. Always call preview_activate_pending first, show the user immediateCharge and targetPlanName, and get explicit consent; never call this in a loop. Use enable_keyword for a single DISABLED keyword. Fails with 400 when there is no active subscription or the charge fails, leaving keywords PENDING. Returns the updated websites.',
      inputSchema: {},
      outputSchema: resultSchema(
        'All websites with their keyword statuses; keywords waiting on an upgrade payment still show PENDING.',
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
        'Preview the billing impact of activate_pending_keywords without changing anything. Takes no input: it prices the plan needed for the keywords committed this cycle (ACTIVE plus disabled this cycle) plus every PENDING keyword. Returns currentPlanName, currentMonthlyPrice, targetPlanName, targetMonthlyPrice, targetKeywords, immediateCharge (prorated amount charged now), isUpgrade, isDowngrade, requiresImmediatePayment; immediateCharge 0 with isUpgrade false means activation is free. Use this right before activate_pending_keywords. Use preview_keyword_billing instead to price an arbitrary keyword count, for example before add_keywords or enable_keyword.',
      inputSchema: {},
      outputSchema: resultSchema(
        'Billing preview: currentPlanName, currentMonthlyPrice, targetPlanName, targetMonthlyPrice, targetKeywords, immediateCharge, isUpgrade, isDowngrade, requiresImmediatePayment.',
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
        'Preview the plan and price needed for a chosen total of active keywords, without changing anything. desiredKeywordCount is the absolute number of keywords you want live across the account, not the number being added: count the ACTIVE keywords from list_websites and add the new ones. Returns the same shape as preview_activate_pending (currentPlanName, targetPlanName, targetMonthlyPrice, immediateCharge, isUpgrade, isDowngrade, requiresImmediatePayment). Use this for what-if pricing before add_keywords or enable_keyword; use preview_activate_pending instead for the exact cost of activating the keywords already PENDING, which it counts for you.',
      inputSchema: {
        desiredKeywordCount: z
          .number()
          .int()
          .min(0)
          .describe(
            'Total ACTIVE keywords wanted across the account after the change (absolute count, not an increment)',
          ),
      },
      outputSchema: resultSchema(
        'Billing preview for that keyword count, same shape as preview_activate_pending: target plan, monthly price, prorated immediateCharge, isUpgrade, isDowngrade.',
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
        'Get the monthly keyword-edit allowance for the account as { limit, used, remaining, unlimited }, where limit -1 means unlimited. Only edit_keyword ever counted toward it; add_keywords, disable_keyword, and enable_keyword never did. Every current plan reports unlimited, so there is no need to check it before edit_keyword; it remains for clients that budget edits. Not a capacity or billing preview: use preview_keyword_billing or preview_activate_pending for plan pricing, and list_websites to count ACTIVE keywords.',
      inputSchema: {},
      outputSchema: resultSchema(
        '{ limit, used, remaining, unlimited }; limit -1 and unlimited true mean edits are not metered.',
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
        "List mentions matched for this account across Reddit, Hacker News, X, and Bluesky, each AI-scored 0-100 with its source, matched keyword, status, content, and any generated relevanceReason and aiReplySuggestion. Two defaults hide rows: REJECTED mentions are excluded unless statuses names them, and mentions below the website's minimum score (30 by default) are hidden unless includeLowRelevance is true, even when scoreBuckets asks for LOW or VERY_LOW. Returns { mentions, total, limit, offset }; page with offset while offset < total. Sort RELEVANCE for the best leads, RECENT for what is new; from/to filter on ingestion time, not publish time. Use count_mentions for the number alone, explain_mention for one mention's reasoning, and update_mention_status to triage.",
      inputSchema: {
        websiteId: z.string().optional().describe('Filter to one website (UUID)'),
        statuses: z
          .array(MentionStatus)
          .optional()
          .describe('Filter by status (NEW, APPROVED, REJECTED); omit to get everything except REJECTED'),
        scoreBuckets: z
          .array(RelevanceBucket)
          .optional()
          .describe(
            'Relevance buckets, OR-combined: VERY_LOW (<10), LOW (10-29), MEDIUM (30-49), HIGH (50-74), VERY_HIGH (75+). LOW and VERY_LOW only show when includeLowRelevance is also true',
          ),
        includeLowRelevance: z
          .boolean()
          .optional()
          .describe('Include mentions below the website minimum score (30 by default), hidden otherwise'),
        keywords: z
          .array(z.string())
          .optional()
          .describe('Filter to mentions matched by these keyword values (case-insensitive exact match, as shown in list_websites)'),
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
        '{ mentions, total, limit, offset }: each mention has id, source, keyword, title, contentText, url, author, subreddit (Reddit only), status, relevanceScore, relevanceReason, aiReplySuggestion, tags, publishedAt, ingestedAt, reviewedAt.',
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
        "Count mentions matching the same filters as list_mentions, returning { total } and no rows. The same defaults apply: REJECTED excluded unless statuses includes it, and scores below the website's minimum (30 by default) hidden unless includeLowRelevance is true. Use it for dashboards, to size a triage batch, or to decide whether paging list_mentions is worthwhile; list_mentions already returns total with its rows, so skip this when you fetch rows anyway. Takes no sort, limit, or offset.",
      inputSchema: {
        websiteId: z.string().optional().describe('Filter to one website (UUID)'),
        statuses: z
          .array(MentionStatus)
          .optional()
          .describe('Filter by status (NEW, APPROVED, REJECTED); omit to count everything except REJECTED'),
        scoreBuckets: z
          .array(RelevanceBucket)
          .optional()
          .describe(
            'Relevance buckets, OR-combined: VERY_LOW (<10), LOW (10-29), MEDIUM (30-49), HIGH (50-74), VERY_HIGH (75+). LOW and VERY_LOW only count when includeLowRelevance is also true',
          ),
        includeLowRelevance: z
          .boolean()
          .optional()
          .describe('Include mentions below the website minimum score (30 by default), hidden otherwise'),
        keywords: z
          .array(z.string())
          .optional()
          .describe('Count only mentions matched by these keyword values (case-insensitive exact match)'),
        sources: z
          .array(MentionSource)
          .optional()
          .describe(
            'Filter by source: REDDIT_POST, REDDIT_COMMENT, TWITTER (X), BLUESKY, HACKERNEWS',
          ),
        from: z
          .string()
          .optional()
          .describe('Only mentions ingested at/after this ISO 8601 datetime'),
        to: z
          .string()
          .optional()
          .describe('Only mentions ingested at/before this ISO 8601 datetime'),
      },
      outputSchema: resultSchema(
        '{ total }: the number of mentions matching the filters after the default exclusions.',
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
        "Set one mention's triage status. APPROVED marks it a real lead; REJECTED marks it noise and drops it from default list_mentions and count_mentions results (pass statuses to see it again); NEW returns it to the inbox. Fully reversible: any status can move to any other; reviewedAt is stamped when leaving NEW and cleared on NEW. Judge on the content and relevanceScore, calling explain_mention first when the score looks off; never approve a mention you have not read. mentionId comes from list_mentions. Returns the updated mention.",
      inputSchema: {
        mentionId: z.string().describe('Mention ID (UUID)'),
        status: MentionStatus.describe(
          'New status: APPROVED (real lead), REJECTED (noise, hidden from default lists), or NEW (back to inbox)',
        ),
      },
      outputSchema: resultSchema('The updated mention with its new status and reviewedAt (null when NEW).'),
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
        'Get the AI relevance reasoning (relevanceReason), tags, and a drafted reply (aiReplySuggestion) for one mention, generating whatever is missing on first call and storing it, so later calls are instant reads. The website must have a description; without one the mention comes back unchanged. Use it when a score looks wrong or before update_mention_status on a borderline lead, not across every row of list_mentions, since generation is slow. Returns the full mention object, or null (not a 404) when the ID is unknown to this account.',
      inputSchema: {
        mentionId: z.string().describe('Mention ID (UUID) from list_mentions'),
      },
      outputSchema: resultSchema(
        'The full mention with relevanceReason, tags, and aiReplySuggestion filled in; null when the mention is not found.',
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
        "Get the account's email-alert settings: enabled, cadenceMinutes (the digest interval in effect), minIntervalMinutes (the fastest cadence the plan allows), and availableCadences (the subset of 15, 30, 60, 120, 180, 240, 720, 1440 at or above that floor). cadenceMinutes is never reported below the floor, even if a faster value was saved before a plan downgrade. Call it before update_alert_settings to pick a value from availableCadences, and after it to confirm what applied. Read-only; the digests themselves are sent by the platform on that cadence.",
      inputSchema: {},
      outputSchema: resultSchema(
        '{ enabled, cadenceMinutes, minIntervalMinutes, availableCadences }: the cadence in effect, the plan floor, and the cadences you may pick.',
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
        'Turn mention email alerts on or off and set how often the digest is sent. enabled is required on every call. cadenceMinutes must be one of 15, 30, 60, 120, 180, 240, 720, 1440, otherwise 400 "Invalid alert frequency for your plan"; a value faster than the plan floor is silently raised to the floor. Both settings are replaced on every call: omitting cadenceMinutes resets it to the fastest cadence the plan allows, so pass the current value when only toggling enabled. Use get_alert_settings for availableCadences before, and to confirm the applied cadence after. Returns the resolved settings.',
      inputSchema: {
        enabled: z.boolean().describe('Turn email alerts on or off'),
        cadenceMinutes: z
          .number()
          .int()
          .optional()
          .describe(
            'Digest interval in minutes: 15, 30, 60, 120, 180, 240, 720, or 1440; raised to the plan floor when faster than allowed, reset to the fastest allowed when omitted',
          ),
      },
      outputSchema: resultSchema(
        'The resolved settings after clamping: { enabled, cadenceMinutes, minIntervalMinutes, availableCadences }.',
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
