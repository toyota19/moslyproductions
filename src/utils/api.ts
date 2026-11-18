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
