export const WORKSPACE_ACCESS_DENIED = 'workspace_access_denied';

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
      let errorMessage: string;
      try {
        const errorBody = await response.json();
        errorMessage =
          (errorBody as { message?: string | string[] }).message !== undefined
            ? JSON.stringify((errorBody as { message: unknown }).message)
            : JSON.stringify(errorBody);
        if ((errorBody as { code?: string }).code === WORKSPACE_ACCESS_DENIED) {
          errorMessage = `${errorMessage} (403, ${WORKSPACE_ACCESS_DENIED}). Call list_workspaces and pass one of the returned ids as workspaceId, or leave workspaceId out to use the default workspace.`;
        }
      } catch {
        errorMessage = `${response.status} ${response.statusText}`;
      }
      throw new Error(`API error: ${errorMessage}`);
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
