export const PERMISSION_DENIED = 'permission_denied';
export const SUBSCRIPTION_REQUIRED = 'subscription_required';
export const TOKEN_ISSUER_LOST_ACCESS = 'token_issuer_lost_access';
export const OAUTH_ACCOUNT_NOT_FOUND = 'oauth_account_not_found';
export const WORKSPACE_ACCESS_DENIED = 'workspace_access_denied';

const PRODUCT = 'RedReplier';
const PRODUCT_PERMISSION = 'redreplier.write';
const TOO_MANY_REQUESTS = 429;

export interface ApiErrorBody {
  statusCode?: number;
  error?: string;
  code?: string;
  requiredPermission?: string;
  role?: string;
  tokenType?: string;
  message?: string | string[];
}

const FINAL = 'Do not retry, do not look for another key.';

const messageOf = (body: ApiErrorBody, fallback: string) =>
  Array.isArray(body.message) ? body.message.join('; ') : (body.message ?? fallback);

const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

const waitFor = (retryAfter: string | null) =>
  retryAfter && /^\d+$/.test(retryAfter.trim())
    ? `Wait ${retryAfter.trim()} seconds (Retry-After)`
    : retryAfter
      ? `Wait until ${retryAfter} (Retry-After)`
      : 'Wait a minute';

const withCode = (status: number, code?: string) => (code ? `${status}, ${code}` : `${status}`);

function describe(
  status: number,
  body: ApiErrorBody,
  fallback: string,
  retryAfter: string | null,
): string {
  const apiMessage = messageOf(body, fallback);

  if (body.code === PERMISSION_DENIED) {
    const permission = body.requiredPermission ?? PRODUCT_PERMISSION;
    return `Permission denied (${status}, ${PERMISSION_DENIED}): the role "${body.role ?? 'unknown'}" lacks ${permission}. ${sentence(apiMessage)} Stop and tell the user a workspace admin has to give them the Admin or Editor role, which hold ${PRODUCT_PERMISSION}, or connect with a key from a member who has it. ${FINAL}`;
  }

  if (body.code === TOKEN_ISSUER_LOST_ACCESS) {
    return `This key no longer works (${status}, ${TOKEN_ISSUER_LOST_ACCESS}): the member who created it lost access to the workspace. Stop and ask the user for a key created by a current member. ${FINAL}`;
  }

  if (body.code === OAUTH_ACCOUNT_NOT_FOUND) {
    return `Wrong sign-in (${status}, ${OAUTH_ACCOUNT_NOT_FOUND}): ${sentence(apiMessage)} Tell the user exactly this and ask them to disconnect and reconnect with the email they use on ${PRODUCT}. No tool will work until they do. ${FINAL}`;
  }

  if (body.code === WORKSPACE_ACCESS_DENIED) {
    return `Workspace not available (${status}, ${WORKSPACE_ACCESS_DENIED}): ${sentence(apiMessage)} Call list_workspaces and pass one of the returned ids as workspaceId, or leave workspaceId out to use the default workspace.`;
  }

  if (body.code === SUBSCRIPTION_REQUIRED) {
    return `Subscription required (${status}, ${SUBSCRIPTION_REQUIRED}): ${sentence(apiMessage)} Every tool fails the same way until the organization renews or upgrades its ${PRODUCT} plan, so ask the user to do that. ${FINAL}`;
  }

  if (status === TOO_MANY_REQUESTS) {
    return `Rate limited (${withCode(status, body.code)}): ${sentence(apiMessage)} ${waitFor(retryAfter)} before the next call and do not retry in a loop.`;
  }

  return `API error (${withCode(status, body.code)}): ${apiMessage}`;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requiredPermission?: string;
  readonly role?: string;
  readonly tokenType?: string;
  readonly retryAfter: string | null;
  readonly apiMessage: string;

  constructor(status: number, body: ApiErrorBody, fallback: string, retryAfter: string | null) {
    super(describe(status, body, fallback, retryAfter));
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.requiredPermission = body.requiredPermission;
    this.role = body.role;
    this.tokenType = body.tokenType;
    this.retryAfter = retryAfter;
    this.apiMessage = messageOf(body, fallback);
  }
}

async function readErrorBody(response: Response): Promise<ApiErrorBody> {
  try {
    const parsed: unknown = await response.json();
    return parsed && typeof parsed === 'object'
      ? (parsed as ApiErrorBody)
      : { message: JSON.stringify(parsed) };
  } catch {
    return {};
  }
}

export class RestClient {
  constructor(
    private baseUrl: string,
    private apiToken: string,
    private workspaceId?: string,
  ) {}

  forWorkspace(workspaceId: string | undefined): RestClient {
    return workspaceId
      ? new RestClient(this.baseUrl, this.apiToken, workspaceId)
      : this;
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiToken}`,
        ...(this.workspaceId ? { 'X-Workspace-Id': this.workspaceId } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      throw new ApiError(
        response.status,
        await readErrorBody(response),
        `${response.status} ${response.statusText}`,
        response.headers.get('retry-after'),
      );
    }

    // DELETE and some POSTs may return empty bodies
    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  async get<T = unknown>(
    path: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    let queryString = '';
    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          for (const v of value) {
            searchParams.append(key, String(v));
          }
        } else {
          searchParams.append(key, String(value));
        }
      }
      const qs = searchParams.toString();
      if (qs) queryString = `?${qs}`;
    }
    return this.request<T>('GET', `${path}${queryString}`);
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async patch<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  async put<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  async delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }
}
