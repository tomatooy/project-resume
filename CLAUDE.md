# CLAUDE.md

Read `AGENTS.md` in this repo first. It is the full baseline guidance
(architecture, conventions, commands) and applies to Claude Code as written.

## Never use browser automation

Do not use Claude in Chrome (`mcp__claude-in-chrome__*`), Puppeteer,
Playwright, headless Chrome, or Chrome DevTools MCP in this project. Do not
start or drive a dev server to confirm a change works.

The user verifies UI manually. After a UI change, stop and say what to look at:
the route, the panel or section, and what should now be different.

Verify with static checks instead: `bun run typecheck`, `bun run check`, and
reading the code.

Exception: only drive a browser if the user explicitly asks for it in that
message.
