export async function safeParseJson<T>(response: Response): Promise<T | null> {
  const raw = await response.text();
  if (!raw || !raw.trim()) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export interface JsonResponseResult<T> {
  data: T | null;
  isHtml: boolean;
  isEmpty: boolean;
  status: number;
}

export async function safeReadJson<T>(response: Response): Promise<JsonResponseResult<T>> {
  const raw = await response.text();
  const trimmed = raw.trim();
  if (!trimmed) {
    return { data: null, isHtml: false, isEmpty: true, status: response.status };
  }
  if (trimmed.startsWith('<')) {
    return { data: null, isHtml: true, isEmpty: false, status: response.status };
  }
  try {
    return {
      data: JSON.parse(trimmed) as T,
      isHtml: false,
      isEmpty: false,
      status: response.status,
    };
  } catch {
    return { data: null, isHtml: false, isEmpty: false, status: response.status };
  }
}
