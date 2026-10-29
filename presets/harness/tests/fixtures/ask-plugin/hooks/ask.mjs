// Fixture: blocks on $.ui.ask during session.start. The harness test supplies
// a mock userQuestions service that answers "yes" without a UI.

export function register(on) {
  on("session.start", {}, async ($, e, next) => {
    const answer = await $.ui.ask("continue?", { options: ["yes", "no"] });
    $.ui.log("ask-answer=" + answer + "; interactive=" + String(e.isInteractive));
    return next(e);
  });
}
