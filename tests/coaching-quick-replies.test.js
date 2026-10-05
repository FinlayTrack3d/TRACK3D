import test from "node:test";
import assert from "node:assert/strict";
import { isYesNoQuestion } from "../lib/coaching/quick-replies.js";

test("quick replies are offered only for yes/no questions", () => {
  assert.equal(isYesNoQuestion("Good session. Do you want to add weight next time?"), true);
  assert.equal(isYesNoQuestion("Nice work.\n- Should I move it to Friday?\n[MEMORY]notes[/MEMORY]"), true);
  assert.equal(isYesNoQuestion("What felt hardest today?"), false);
  assert.equal(isYesNoQuestion("Would you rather train Monday or Tuesday?"), false);
  assert.equal(isYesNoQuestion("Keep the next set controlled."), false);
});
