import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getBlogPost, BLOG_POSTS } from "@/lib/blog";
import { BASE_URL } from "@/lib/seo";
import { JsonLd } from "@/components/json-ld";

export async function generateStaticParams() {
  return BLOG_POSTS.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) return { title: "Post Not Found" };

  const url = `${BASE_URL}/blog/${post.slug}`;
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: url },
    openGraph: {
      title: post.title,
      description: post.description,
      url,
      type: "article",
      publishedTime: post.publishedAt,
    },
    twitter: {
      card: "summary",
      title: post.title,
      description: post.description,
    },
  };
}

// Dynamic import for each post's content component
async function getPostContent(slug: string) {
  try {
    const mod = await import(`./posts/${slug}`);
    return mod.default;
  } catch {
    return null;
  }
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();

  const Content = await getPostContent(slug);
  if (!Content) notFound();

  return (
    <main className="max-w-3xl mx-auto px-6 py-8 sm:py-16">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Article",
          headline: post.title,
          description: post.description,
          datePublished: post.publishedAt,
          dateModified: post.updatedAt || post.publishedAt,
          author: {
            "@type": "Person",
            name: "Matt Francis",
          },
          publisher: {
            "@type": "Organization",
            name: "Property Insights",
            url: BASE_URL,
          },
          mainEntityOfPage: `${BASE_URL}/blog/${post.slug}`,
        }}
      />

      <Link
        href="/blog"
        className="text-sm text-muted hover:text-foreground transition-colors"
      >
        &larr; Blog
      </Link>

      <div className="mt-6 mb-8">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3">
          {post.title}
        </h1>
        <div className="flex items-center gap-3 text-xs text-muted">
          <time dateTime={post.publishedAt}>
            {new Date(post.publishedAt).toLocaleDateString("en-CA", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </time>
          <span>{post.readingTime}</span>
        </div>
      </div>

      <article className="prose-custom">
        <Content />
      </article>

      <div className="mt-12 pt-6 border-t border-border">
        <Link
          href="/blog"
          className="text-sm text-muted hover:text-foreground transition-colors"
        >
          &larr; Back to all posts
        </Link>
      </div>
    </main>
  );
}
