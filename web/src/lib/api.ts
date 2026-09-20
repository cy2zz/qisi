const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`API request failed with status ${status}`);
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers,
  });

  if (!response.ok) {
    throw new ApiError(response.status);
  }

  return response.json() as Promise<T>;
}

export type ApiStreamEvent =
  | { message: string; type: 'status' }
  | { text: string; type: 'chunk' }
  | {
      currentVerdict?: 'correct' | 'incorrect' | 'unknown';
      routeAttribution?: 'student' | 'coauthored';
      type: 'done';
      version?: number;
    }
  | { message: string; type: 'error' };

function parseStreamEvent(block: string): ApiStreamEvent | null {
  const lines = block.split('\n');
  const event = lines.find((line) => line.startsWith('event: '))?.slice(7);
  const data = lines.find((line) => line.startsWith('data: '))?.slice(6);
  if (!event || !data) return null;

  const parsed = JSON.parse(data) as Record<string, unknown>;
  if (event === 'chunk' && typeof parsed.text === 'string') {
    return { text: parsed.text, type: 'chunk' };
  }
  if ((event === 'status' || event === 'error') && typeof parsed.message === 'string') {
    return { message: parsed.message, type: event };
  }
  if (event === 'done') {
    return {
      type: 'done',
      ...(parsed.currentVerdict === 'correct'
        || parsed.currentVerdict === 'incorrect'
        || parsed.currentVerdict === 'unknown'
        ? { currentVerdict: parsed.currentVerdict }
        : {}),
      ...(parsed.routeAttribution === 'student' || parsed.routeAttribution === 'coauthored'
        ? { routeAttribution: parsed.routeAttribution }
        : {}),
      ...(typeof parsed.version === 'number' ? { version: parsed.version } : {}),
    };
  }
  return null;
}

export async function apiStream(
  path: string,
  body: unknown,
  onEvent: (event: ApiStreamEvent) => void,
  signal?: AbortSignal,
) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    body: JSON.stringify(body),
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    signal,
  });
  if (!response.ok) throw new ApiError(response.status);
  if (!response.body) throw new Error('Streaming response body is unavailable');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replaceAll('\r\n', '\n');
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const event = parseStreamEvent(block);
      if (!event) continue;
      onEvent(event);
      if (event.type === 'done' || event.type === 'error') completed = true;
    }
    if (done) break;
  }

  if (!completed) throw new Error('Streaming response ended before completion');
}
