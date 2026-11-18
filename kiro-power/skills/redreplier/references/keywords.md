# Choosing keywords

Every active keyword counts toward the plan's keyword limit, so each one has to earn its place.

## Good keywords

- **The problem, in the buyer's words.** "simple crm for freelancers", "track leads without a
  spreadsheet".
- **Competitor alternatives.** "hubspot alternative", "pipedrive too expensive".
- **Category plus a qualifier.** "crm for agencies", "lightweight crm".
- **The product's own name**, to catch people already talking about it.

## Weak keywords

- Single generic words ("crm", "sales"). They match thousands of conversations that are not leads
  and bury the good ones. The grader may also suspend them as too noisy.
- Internal jargon no customer would type.
- Near-duplicates of an active keyword. Values are lowercased and deduplicated, but "crm for
  agency" and "crm for agencies" are two keywords.

## Maintaining them

- Run `list_mentions` filtered by `keywords` to see what one keyword brings in. A keyword whose
  mentions are mostly rejected should be edited or disabled.
- `edit_keyword` changes the text and keeps the ID. Edits are unlimited. It is also the fix for a
  `SUSPENDED` keyword.
- `disable_keyword` pauses a keyword and keeps its mentions. `enable_keyword` resumes it if the
  plan has room. Neither charges.
- `delete_keyword` erases the keyword and every mention it produced. There is no undo, so prefer
  disabling.
- A full plan leaves new keywords `PENDING`. Disabling a weak keyword frees its slot, and a
  pending keyword moves into it at once. Otherwise only the user can raise the limit, in the
  RedReplier app.

Suggest changes as a short list (keyword, why, expected effect) and apply them after a "yes".
