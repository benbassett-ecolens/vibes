-- Texts shared into a channel (not a DM): the bot's card is posted in a thread under the share.
ALTER TABLE slack_inbox ADD COLUMN thread_ts text;
