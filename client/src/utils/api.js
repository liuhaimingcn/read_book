export async function safeJson(res) {
  const text = await res.text()
  if (!text || !text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}
