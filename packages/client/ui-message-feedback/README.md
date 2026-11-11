# @xrkseek/client-ui-message-feedback

English | [中文](README.zh.md)

Session feedback plugin (browser half): a dialog on `conversation.input.overlay`, opened by bare `/feedback` (typed `/feedback <text>` stays on the Host). Per-message Like/Dislike chrome was removed from the assistant IconActions strip.

`MessageFeedbackController` remains for Host `messageFeedback` remotes used when a dialog targets a message; mutations still use compare-and-set versions.

The `/client` exports are the plugin body (`apply`/`inject`), dialog types, and controller types.

## Model Experience

None. Feedback is a sidecar and never enters the Session log or model context.

## Known Limitations

- Note size is Host policy (`maxNoteBytes`); oversized notes fail on save.
- No cross-tab push for ratings.
