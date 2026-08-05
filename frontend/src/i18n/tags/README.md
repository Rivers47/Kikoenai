# Tag display-name translation maps

Each `*.json` file maps the **canonical Japanese tag name** (as stored by the
backend in `t_tag.name`) to the translated name for that locale:

```json
{ "<canonical_ja_name>": "<translated_name>" }
```

- Keys are canonical Japanese names. The backend canonicalizes scraped names via
  `backend/scraper/tag-aliases.json` (see `backend/AGENTS.md` §2.3), so the
  frontend only ever sees canonical names here.
- `ja-JP` needs no file — Japanese is the identity language.
- `zh-TW` falls back to `zh-CN` for any missing key.
- Unmapped tags fall back to the Japanese name (no empty chips).
- These are **hand-maintained**. Files must be valid JSON (no comments).
