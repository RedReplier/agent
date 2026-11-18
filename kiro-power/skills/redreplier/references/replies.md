# Drafting replies

A reply that reads like an ad gets downvoted, removed, or the account banned. A reply that answers
the question and mentions the product as one option earns the click.

## Before drafting

- Read the whole mention (`contentText`), not only the title. Answer what the person asked.
- Know the product from the website description (`get_website`). If you do not know how the user
  wants to sound or what disclosure line they use, ask once and reuse the answer for the rest of
  the conversation.
- Start from `aiReplySuggestion` when `explain_mention` returned one, then rewrite it in the user's
  voice. Do not paste it unchanged.

## The shape

1. Answer the question in one to three sentences, with something useful even to a reader who never
   tries the product.
2. Mention the product once, as one option, with a disclosure line ("I make Acme, so I'm biased").
3. Say who it is not for when that is true. It builds more trust than another feature.
4. No links unless the user asks for one or the thread asks for tools. Many subreddits remove posts
   with links from new accounts.

Keep it short. Match the network: a Reddit or Hacker News comment can be a paragraph. An X reply
fits in 280 characters, a Bluesky reply in 300.

## Never

- Pose as a customer or a neutral bystander.
- Reply to a thread that is not asking for help or a tool. Say it is not a lead instead.
- Disparage a competitor by name.
- Suggest posting the same reply in several threads.

## Handing over

Give the draft ready to paste, then the `url` of the thread. Remind the user to check the
community's rules when the thread is in a subreddit they have not posted in before. After they
post, offer to mark the mention `APPROVED` with `update_mention_status`.
