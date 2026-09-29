export default function sitemap() {
  const base = "https://www.track3d.co.uk";
  return ["", "/login", "/signup", "/forgot-password", "/privacy", "/terms"].map(path => ({ url: `${base}${path}`, lastModified: new Date(), changeFrequency: path ? "monthly" : "weekly", priority: path ? 0.6 : 1 }));
}
