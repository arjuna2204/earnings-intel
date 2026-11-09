import type { MetadataRoute } from "next";

/** Keep the site out of search engines (it's public but not promoted). */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
