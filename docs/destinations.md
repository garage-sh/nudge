# Destinations

A Destination is where a Project's Feedback and Incidents go. A Member adds them in the dashboard, under the Project's **Destinations**; each one has a Feedback Filter and an Incident Filter, and either can be off. Any type can also be the Instance's Alert destination (Instance settings › Alert destination), which receives the alerts meant for Members.

Secrets (tokens, webhook URLs that carry a token) are stored encrypted and never shown again: leave the field empty when editing to keep the saved one.

| Type          | What it needs                                                      | What a Delivery creates                    |
| ------------- | ------------------------------------------------------------------ | ------------------------------------------ |
| Webhook       | An http(s) URL; nudge generates the signing secret                 | A signed POST, see [Webhooks](webhooks.md) |
| Discord       | A channel webhook URL                                              | A message in the channel                   |
| Slack         | An incoming webhook URL                                            | A message in the webhook's channel         |
| Telegram      | A bot token, a chat id and an optional forum topic                 | A message posted by the bot in the chat    |
| Linear        | A personal API key and a team key, optional labels                 | An issue in the team                       |
| GitHub Issues | A fine-grained access token (Issues: read and write), a repository | An issue in the repository                 |
| Email         | Recipients; the Instance's SMTP server (Instance settings)         | An email, with the Capture attached        |

How each type closes an Incident is in [Reporting Incidents](incidents.md#routing).

## Telegram

nudge posts through a Telegram bot, with the Bot API. Nothing but the bot token, the chat and the topic is configured: the API host is fixed.

1. **Create the bot.** In Telegram, send `/newbot` to [@BotFather](https://t.me/BotFather) and follow its questions. It answers with a token such as `123456789:AAH…`: that is the **Bot token**.
2. **Give the bot the chat.**
   - A group or a supergroup: add the bot as a member. In a group with topics, the bot can post in any topic.
   - A channel: add the bot as an administrator allowed to post messages.
   - A private chat with a person: that person opens the bot and presses **Start**; a bot cannot write first.
3. **Find the chat id.** Post a message in the chat (or mention the bot in a group), then open `https://api.telegram.org/bot<token>/getUpdates` in a browser: the id is `chat.id` in the answer. A group's id is negative, a supergroup's or a channel's starts with `-100`. A public channel can also be given as `@username`.
4. **Optional: a forum topic.** To post in one topic of a group with topics, give the topic's id: the last number of a link to the topic (`https://t.me/c/1234567890/7` → `7`). Empty, messages go to the chat itself.
5. In the dashboard, add a **Telegram** Destination with these values, then press **Test**.

What the chat receives:

- **Feedback**: its Type, Severity, Author when known, the text and a link to the Feedback in nudge. A Capture is sent with the message, as a photo whose caption is the message (a caption holds 1024 characters: a long text is cut, the dashboard has all of it). A Capture Telegram refuses as a photo (over 10 MB, too tall, media not allowed in the chat) leaves the message to go alone.
- **Incidents**: a message when one opens or its Level rises to reach this Destination, and on closing a reply to that opening message. Telegram only links to messages of supergroups and channels: in a private chat or a basic group, the Delivery has no link and the closing is a message of its own, titled "Closed · …".
- **Alerts**, when the Destination is the Instance's Alert destination.

The health check of a Suspended Destination calls `getMe` and `getChat`: it checks the token and the bot's access to the chat without posting anything. A rejected token (401), a bot removed from the chat or blocked by the person (403), and a chat or topic that no longer exists suspend the Destination; a rate limit (429) waits out a short `retry_after` once, and like a 5xx is otherwise retried later.
