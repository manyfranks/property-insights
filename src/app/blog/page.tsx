import type { Metadata } from "next";
import Link from "next/link";
import { BLOG_POSTS } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Blog — Real Estate Insights for Canadian Buyers",
  description:
    "Guides, analysis, and data-driven insights for Canadian home buyers. Learn about property assessments, offer strategies, and market signals.",
  alternates: { canonical: "/blog" },
};

export default function BlogIndex() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-8 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight mb-2">Blog</h1>
      <p className="text-sm text-muted mb-10">
        Guides and analysis for Canadian home buyers.
      </p>

      <div className="space-y-6">
        {BLOG_POSTS.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="block border border-border rounded-xl p-5 hover:shadow-md hover:-translate-y-0.5 transition-all"
          >
            <div className="flex items-center gap-3 text-xs text-muted mb-2">
              <time dateTime={post.publishedAt}>
                {new Date(post.publishedAt).toLocaleDateString("en-CA", {
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
              {post.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full"
                >
                  {tag}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
