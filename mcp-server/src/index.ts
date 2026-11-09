#!/usr/bin/env bun

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z, type ZodRawShape, type ZodTypeAny } from 'zod';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { RestClient } from './rest-client.js';
import { withoutSchemaDialect } from './schema-dialect.js';
import {
  oauthConfigFromEnv,
  handleProtectedResourceMetadata,
  sendUnauthorized,
  looksLikeJwt,
  verifyOauthJwt,
} from './oauth.js';

const SERVER_VERSION: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;


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


const MentionStatus = z.enum(['NEW', 'APPROVED', 'REJECTED']);
const MentionSource = z.enum([
  'REDDIT_POST',
  'REDDIT_COMMENT',
  'TWITTER',
  'BLUESKY',
  'HACKERNEWS',
  'FACEBOOK',
  'FACEBOOK_GROUP',
]);
const AlertCadenceMinutes = z.union(
  [
    z.literal(15),
    z.literal(30),
    z.literal(60),
    z.literal(120),
    z.literal(180),
    z.literal(240),
    z.literal(720),
    z.literal(1440),
  ],
  {
    errorMap: () => ({
      message: 'cadenceMinutes must be one of 15, 30, 60, 120, 180, 240, 720 or 1440',
    }),
  },
);

const RelevanceBucket = z.enum([
  'VERY_LOW',
  'LOW',
  'MEDIUM',
  'HIGH',
  'VERY_HIGH',
]);
const MentionSort = z.enum(['RELEVANCE', 'RECENT']);


const workspaceIdField = {
  workspaceId: z
    .string()
    .optional()
    .describe(
      'Workspace to act in: an id from list_workspaces. Omit to use the default workspace. Use the same workspaceId for every call about the same workspace, since ids from one workspace do not exist in another',
    ),
};

const SERVER_INSTRUCTIONS =
  'A sign-in can reach several workspaces, each with its own data and role. Call list_workspaces when the user names a workspace, client or organization, or when data they expect is missing, then pass that id as workspaceId on every call about it. Without workspaceId, tools act in the default workspace. A 403 with code workspace_access_denied means the workspaceId is not one this sign-in can reach; pick an id from list_workspaces. A 403 with code permission_denied means this member\'s role lacks redreplier.write, which Admin and Editor hold: stop, do not retry, and tell the user a workspace admin has to change their role. A 403 with code subscription_required means the organization\'s current RedReplier plan does not include this; tell the user and stop, do not retry. A 401 with code token_issuer_lost_access means this connection lost access to the workspace; tell the user to reconnect RedReplier, or to have a workspace member create a new API key in RedReplier settings. A 401 with code oauth_account_not_found means the sign-in email has no RedReplier account; relay the message and ask the user to reconnect with the right email. A 429 means the rate limit was hit; wait for Retry-After and do not loop.';

const SERVER_DESCRIPTION =
  'Find and triage public conversations on Reddit, Hacker News, X, Bluesky and Facebook that mention your product. An agent can add the websites to monitor and their keywords, list and count the AI-scored mentions, read why a mention scored as it did with a drafted reply, mark mentions as leads or noise, and set how often email alerts arrive.';

const resultSchema = (result: ZodTypeAny) => ({ result });

const isoDateTime = z.string().nullable().optional();

const workspaceOutput = z
  .object({
    id: z.string().describe('Pass as workspaceId to other tools'),
    name: z.string(),
    organization: z.object({ id: z.string(), name: z.string() }).passthrough(),
    role: z.object({ key: z.string(), name: z.string() }).passthrough(),
    permissions: z.array(z.string()),
    isDefault: z.boolean(),
    current: z.boolean().describe('True for the workspace this call landed in'),
  })
  .passthrough();

