export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function cityToSlug(city: string): string {
  return city.toLowerCase().replace(/\s+/g, "-");
}

export function fmt(n: number): string {
  return "$" + n.toLocaleString();
}

export function pct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}
