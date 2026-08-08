import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BLOG_POSTS } from "@/lib/blog";
import { slugify } from "@/lib/utils";
import { SITE_NAME, BASE_URL } from "@/lib/seo";

/** Collect every unique tag slug from BLOG_POSTS */
function getAllTagSlugs(): string[] {
  const slugs = new Set<string>();
  for (const post of BLOG_POSTS) {
    for (const tag of post.tags) {
      slugs.add(slugify(tag));
    }
  }
  return Array.from(slugs);
}

/** Map from slug back to the original display label (first occurrence wins) */
function tagLabel(slug: string): string {
  for (const post of BLOG_POSTS) {
    for (const tag of post.tags) {
      if (slugify(tag) === slug) return tag;
    }
  }
  return slug;
}

export function generateStaticParams() {
  return getAllTagSlugs().map((tag) => ({ tag }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tag: string }>;
}): Promise<Metadata> {
  const { tag } = await params;
  const label = tagLabel(tag);
  const title = `Posts tagged '${label}' — ${SITE_NAME} Blog`;
  return {
    title,
    description: `All blog posts about ${label} on ${SITE_NAME}.`,
    alternates: { canonical: `${BASE_URL}/blog/tags/${tag}` },
  };
}

export default async function TagPage({
  params,
}: {
  params: Promise<{ tag: string }>;
}) {
  const { tag } = await params;
  const label = tagLabel(tag);
  const posts = BLOG_POSTS.filter((p) =>
    p.tags.some((t) => slugify(t) === tag)
  ).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  if (posts.length === 0) notFound();

  return (
    <main className="max-w-3xl mx-auto px-6 py-8 sm:py-16">
      <Link
        href="/blog"
        className="text-sm text-muted hover:text-foreground transition-colors"
      >
        &larr; All posts
      </Link>

      <h1 className="text-2xl font-semibold tracking-tight mt-4 mb-2">
        Posts tagged &lsquo;{label}&rsquo;
      </h1>
      <p className="text-sm text-muted mb-10">
        {posts.length} {posts.length === 1 ? "post" : "posts"}
      </p>

      <div className="space-y-6">
        {posts.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="block border border-border rounded-xl p-5 hover:shadow-md hover:-translate-y-0.5 transition-all"
          >
            <div className="flex items-center gap-3 text-xs text-muted mb-2">
              <time dateTime={post.publishedAt}>
                {new Date(post.publishedAt).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </time>
              <span>{post.readingTime}</span>
            </div>
            <h2 className="text-base font-medium text-foreground mb-1.5">
              {post.title}
            </h2>
            <p className="text-sm text-muted leading-relaxed">
              {post.description}
            </p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {post.tags.map((t) => (
                <span
                  key={t}
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    slugify(t) === tag
                      ? "bg-foreground text-background"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {t}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
