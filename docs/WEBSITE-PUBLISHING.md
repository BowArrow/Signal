# Publish website articles

Signal marketing agents can use `blog.read` and `blog.save` with the Lemonade and CineGen websites. These tools are separate from community reply publishing.

Set each project's private API credential in Signal's environment:

```dotenv
SIGNAL_LEMONADE_PUBLISH_KEY=<Lemonade project SIGNAL_PUBLISH_KEY>
SIGNAL_CINEGEN_PUBLISH_KEY=<CineGen project SIGNAL_PUBLISH_KEY>
SIGNAL_LEMONADE_AUTO_PUBLISH=false
SIGNAL_CINEGEN_AUTO_PUBLISH=false
```

Restart Signal after configuring credentials. Drafts can be saved with these flags false. Set the product's flag true to authorize that product's agent to publish or archive articles on the owned website. Product destinations are pinned to `https://siplemona.de` and `https://cinegenaimedia.com`; models cannot supply an alternate URL. Offline mode blocks these calls. Credentials never enter agent context or tool results.

The owner can publish an exact JSON article through `npm.cmd run signal -- blog save lemonade article.json --publish`, or use `cinegen` for CineGen. Omit `--publish` to save a draft. `blog read <product> <slug>` returns the current version; updates must use that version in `expectedVersion`. Conflicts return a visible error rather than overwriting another edit.

See the [shared implementation and deployment guide](../../Lemonade/docs/GROWTH-SYSTEM.md) for the JSON contract, website setup and validation. These endpoints must be deployed and configured before the tools can succeed against production.
