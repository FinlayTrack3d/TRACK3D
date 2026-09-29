export default function robots() {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/login", "/signup", "/forgot-password", "/privacy", "/terms"], disallow: ["/app", "/api/"] }],
    sitemap: "https://www.track3d.co.uk/sitemap.xml",
  };
}