const keywordOutput = z
  .object({
    id: z.string().describe('Keyword ID for edit_keyword, enable_keyword, disable_keyword and delete_keyword'),
    websiteId: z.string(),
    value: z.string().describe('Lowercased keyword text, the value list_mentions filters on'),
    status: z
      .string()
      .describe('PENDING (saved, not monitored until the plan covers it), ACTIVE, DISABLED or SUSPENDED'),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .passthrough();

const websiteOutput = z
  .object({
    id: z.string().describe('Website ID for the other tools'),
    accountGroupId: z.string().optional(),
    domain: z.string(),
    url: z.string(),
    name: z.string().nullable().optional(),
    description: z
      .string()
      .nullable()
      .optional()
      .describe('Context every new mention is scored against; null means new mentions go unscored'),
    ignoredKeywords: z
      .array(z.string())
      .describe('Lowercased words and phrases; mentions containing one are hidden'),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
    keywords: z.array(keywordOutput),
  })
  .passthrough();

const mentionOutput = z
  .object({
    id: z.string().describe('Mention ID for update_mention_status and explain_mention'),
    websiteId: z.string(),
    source: z
      .string()
      .describe('REDDIT_POST, REDDIT_COMMENT, TWITTER, BLUESKY, HACKERNEWS, FACEBOOK or FACEBOOK_GROUP'),
    keyword: z.string().nullable().optional().describe('The monitored keyword this conversation matched'),
    title: z.string().nullable().optional(),
    contentText: z.string().nullable().optional(),
    url: z
      .string()
      .nullable()
      .optional()
      .describe('Link to the conversation; null when the platform gives no public link'),
    author: z.string().nullable().optional().describe("Author's public handle on that network"),
    subreddit: z
      .string()
      .nullable()
      .optional()
      .describe('The subreddit on Reddit, the group id on FACEBOOK_GROUP, otherwise null'),
    status: z.string().describe('NEW, APPROVED or REJECTED'),
    relevanceScore: z
      .number()
      .nullable()
      .optional()
      .describe('AI score from 0 to 100, higher means more worth a reply; null until scored'),
    relevanceReason: z.string().nullable().optional().describe('Why the scorer chose that score'),
    aiReplySuggestion: z
      .string()
      .nullable()
      .optional()
      .describe('Draft reply for a human to review before posting'),
    tags: z.array(z.string()).optional(),
    publishedAt: isoDateTime,
    ingestedAt: isoDateTime,
    reviewedAt: isoDateTime,
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .passthrough();

const deletedOutput = z.object({ deleted: z.boolean() }).passthrough();

const alertSettingsOutput = z
  .object({
    enabled: z.boolean(),
    cadenceMinutes: z.number().int().describe('Digest interval in effect, in minutes'),
    minIntervalMinutes: z.number().int().optional().describe('Fastest cadence the plan allows'),
    availableCadences: z
      .array(z.number().int())
      .optional()
      .describe('Cadences, in minutes, that update_alert_settings accepts on this plan'),
  })
  .passthrough();

const mentionStatusDescription =
  'Triage statuses to include: NEW (not reviewed yet), APPROVED (marked a real lead), REJECTED (marked noise). Omit to include NEW and APPROVED; REJECTED mentions appear only when listed here';

const scoreBucketsDescription =
  'Relevance score ranges to include, OR-combined: VERY_LOW is below 10, LOW 10-29, MEDIUM 30-49, HIGH 50-74, VERY_HIGH 75 and up. Omit for every range. LOW and VERY_LOW only return rows when includeLowRelevance is also true';

const includeLowRelevanceDescription =
  "Also include mentions scoring below the website's minimum score (30 by default). Omit or false to hide them";

const minScoreDescription =
  "Lowest relevance score to include; unscored mentions are left out once this is set. It stacks on the website's minimum score, so set includeLowRelevance to go below that. Omit for no extra floor";

const sourcesDescription =
  'Networks to include: REDDIT_POST, REDDIT_COMMENT, TWITTER (X), BLUESKY, HACKERNEWS, FACEBOOK (posts outside groups), FACEBOOK_GROUP (posts in Facebook groups). Omit for every network';

const fromDescription =
  'Only mentions RedReplier saved at or after this ISO 8601 datetime (ingestion time, not the post date). Omit for no lower bound';

const toDescription =
  'Only mentions RedReplier saved at or before this ISO 8601 datetime (ingestion time, not the post date). Omit for no upper bound';

const mentionWebsiteIdDescription =
  'Website ID from list_websites to limit results to that site. Omit to cover every website in the workspace';

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


function createMcpServer(apiClient?: RestClient): McpServer {
  const baseClient = apiClient ?? api;
  const server = new McpServer(
    {
      name: 'redreplier',
      title: 'RedReplier',
      version: SERVER_VERSION,
      description: SERVER_DESCRIPTION,
      websiteUrl: 'https://redreplier.com/features/agents',
      icons: [
        {
          src: 'https://raw.githubusercontent.com/RedReplier/agent/main/assets/icon.svg',
          mimeType: 'image/svg+xml',
          sizes: ['any'],
        },
      ],
    },
    { instructions: SERVER_INSTRUCTIONS },
  );

  const tool = <Args extends ZodRawShape>(
    name: string,
    config: {
      title: string;
      description: string;
      inputSchema: Args;
      outputSchema: ZodRawShape;
      annotations: ToolAnnotations;
    },
    handler: (
      args: z.objectOutputType<Args, ZodTypeAny>,
      client: RestClient,
    ) => Promise<CallToolResult>,
  ) => {
    const inputSchema: ZodRawShape = { ...config.inputSchema, ...workspaceIdField };
    return server.registerTool(name, { ...config, inputSchema }, async (args) => {
      const { workspaceId, ...rest } = args as { workspaceId?: string };
      return handler(
        rest as z.objectOutputType<Args, ZodTypeAny>,
        baseClient.forWorkspace(workspaceId),
      );
    });
  };

  server.registerTool(
    'list_workspaces',
    {
      title: 'List Workspaces',
      description:
        'List the workspaces this sign-in can act in, across every organization the user belongs to. Returns { workspaces } with one entry per workspace: id, name, organization { id, name }, role { key, name }, permissions, isDefault and current. Call this when the user names a workspace, client or organization, or when data they expect is missing, then pass the matching id as workspaceId to every other tool. Without workspaceId, tools act in the workspace marked current. An API key belongs to one workspace, so it lists only that one. Takes no arguments.',
      inputSchema: {},
      outputSchema: resultSchema(
        z.object({ workspaces: z.array(workspaceOutput) }).passthrough(),
      ),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
    },
    async () => {
      try {
        const data = await baseClient.get('/workspaces');
        return toolResult(data);
      } catch (error) {
        return toolError(error);
      }
    },
  );


  tool(
    'list_websites',
    {
      title: 'List Your Websites',
      description:
        "List the user's own websites saved in their RedReplier account, each with its URL, name, description, ignore list (ignoredKeywords), and the keywords the user set up for it (ID, text, and status). Reads the account's saved settings only. Use get_website for one website when you have its ID. The website and keyword IDs are the inputs for the other tools.",
      inputSchema: {},
      outputSchema: resultSchema(
        z.object({ websites: z.array(websiteOutput) }).passthrough(),
      ),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (_args, client) => {
      try {
        return toolResult(await client.get('/websites'));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  tool(
    'get_website',
    {
      title: 'Get Monitored Website',
      description:
        'Get one monitored website by ID with its full keyword list and statuses (PENDING, ACTIVE, DISABLED, SUSPENDED), and its ignoredKeywords: the words and phrases whose mentions are hidden. Use it to re-check keyword statuses after add_keywords or enable_keyword; use list_websites instead when you do not have the ID yet or want every site. websiteId comes from list_websites or create_website. Returns 404 when the website does not exist or belongs to another account.',
      inputSchema: {
        websiteId: z.string().uuid().describe('Website ID from list_websites or create_website'),
      },
      outputSchema: resultSchema(websiteOutput),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ websiteId }, client) => {
      try {
        return toolResult(await client.get(`/websites/${websiteId}`));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  tool(
    'create_website',
    {
      title: 'Add Your Website',
      description:
        'Add the user\'s own website to their RedReplier account so RedReplier can find public posts on Reddit, Hacker News, X, Bluesky, and Facebook that mention its keywords. The domain must be new to this account: a duplicate returns 400, and re-adding a domain removed with delete_website revives that record. description is the context every mention is scored against. Omit it and RedReplier reads the website\'s public homepage to write one, spending one AI generation from the plan quota; if that read fails or the quota is exhausted the site is created with description null and its mentions go unscored (reason "Scoring skipped: website description missing"), so check the response and set one with update_website or analyze_website. Pass your own description to skip that step. Initial keywords are saved as PENDING and stay PENDING until add_keywords or enable_keyword activates them within the plan. AI-suggested keywords are added in the background and show up on the website later. Returns 400 when the plan has no website slots left.',
      inputSchema: {
        url: z
          .string()
          .describe('Address of the user\'s website including the scheme, e.g. "https://example.com". Its domain identifies the site'),
        name: z
          .string()
          .optional()
          .describe('Display name for the website in RedReplier, e.g. "Acme CRM". Omit to store no name (null); set one later with update_website'),
        keywords: z
          .array(z.string().max(255))
          .max(100)
          .optional()
          .describe(
            'Words or phrases whose mentions to look for. Saved as PENDING; activate them with add_keywords or enable_keyword. Omit to start with none',
          ),
        description: z
          .string()
          .max(5000)
          .optional()
          .describe(
            'Product summary the AI scores every mention against. Omit to have RedReplier write one from the homepage (one AI generation); an empty string stores none and leaves new mentions unscored. Draft one with analyze_website',
          ),
      },
      outputSchema: resultSchema(websiteOutput),
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (input, client) => {
      try {
        return toolResult(await client.post('/websites', input));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  tool(
    'update_website',
    {
      title: 'Update Monitored Website',
      description:
        "Update a monitored website's display name, description, or ignore list. Only the fields you pass change: omitted fields keep their value, and an empty description clears it. The description is the context the AI scores every new mention against, so keep it an accurate summary of the product; mentions already scored are not rescored. Use analyze_website to draft a description from the live site before saving it here. ignoredKeywords replaces the whole ignore list (the same list as the RedReplier app's ignore settings): any mention whose title or text contains one of these words or phrases, ignoring case, disappears from list_mentions and count_mentions, and new matches are hidden as they arrive. To add or remove one entry, read the current ignoredKeywords with get_website, edit that list, and send all of it back; [] clears the list and brings every hidden mention back. Confirm with the user before removing entries. URL and keywords cannot change through this tool: use add_keywords, edit_keyword, or disable_keyword for keywords. Returns the updated website with its ignoredKeywords and keyword list.",
      inputSchema: {
        websiteId: z
          .string()
          .uuid()
          .describe('ID of the website to change, from list_websites or the id create_website returned'),
        name: z
          .string()
          .optional()
          .describe('New display name shown for the website in RedReplier, e.g. "Acme CRM". Omit to keep the current name unchanged'),
        description: z
          .string()
          .max(5000)
          .optional()
          .describe('New product summary that new mentions are scored against. An empty string clears it; omit to keep the current one'),
        ignoredKeywords: z
          .array(z.string().max(255))
          .max(100)
          .optional()
          .describe(
            'The complete new ignore list of words or phrases. Replaces the current list; [] clears it, omit to keep it',
          ),
      },
      outputSchema: resultSchema(websiteOutput),
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ websiteId, ...body }, client) => {
      try {
        return toolResult(await client.patch(`/websites/${websiteId}`, body));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  tool(
    'delete_website',
    {
      title: 'Delete Monitored Website',
      description:
        'Stop monitoring a website (soft delete). The site and its keywords leave list_websites immediately and stop matching new mentions. Its active keywords free plan slots, so the oldest pending keywords on other websites that now fit may become active, which queues public-network searches and ranking checks. There is no restore tool, but create_website with the same URL revives the record. Use this only when the whole site should go: use disable_keyword to pause one keyword and keep the site, and delete_keyword to erase one keyword and its mentions. Confirm with the user first and name the domain, not just the ID. Returns { deleted: true }; 404 if the ID is unknown to this account.',
      inputSchema: {
        websiteId: z
          .string()
          .uuid()
          .describe('ID of the website to delete, from list_websites or the id create_website returned. Check its domain there before deleting'),
      },
      outputSchema: resultSchema(deletedOutput),
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: true,
        openWorldHint: true,
      },
    },
    async ({ websiteId }, client) => {
      try {
        return toolResult(await client.delete(`/websites/${websiteId}`));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  tool(
    'analyze_website',
    {
      title: 'Draft Website Description',
      description:
        'Read the public homepage of the user\'s website and return an AI-written business description as { description }, without creating or changing any website. Use it to draft or preview the text before create_website or update_website, then pass the result as their description. Consumes one AI generation from the monthly quota unless a precomputed description already exists for that domain, and refunds it if generation fails. Returns 400 when the quota is exhausted or url is not a valid URL, and an error when the page has too little readable text.',
      inputSchema: {
        url: z
          .string()
          .describe('Address of the user\'s website whose homepage to read, including the scheme, e.g. "https://example.com"'),
      },
      outputSchema: resultSchema(
        z
          .object({
            description: z
              .string()
              .describe('AI-written business description to pass to create_website or update_website'),
          })
          .passthrough(),
      ),
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async ({ url }, client) => {
      try {
        return toolResult(
          await client.post('/websites/analyze-description', { url }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );


  tool(
    'add_keywords',
    {
      title: 'Add Keywords',
      description:
        'Add keywords to a monitored website. Values are trimmed, lowercased and deduplicated; active values are skipped and disabled values may be proposed again. New keywords start pending, then those within the existing plan become active without a charge. Activation updates monitoring alerts and queues public-network searches and ranking checks. Keywords beyond the current entitlement stay pending. Returns the whole website with its updated keyword list. Use edit_keyword to change existing text.',
      inputSchema: {
        websiteId: z.string().uuid().describe('ID of the website to add the keywords to, from list_websites or the id create_website returned'),
        keywords: z
          .array(z.string().max(255))
          .min(1)
          .max(100)
          .describe(
            'Words or phrases whose mentions to look for, e.g. ["my product", "competitor name"]',
          ),
      },
      outputSchema: resultSchema(websiteOutput),
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async ({ websiteId, keywords }, client) => {
      try {
        return toolResult(
          await client.post(`/websites/${websiteId}/keywords`, { keywords }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  tool(
    'edit_keyword',
    {
      title: 'Edit Keyword',
      description:
        "Replace a keyword's text while keeping its ID. Edits are unlimited. The new value is re-graded and replaces its matching rules; an active keyword stays active, while other keywords become active only if the current plan has space. Activating a suspended keyword also queues public-network searches and ranking checks. Monitoring alerts are synchronized. Case-only changes are a no-op; duplicate values on the same website fail. Previous text and matching rules are overwritten.",
      inputSchema: {
        keywordId: z
          .string()
          .uuid()
          .describe('ID of the keyword to change, from the keywords list in list_websites or get_website'),
        value: z
          .string()
          .min(1)
          .max(255)
          .describe('New keyword text; stored trimmed and lowercased, and must not duplicate another keyword on the same website'),
      },
      outputSchema: resultSchema(keywordOutput),
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: true,
        openWorldHint: true,
      },
    },
    async ({ keywordId, value }, client) => {
      try {
        return toolResult(await client.patch(`/keywords/${keywordId}`, { value }));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  tool(
    'disable_keyword',
    {
      title: 'Disable Keyword',
      description:
        'Set one keyword to DISABLED and stop matching new mentions. Keeps its stored mentions and synchronizes monitoring alerts. Use enable_keyword to resume monitoring within the current entitlement, or delete_keyword to permanently erase the keyword and its mentions. Disabling an active keyword frees a plan slot, so the oldest pending keyword that now fits the plan may become active, which queues public-network searches and ranking checks. An already disabled keyword is returned unchanged. This tool does not charge, refund, or change the subscription.',
      inputSchema: {
        keywordId: z
          .string()
          .uuid()
          .describe('ID of the keyword to pause, from the keywords list in list_websites or get_website'),
      },
      outputSchema: resultSchema(keywordOutput),
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: true,
        openWorldHint: true,
      },
    },
    async ({ keywordId }, client) => {
      try {
        return toolResult(await client.post(`/keywords/${keywordId}/disable`));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  tool(
    'enable_keyword',
    {
      title: 'Enable Keyword',
      description:
        'Enable an existing keyword within the current plan. It becomes ACTIVE if there is capacity, otherwise PENDING; this tool never charges or upgrades a subscription. An already active keyword is returned unchanged. Monitoring alerts are synchronized when activated. No historical backfill runs on re-enable; new matches arrive through monitoring. Use add_keywords for a new keyword.',
      inputSchema: {
        keywordId: z
          .string()
          .uuid()
          .describe('ID of a DISABLED or PENDING keyword to turn on, from the keywords list in list_websites or get_website (the id field, not the keyword text)'),
      },
      outputSchema: resultSchema(keywordOutput),
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: true,
        openWorldHint: true,
      },
    },
    async ({ keywordId }, client) => {
      try {
        return toolResult(await client.post(`/keywords/${keywordId}/enable`));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  tool(
    'delete_keyword',
    {
      title: 'Delete Keyword',
      description:
        'Permanently delete one keyword in any status, together with every mention it produced. There is no undo and no restore: disable_keyword pauses a keyword and keeps its mentions, edit_keyword fixes a SUSPENDED value, and delete_website drops a whole site. Deleting an active keyword frees a plan slot, so the oldest pending keyword that now fits the plan may become active, which queues public-network searches and ranking checks; this tool does not issue a refund or change the subscription. Confirm with the user first and name the keyword, not just the ID. Returns { deleted: true }; 404 if the ID is unknown to this account.',
      inputSchema: {
        keywordId: z
          .string()
          .uuid()
          .describe('ID of the keyword to erase, from the keywords list in list_websites or get_website'),
      },
      outputSchema: resultSchema(deletedOutput),
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: true,
        openWorldHint: true,
      },
    },
    async ({ keywordId }, client) => {
      try {
        return toolResult(await client.delete(`/keywords/${keywordId}`));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  tool(
    'keyword_change_usage',
    {
      title: 'Get Keyword Edit Allowance',
      description:
        'Get the monthly keyword-edit allowance for the account as { limit, used, remaining, unlimited }, where limit -1 means unlimited. Only edit_keyword ever counted toward it; add_keywords, disable_keyword, and enable_keyword never did. Every current plan reports unlimited, so there is no need to check it before edit_keyword; it remains for clients that budget edits. This reports editing allowance only; it does not change keyword capacity, sell a plan, or initiate payment.',
      inputSchema: {},
      outputSchema: resultSchema(
        z
          .object({
            limit: z.number().int().describe('Edits allowed per month; -1 when unlimited'),
            used: z.number().int(),
            remaining: z.number().int().describe('-1 when unlimited'),
            unlimited: z.boolean(),
          })
          .passthrough(),
      ),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (_args, client) => {
      try {
        return toolResult(await client.get('/keywords/change-usage'));
      } catch (error) {
        return toolError(error);
      }
    },
  );


  tool(
    'list_mentions',
    {
      title: 'List Your Mentions',
      description:
        "List the mentions RedReplier saved for the user's keywords: public posts on Reddit, Hacker News, X, Bluesky, and Facebook, each AI-scored 0-100 with its source, matched keyword, status, content, and any generated relevanceReason and aiReplySuggestion. Two defaults hide rows: REJECTED mentions are excluded unless statuses names them, and mentions below the website's minimum score (30 by default) are hidden unless includeLowRelevance is true, even when scoreBuckets asks for LOW or VERY_LOW. Mentions containing a word on the website's ignore list (ignoredKeywords, changed with update_website) never appear. Returns { mentions, total, limit, offset }; page with offset while offset < total. Sort RELEVANCE for the best leads, RECENT for what is new; from/to filter on ingestion time, not publish time. Reads mentions already saved in the account; it does not search or contact any network. Each mention is a public post with its text, URL and the author's public handle as shown on that network; private Facebook groups are never read. Use count_mentions for the number alone, explain_mention for one mention's reasoning, and update_mention_status to triage.",
      inputSchema: {
        websiteId: z.string().uuid().optional().describe(mentionWebsiteIdDescription),
        statuses: z.array(MentionStatus).optional().describe(mentionStatusDescription),
        scoreBuckets: z.array(RelevanceBucket).optional().describe(scoreBucketsDescription),
        includeLowRelevance: z.boolean().optional().describe(includeLowRelevanceDescription),
        minScore: z.number().int().min(0).max(100).optional().describe(minScoreDescription),
        keywords: z
          .array(z.string())
          .optional()
          .describe(
            'Keyword texts whose mentions to include: the value field of a keyword in list_websites or get_website, not its id. Each must match the whole keyword, ignoring case, so "crm" does not match "best crm". Omit for every keyword',
          ),
        sources: z.array(MentionSource).optional().describe(sourcesDescription),
        sort: MentionSort.optional().describe(
          'Order of the rows: RELEVANCE puts the highest score first, RECENT the newest first. Omit for RELEVANCE',
        ),
        from: z.string().optional().describe(fromDescription),
        to: z.string().optional().describe(toDescription),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .default(50)
          .describe('How many mentions to return in this page'),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .default(0)
          .describe('How many matching mentions to skip; add limit to it to fetch the next page while it stays below total'),
      },
      outputSchema: resultSchema(
        z
          .object({
            mentions: z.array(mentionOutput),
            total: z.number().int().describe('Mentions matching the filters, before paging'),
            limit: z.number().int(),
            offset: z.number().int(),
          })
          .passthrough(),
      ),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (input, client) => {
      try {
        return toolResult(await client.get('/mentions', input));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  tool(
    'count_mentions',
    {
      title: 'Count Mentions',
      description:
        "Count mentions matching the same filters as list_mentions, returning { total } and no rows. The same defaults apply: REJECTED excluded unless statuses includes it, and scores below the website's minimum (30 by default) hidden unless includeLowRelevance is true. Use it for dashboards, to size a triage batch, or to decide whether paging list_mentions is worthwhile; list_mentions already returns total with its rows, so skip this when you fetch rows anyway. Takes no sort, limit, or offset.",
      inputSchema: {
        websiteId: z.string().uuid().optional().describe(mentionWebsiteIdDescription),
        statuses: z.array(MentionStatus).optional().describe(mentionStatusDescription),
        scoreBuckets: z.array(RelevanceBucket).optional().describe(scoreBucketsDescription),
        includeLowRelevance: z.boolean().optional().describe(includeLowRelevanceDescription),
        minScore: z.number().int().min(0).max(100).optional().describe(minScoreDescription),
        keywords: z
          .array(z.string())
          .optional()
          .describe(
            'Keyword texts whose mentions to count: the value field of a keyword in list_websites or get_website, not its id. Each must match the whole keyword, ignoring case. Omit for every keyword',
          ),
        sources: z.array(MentionSource).optional().describe(sourcesDescription),
        from: z.string().optional().describe(fromDescription),
        to: z.string().optional().describe(toDescription),
      },
      outputSchema: resultSchema(
        z
          .object({
            total: z
              .number()
              .int()
              .describe('Mentions matching the filters after the default exclusions'),
          })
          .passthrough(),
      ),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (input, client) => {
      try {
        return toolResult(await client.get('/mentions/count', input));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  tool(
    'update_mention_status',
    {
      title: 'Update Mention Status',
      description:
        "Set one mention's triage status. APPROVED marks it a real lead; REJECTED marks it noise and drops it from default list_mentions and count_mentions results (pass statuses to see it again); NEW returns it to the inbox. Fully reversible: any status can move to any other; reviewedAt is set to the time of each APPROVED or REJECTED call and cleared on NEW. Judge on the content and relevanceScore, calling explain_mention first when the score looks off; never approve a mention you have not read. mentionId comes from list_mentions. Returns the updated mention.",
      inputSchema: {
        mentionId: z.string().uuid().describe('ID of the mention to triage, from list_mentions'),
        status: MentionStatus.describe(
          'Triage verdict: APPROVED marks a real lead, REJECTED marks noise and hides it from default lists, NEW puts it back in the inbox',
        ),
      },
      outputSchema: resultSchema(mentionOutput),
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ mentionId, status }, client) => {
      try {
        return toolResult(
          await client.patch(`/mentions/${mentionId}/status`, { status }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  tool(
    'explain_mention',
    {
      title: 'Explain Mention and Draft Reply',
      description:
        'Get the AI relevance reasoning (relevanceReason), tags, and a drafted reply (aiReplySuggestion) for one mention, generating whatever is missing on first call and storing it, so later calls are instant reads. The website must have a description; without one the mention comes back unchanged. Use it when a score looks wrong or before update_mention_status on a borderline lead, not across every row of list_mentions, since generation is slow. Returns the full mention object, or null (not a 404) when the ID is unknown to this account.',
      inputSchema: {
        mentionId: z.string().uuid().describe('ID of the mention to explain, from list_mentions'),
      },
      outputSchema: resultSchema(
        mentionOutput
          .nullable()
          .describe('The mention with relevanceReason, tags and aiReplySuggestion filled in; null when the mention is not found'),
      ),
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ mentionId }, client) => {
      try {
        return toolResult(await client.post(`/mentions/${mentionId}/explain`));
      } catch (error) {
        return toolError(error);
      }
    },
  );


  tool(
    'get_alert_settings',
    {
      title: 'Get Alert Settings',
      description:
        "Get the account's email-alert settings: enabled, cadenceMinutes (the digest interval in effect), minIntervalMinutes (the fastest cadence the plan allows), and availableCadences (the subset of 15, 30, 60, 120, 180, 240, 720, 1440 at or above that floor). cadenceMinutes is never reported below the floor, even if a faster value was saved before a plan downgrade. Call it before update_alert_settings to pick a value from availableCadences, and after it to confirm what applied. Read-only; the digests themselves are sent by the platform on that cadence.",
      inputSchema: {},
      outputSchema: resultSchema(alertSettingsOutput),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (_args, client) => {
      try {
        return toolResult(await client.get('/alert-settings'));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  tool(
    'update_alert_settings',
    {
      title: 'Update Alert Settings',
      description:
        'Turn mention email alerts on or off and set how often the digest is sent. enabled is required on every call. A cadenceMinutes faster than the plan floor is silently raised to the floor. Both settings are replaced on every call: omitting cadenceMinutes resets it to the fastest cadence the plan allows, so pass the current value when only toggling enabled. Use get_alert_settings for availableCadences before calling. Returns the settings now in effect: enabled, cadenceMinutes after any raise to the plan floor, minIntervalMinutes (the fastest cadence the plan allows) and availableCadences, so no follow-up read is needed.',
      inputSchema: {
        enabled: z.boolean().describe('true sends mention digest emails, false stops them'),
        cadenceMinutes: AlertCadenceMinutes
          .optional()
          .describe(
            'Minutes between digest emails, e.g. 60 for hourly or 1440 for daily. Pick one from availableCadences in get_alert_settings, since a value faster than the plan allows is raised to the plan floor. Omit to reset to the fastest cadence the plan allows',
          ),
      },
      outputSchema: resultSchema(alertSettingsOutput),
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async (input, client) => {
      try {
        return toolResult(await client.put('/alert-settings', input));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  return server;
}


const SSE_ACCEPT = 'application/json, text/event-stream';

// The MCP SDK 406s unless Accept lists both types. `@hono/node-server` v1 rebuilds the
// request from rawHeaders, so headers.accept alone is not enough.
const MAX_BODY_BYTES = 4 * 1024 * 1024;

type JsonRpcRequest = { id?: string | number | null; method?: string };

const readJsonBody = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : undefined);
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });

const sendJsonRpcError = (
  res: ServerResponse,
  status: number,
  id: JsonRpcRequest['id'],
  code: number,
  message: string,
) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }));
};

const isDiscoverRequest = (body: unknown): body is JsonRpcRequest =>
  !!body && typeof body === 'object' && (body as JsonRpcRequest).method === 'server/discover';

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
        await reqServer.connect(withoutSchemaDialect(transport));
        try {
          let parsedBody: unknown;
          if (req.method === 'POST') {
            try {
              parsedBody = await readJsonBody(req);
            } catch {
              sendJsonRpcError(res, 400, null, -32700, 'Parse error');
              return;
            }
            if (isDiscoverRequest(parsedBody)) {
              sendJsonRpcError(res, 200, parsedBody.id, -32601, 'Method not found');
              return;
            }
          }
          await transport.handleRequest(req, res, parsedBody);
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
    await server.connect(withoutSchemaDialect(transport));
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
