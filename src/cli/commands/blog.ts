import type { Command } from "commander";
import { readFile } from "node:fs/promises";
import { blogRequest } from "../../core/marketing/blog.js";
import { loadConfig } from "../../core/config/load.js";
export function registerBlogCommands(program: Command): void {
  const blog = program
    .command("blog")
    .description("Publish articles to the Lemonade and CineGen websites");
  blog
    .command("read <product> <slug>")
    .action(async (product: string, slug: string) => {
      const { env } = loadConfig();
      console.log(
        JSON.stringify(
          await blogRequest(
            product,
            { slug },
            { read: true, offline: env.SIGNAL_OFFLINE === "1", env },
          ),
          null,
          2,
        ),
      );
    });
  blog
    .command("save <product> <file>")
    .option("--publish", "Publish this exact article publicly")
    .option("--archive", "Remove this article from public access")
    .action(
      async (
        product: string,
        file: string,
        options: { publish?: boolean; archive?: boolean },
      ) => {
        if (options.publish && options.archive)
          throw new Error("Choose publish or archive");
        const input = JSON.parse(await readFile(file, "utf8")) as Record<
          string,
          unknown
        >;
        const { env } = loadConfig();
        console.log(
          JSON.stringify(
            await blogRequest(
              product,
              {
                ...input,
                status: options.publish
                  ? "published"
                  : options.archive
                    ? "archived"
                    : "draft",
              },
              {
                allowPublish: !!(options.publish || options.archive),
                offline: env.SIGNAL_OFFLINE === "1",
                env,
              },
            ),
            null,
            2,
          ),
        );
      },
    );
}
