import { describe, expect, it, vi } from "vitest";
import { blogRequest } from "../../src/core/marketing/blog.js";
const post = {
  slug: "practical-ai",
  title: "A practical AI guide",
  description: "How to get useful work done with your own AI tools.",
  author: "Lemonade",
  body: "Grounded useful advice. ".repeat(10),
  status: "draft",
  expectedVersion: 0,
};
const env = { SIGNAL_LEMONADE_PUBLISH_KEY: "test-key" };
describe("website publishing", () => {
  it("pins the product destination and sends credentials only without redirects", async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            slug: post.slug,
            status: "draft",
            version: 1,
            url: "https://siplemona.de/writing/" + post.slug,
          }),
        ),
      );
    const result = await blogRequest("lemonade", post, { env, fetch: send });
    expect(result.status).toBe("draft");
    expect(String(send.mock.calls[0]![0])).toBe(
      "https://siplemona.de/api/content/posts",
    );
    expect(send.mock.calls[0]![1]).toMatchObject({
      redirect: "error",
      method: "PUT",
      headers: { Authorization: "Bearer test-key" },
    });
  });
  it("requires configuration and does not publish in offline mode", async () => {
    const send = vi.fn<typeof fetch>();
    await expect(
      blogRequest("lemonade", post, { env: {}, fetch: send }),
    ).rejects.toThrow("Configure");
    await expect(
      blogRequest("lemonade", post, { env, fetch: send, offline: true }),
    ).rejects.toThrow("offline");
    await expect(
      blogRequest("toString", post, { env, fetch: send }),
    ).rejects.toThrow("destination");
    expect(send).not.toHaveBeenCalled();
  });
  it("blocks publishing and archiving until the owner enables it", async () => {
    const send = vi.fn<typeof fetch>();
    for (const status of ["published", "archived"])
      await expect(
        blogRequest("lemonade", { ...post, status }, { env, fetch: send }),
      ).rejects.toThrow("owner");
    expect(send).not.toHaveBeenCalled();
  });
  it("surfaces conflicts without echoing response content or credentials", async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("private data", { status: 409 }));
    await expect(
      blogRequest("lemonade", post, { env, fetch: send }),
    ).rejects.toThrow("read the latest version");
  });
  it("returns the actual published status with explicit authorization", async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            slug: post.slug,
            status: "published",
            version: 1,
            url: "https://siplemona.de/writing/" + post.slug,
          }),
        ),
      );
    expect(
      (
        await blogRequest(
          "lemonade",
          { ...post, status: "published" },
          { env, fetch: send, allowPublish: true },
        )
      ).status,
    ).toBe("published");
  });
  it("does not let a draft-only agent remove a live article", async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ ...post, status: "published", version: 1 }),
        ),
      );
    await expect(
      blogRequest(
        "lemonade",
        { ...post, expectedVersion: 1 },
        { env, fetch: send },
      ),
    ).rejects.toThrow("remove it from the website");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![1]?.method).toBe("GET");
  });
});
