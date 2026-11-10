/** Убирает HTML-теги, извлекая href из первой ссылки, и декодирует entities. */
export function stripHtml(value: string): { text: string; href: string | null } {
  const linkMatch = /<a\s[^>]*href="([^"]*)"[^>]*>[\s\S]*?<\/a>/i.exec(value)
  const href = linkMatch ? decodeEntities(linkMatch[1]!) : null
  const text = decodeEntities(value.replace(/<[^>]*>/g, '')).trim()
  return { text, href }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}
