import { z } from "zod";

const targets = {
  lemonade: "https://siplemona.de",
  cinegen: "https://cinegenaimedia.com",
} as const;
export const blogPostSchema = z.object({
  slug: z
    .string()
    .min(3)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(5).max(160),
  description: z.string().trim().min(20).max(320),
  author: z.string().trim().min(2).max(100),
  body: z.string().trim().min(100).max(80000),
  status: z.enum(["draft", "published", "archived"]).default("draft"),
  expectedVersion: z.number().int().nonnegative().default(0),
});
export async function blogRequest(
  product: string,
  input: unknown,
  options: {
    read?: boolean;
    signal?: AbortSignal;
    offline?: boolean;
    allowPublish?: boolean;
    env?: Record<string, unknown>;
    fetch?: typeof fetch;
  } = {},
) {
  if (options.offline)
    throw new Error("Website publishing is unavailable in offline mode");
  if (!Object.hasOwn(targets, product))
    throw new Error("No publishing destination for this product");
  const env = options.env ?? process.env;
  const prefix = `SIGNAL_${product.toUpperCase()}`;
  const key = env[`${prefix}_PUBLISH_KEY`];
  if (typeof key !== "string" || !key)
    throw new Error(`Configure ${prefix}_PUBLISH_KEY to connect this website`);
  const url = new URL(
    "/api/content/posts",
    targets[product as keyof typeof targets],
  );
  let body: string | undefined;
  if (options.read) {
    const { slug } = blogPostSchema.pick({ slug: true }).parse(input);
    url.searchParams.set("slug", slug);
  } else {
    const post = blogPostSchema.parse(input);
    if (
      post.status === "draft" &&
      post.expectedVersion > 0 &&
      !options.allowPublish &&
      env[`${prefix}_AUTO_PUBLISH`] !== "true"
    ) {
      const previous = await blogRequest(
        product,
        { slug: post.slug },
        { ...options, read: true },
      );
      if (previous.status === "published")
        throw new Error(
          "Changing a published article to a draft would remove it from the website. Owner publishing authorization is required.",
        );
    }
    if (
      post.status !== "draft" &&
      !options.allowPublish &&
      env[`${prefix}_AUTO_PUBLISH`] !== "true"
    ) {
      throw new Error(
        "Publishing and archiving require the owner to enable automatic website publishing. Save a draft for review first.",
      );
    }
    body = JSON.stringify(post);
  }
  const response = await (options.fetch ?? fetch)(url, {
    method: options.read ? "GET" : "PUT",
    redirect: "error",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body }),
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)])
      : AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error(
      `Website publishing returned HTTP ${response.status}${response.status === 409 ? "; read the latest version before editing" : ""}`,
    );
  const result: unknown = await response.json();
  if (options.read)
    return blogPostSchema
      .omit({ expectedVersion: true })
      .extend({ version: z.number().int().positive() })
      .parse(result);
  return z
    .object({
      slug: z.string(),
      status: z.enum(["draft", "published", "archived"]),
      version: z.number().int().positive(),
      url: z.string().url(),
    })
    .parse(result);
}
