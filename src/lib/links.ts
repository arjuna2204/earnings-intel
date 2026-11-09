/** Deep link to a passage in an SEC document: the browser opens the filing, scrolls to the quoted
 * text and highlights it (URL text fragments — Chrome, Edge, Safari 16.1+, Firefox 131+). */
export function quoteLink(url: string | null | undefined, quote: string | null | undefined): string | null {
  if (!url) return null;
  if (!quote || url.startsWith("?")) return url;
  // Table rows are stored with " | " between cells; the page has no such characters, so use the longest cell.
  const chunk = quote
    .split("|")
    .map((s) => s.trim())
    .sort((a, b) => b.length - a.length)[0]
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  if (chunk.length < 4) return url;
  const words = chunk.split(" ");
  const enc = (s: string) => encodeURIComponent(s).replace(/-/g, "%2D").replace(/,/g, "%2C").replace(/&/g, "%26");
  const frag = words.length <= 10 ? enc(chunk) : `${enc(words.slice(0, 5).join(" "))},${enc(words.slice(-5).join(" "))}`;
  return `${url.split("#")[0]}#:~:text=${frag}`;
}
