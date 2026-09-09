# LocLM

LocLM is a local-first, Electron + React + Vite AI management app. It offers chats organized into projects, locally running OpenAI-compatible models, screenshot capture, document processing, web search, and Gmail integration.

## Main features

- Projects that can be created, renamed, and deleted, each with its own chat history.
- Searchable project folder for images and documents, with open and show-in-folder actions; project files are automatically available as context to local and Grok models.
- LM Studio and other OpenAI-compatible local endpoints, plus Grok subscriptions through Grok CLI authentication.
- Streaming model responses and the ability to stop generation.
- Collapsible, live thinking workflow; separate display of `reasoning_content` and `<think>` blocks published by reasoning models.
- Global, remappable screenshot shortcut (`Ctrl+Shift+S`).
- Forwarding PNG/JPEG/WebP images and screenshots to vision models.
- Reading PDF, Word, text, Markdown, JSON, and CSV.
- Exporting AI responses to Word or PDF.
- API-key-free, hidden Chromium-based web search with DuckDuckGo/Bing fallback; optional Brave Search or your own SearXNG.
- Gmail OAuth, search, full email threads, labels, archiving, and drafts.
- Automatic updates via GitHub Releases.
- Light, dark, and system-matching theme.
- English UI by default, with Hungarian available in Settings.
- Custom lightning LocLM branding and a native-feeling custom Electron title bar.

## Developer start

Requirements:

- Node.js 24+
- pnpm 11+
- Windows, macOS, or Linux desktop environment

```bash
pnpm install
pnpm dev
```

Production build and Electron package:

```bash
pnpm build
pnpm dist
```

Automated Electron smoke test:

```bash
pnpm test:smoke
```

## Grok subscription

LocLM uses the same session as Grok CLI (`~/.grok/auth.json`). With a SuperGrok or X Premium+ account, you can chat without an API key.

1. Open Settings → AI and select **Grok** as the provider.
2. If you are already signed in through `grok login`, LocLM detects the session automatically.
3. Otherwise, press **Sign in with Grok** and complete sign-in in your system browser.
4. Test the connection, then select one of the listed Grok models, such as `grok-4.6`.

Messages sent through the Grok provider use xAI's Grok CLI proxy (`cli-chat-proxy.grok.com`), while local models continue to use the configured OpenAI-compatible endpoint.

## LM Studio setup

1. Start a model in LM Studio's Local Server view.
2. On LocLM Settings → Local AI, enter the endpoint, for example `http://127.0.0.1:1234/v1`.
3. Press the Test connection button.
4. Select the listed model.
5. For image processing, use a vision-capable model.

## Gmail OAuth

Connecting Gmail requires a Google Cloud Desktop OAuth client:

1. Create a project in Google Cloud Console.
2. Enable the Gmail API.
3. Set up the OAuth consent screen.
4. Create a Desktop app type OAuth client ID.
5. Copy the client ID into LocLM Settings → Plugins → Gmail.

LocLM performs login in the system browser, using PKCE and a temporary localhost callback. Tokens are encrypted with Electron `safeStorage`. Google may require OAuth verification for public distribution of Gmail scopes.

## Web search

- Built-in browser: this is the default and works without an API key. LocLM searches DuckDuckGo in an isolated, hidden Electron/Chromium window, with Bing as fallback if needed, then only passes cleaned titles, URLs, and snippets to the model.
- Brave Search: enter the Brave Search API key under Plugins.
- SearXNG: select the SearXNG provider, then enter your own instance URL.

The built-in browser is ready to use immediately. A test search can be run with any provider in settings; on a successful response LocLM shows the number of results, and on error it prints the problem directly.

When the Web button is turned on, the next message's web results are included in the model context, together with the source URLs.
Next to the assistant's reply, a separate Sources panel lists every result's title, domain, and snippet as openable items; these are saved together with the chat history.

## Automatic updates

`electron-updater` uses GitHub Releases. `.github/workflows/release.yml` builds and publishes Windows, macOS, and Linux packages when a `v*` tag is pushed.

```bash
pnpm version patch
git push --follow-tags
```

For production automatic updates, Windows and macOS packages must be released with code signing. Provide the required certificates as GitHub Actions secrets (`CSC_LINK`, `CSC_KEY_PASSWORD`, and the Apple notarization variables).

## Security model

- The renderer does not get Node.js access.
- `contextIsolation` and the Electron sandbox are enabled.
- The preload only exposes typed, allowed IPC operations.
- Local model and search keys, as well as Gmail tokens, go into encrypted storage.
- Sending Gmail requires a separate user action.
- Only HTTP(S) URLs can be opened as external links.

## Project structure

```text
src/main/       Electron main process and services
src/preload/    Typed, isolated IPC bridge
src/renderer/   React UI
src/shared/     Shared TypeScript types
scripts/        Automated smoke test
```
