[中文](README.md) | [English](README_EN.md)

# Reed · 芦苇

> “Man is but a reed, the most feeble thing in nature; but he is a thinking reed.”
> — Blaise Pascal, [Pensées, §347](https://www.gutenberg.org/files/18269/18269-h/18269-h.htm#SECTION_VI)

**One Markdown document. A WeChat article, Xiaohongshu cards and a long image.**

Reed is a free, open-source typesetting tool that runs in your browser: no installation, no account. In the same workspace you can also build interactive WeChat stories that respond to scrolling and tapping, or let an AI edit the article you are working on.

**[Open Reed](https://wechat.yoru-and-akari.dev)** · [Browse the theme library](https://wechat.yoru-and-akari.dev/themes) · [AI writing Skill](https://wechat.yoru-and-akari.dev/skill.md)

**⭐ If Reed saves you time, please star the repository so more creators can find it.**

![One Markdown source typeset as a WeChat article, Xiaohongshu cards and a long image](docs/images/reed-one-source-three-outputs.png)

## Why Reed

- **Open it and start.** Free and open source. No sign-up, no membership; every theme and template is ready to use.
- **One draft, three outputs.** WeChat articles, Xiaohongshu cards and long images share one Markdown source. Switch modes in the top bar and edit once; all three outputs follow.
- **Pastes cleanly into WeChat.** Reed produces the fully inline HTML the WeChat editor accepts. All <!-- gen:theme-count -->227 themes<!-- /gen:theme-count --> are checked against WeChat's rules, and each one credits its author, source and license.
- **Your AI can edit the article you have open.** Authorize the current document for Claude Code, OpenCode or another Remote MCP client; its edits appear in your browser live. No account needed.

## Four modes

| WeChat articles | Xiaohongshu cards |
|:--:|:--:|
| ![Reed's WeChat mode with Markdown editing and article preview](docs/images/reed-wechat-editor.png) | ![Reed's Xiaohongshu card mode with pagination and template thumbnails](docs/images/reed-xiaohongshu-cards.png) |
| See the layout as you write. Trial themes on your own article, compare up to three side by side, then paste the result into WeChat | Automatic pagination and cover. Switch templates, ratios, colors and fonts, then export 1080px PNGs or a ZIP |
| **Long images** | **Interactive stories** |
| ![Reed's long-image mode with an event recap template and export settings](docs/images/reed-long-image.png) | ![Motion composer with element panel, canvas and interaction steps](docs/images/reed-motion-composer.png) |
| Headings, a cover photo, sections and photo groups become one tall image, with consecutive photos in equal-height rows. Export 1080 / 1440px JPG or PNG | Arrange text, icons, emoji and illustrations, then decide what moves when the reader scrolls or taps. Five interaction patterns, copied into WeChat as one article |

Card and long-image templates can also be uploaded as your own `.reedcard` files. See the [feature list](docs/features_EN.md) for everything else.

## Why I built Reed

My job involves typesetting WeChat articles, and the same piece often has to become Xiaohongshu cards and an event recap image as well. The tools I used either wanted a login and a paid membership for the good templates, or did not support Markdown. One article meant redoing the layout in several tools, and pasting into the WeChat editor still broke the formatting, which I then fixed by hand.

Once AI started drafting for me, this felt even more awkward: the draft took seconds, and the typesetting was still manual work.

So I built Reed: write the draft once, get all three outputs, and let AI take part directly. I use it every day, and it keeps improving through real publishing work.

— Yoru

## Create with AI

- **Draft with your own AI.** Open **AI 帮我写** (Help me write) and give the prompt or the [writing Skill](skills/wechat-typesetter/SKILL.md) to ChatGPT, Claude, Codex or another AI. Paste the Markdown back into Reed for refining. The Skill is currently written in Chinese.
- **Make diagrams with your own AI.** Open **AI 画图表** (Diagram with AI) and give the prompt and the [diagram-design-zh](https://github.com/patrick-xin/diagram-design-zh) Skill to your AI, then insert the PNG it returns (Chinese adaptation by patrick-xin, MIT, based on [Cathryn Lavery's original](https://github.com/cathrynlavery/diagram-design)).
- **Let an AI edit the current article.** Under **Settings → Advanced → AI directly edits current document**, create a Remote MCP connection authorized for that article only. The AI reads and writes the draft, your browser updates live, and conflicting edits pause for your decision. [Remote MCP guide](docs/remote-mcp.md)

## Markdown at a glance

Standard headings, lists, inline formatting, fenced code blocks and GFM tables work alongside these extensions:

| Syntax | Result |
|---|---|
| `==highlight==` | Highlighted words |
| `## KICKER \| Heading` | Automatically numbered section with an optional label |
| `> A memorable line` | Pull-quote card |
| `:::quote` / `:::center` … `:::` | Quotation box / centered emphasis |
| `![Caption](src)` | Image with an automatic figure number; an empty URL creates an upload placeholder |
| `![Caption](img:key)` | Existing hosted image reference; public HTTPS image URLs also work |
| `:::carousel 4:3 Title` … `:::` | Same-ratio carousel, default `4:3` |
| `:::gallery 3 1:1 Title` … `:::` | Image grid, default two square columns |
| A standalone `$$ … $$` block | Equation rendered as SVG; inline equations are not supported |
| A fence with language `mermaid` and an optional caption | Diagram rendered to PNG and uploaded |
| `@signature` | Article credits block |
| `<!-- Note -->` | Source-only editorial note; remains literal inside code fences |
| Front matter `titles` / `cover` | Title candidates / cover suggestion, shown only in the side panel |

Use the [sample article](src/lib/sample.ts) and [Skill](skills/wechat-typesetter/SKILL.md) as examples. Cropping, equations and WeChat HTML constraints are documented in [Rendering and images](docs/rendering.md). Most technical documentation is currently in Chinese.

## Owner features (self-hosted)

Most of Reed works without signing in. The features below need the site owner's login: on wechat.yoru-and-akari.dev they are open only to the owner, and on your own deployment, you are the owner.

- **Cloud drafts**: articles and interactive stories saved on the server and synchronized across devices, with conflict handling. See [Documents and editor](docs/documents.md).
- **Cloud template library**: uploaded card and long-image templates sync across devices, including deletions.
- **Agent REST API**: with a dependency-free Python client, an agent pushes a draft, you refine it in the browser, and the agent reads it back. Writes are version-checked, so nothing is silently overwritten. See [Agent API](docs/agent-api.md).

## Self-host or contribute

Use Node.js 24:

```bash
npm ci
cp .env.example .env   # PowerShell: Copy-Item .env.example .env
npm run dev
```

Open `http://localhost:3000`. For local development, delete the `NODE_ENV` line as the comments in `.env.example` explain. Image hosting, secrets and production deployment are covered in [Configuration](docs/configuration.md); contributor rules and checks are in [AGENTS.md](AGENTS.md) and [Verification](docs/verification.md).

## Data and publishing boundaries

- **Drafts stay in your browser by default.** Enabling Remote MCP uploads a temporary copy of that one article, valid for 24 hours by default. Only you and clients holding that article's token can access it. Revocation deletes it immediately; expiry blocks access immediately and scheduled cleanup removes it. Your local draft remains.
- **Uploaded images are public.** Images are stored on this site's object storage, and anyone with an `/api/img/…` URL can view them. Anonymous uploads have quotas and a default 14-day cleanup period; a reference in a local draft does not guarantee indefinite hosting. Once WeChat has copied an image, the published article uses WeChat's stored version.
- **Authors and publishers are responsible for content.** The service checks file types, formats and quotas, and does not review article or image content. Illegal content, sexual content involving minors, infringing or privacy-violating content, malware, scams and bulk file-storage abuse are prohibited. Files can be deleted and further uploads refused.

Read the [Terms of use](https://wechat.yoru-and-akari.dev/terms). Rights complaints go through the in-site [feedback form](https://wechat.yoru-and-akari.dev/feedback) (or the editor sidebar under Settings → Feedback) with the exact URL, evidence of your rights or authorization, and contact details; no receiving address is published, and the server forwards the message. The hosted service may change, be limited or go offline; the software is provided without warranty. Self-hosters manage their own storage, domains and terms.

## How it's built

At its core, Reed is one rendering pipeline: `Markdown → semantic AST → theme → fully inline WeChat-compatible HTML`, shared by preview, copy and export. The WeChat editor is strict: one root `<section>`, no classes or stylesheets, every style inline, equations converted to SVG and diagrams to images.

The hardest bug to track down: while you edit, WeChat duplicates and merges outer `<section>` elements, and every extra layer made the text 20px narrower, so articles seemed to shrink inward further down the page. The fix was to fold all horizontal padding into `max-width`. These rules are now automated checks: `verify:themes` renders every theme and validates it against WeChat's rules, alongside 80+ test files and 60+ real-browser acceptance scripts. Details are in [Rendering and images](docs/rendering.md).

I handle product decisions, interface design and real-device testing; the code is written mainly together with AI coding tools such as Claude Code and Codex.

## License and sources

Reed is licensed under **AGPL-3.0-or-later**; see [LICENSE](LICENSE).

<!-- BEGIN GENERATED: readme-theme-sources — npm run sync:docs -->
The library contains **227 themes**: 3 originals and 224 adapted from 9 upstream projects. Authors, licenses and provenance are recorded in shared metadata.

See [THEME-SOURCES](THEME-SOURCES.md) for the audit. Project acknowledgements and adaptation notes come from [credits.ts](src/lib/credits.ts) and appear in [References](https://wechat.yoru-and-akari.dev/references) and [LICENSES/NOTICE](LICENSES/NOTICE.md).
<!-- END GENERATED: readme-theme-sources -->

More documentation: [Feature list](docs/features_EN.md) · [Documents and editor](docs/documents.md) · [Xiaohongshu cards](docs/xhs-cards.md) · [Template file format](docs/card-template-format.md) · [Long images](docs/long-image.md) · [Interactive stories](docs/motion.md) · [Brand and compatibility](docs/branding.md). Reed's Chinese name is **芦苇**; the repository name `wechat-md-studio` and existing domains stay unchanged.

**⭐ If you like Reed, a star helps.**
