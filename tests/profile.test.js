import test from "node:test";
import assert from "node:assert/strict";
import { ageFromDateOfBirth, formatDateOfBirth, isProfileComplete, normaliseProfile, profileChanges, profileProblem, profileUpdate, sexId, sexLabel } from "../lib/profile.js";

test("age comes from date of birth and changes on the birthday", () => {
  assert.equal(ageFromDateOfBirth("1991-03-12", "2026-03-11"), 34);
  assert.equal(ageFromDateOfBirth("1991-03-12", "2026-03-12"), 35);
  assert.equal(ageFromDateOfBirth("1991-03-12", "2026-10-05"), 35);
  assert.equal(ageFromDateOfBirth("2000-02-29", "2026-02-28"), 25);
  assert.equal(ageFromDateOfBirth("", "2026-10-05"), null);
  assert.equal(formatDateOfBirth("1991-03-12"), "12 Mar 1991");
});

test("profile rows are read safely", () => {
  assert.deepEqual(normaliseProfile({ height_cm: "178.0", date_of_birth: "1991-03-12", sex: "male" }), { heightCm: 178, dateOfBirth: "1991-03-12", sex: "male" });
  assert.deepEqual(normaliseProfile(null), { heightCm: null, dateOfBirth: null, sex: null });
  assert.equal(isProfileComplete(normaliseProfile({ height_cm: 178, sex: "male" })), false);
  assert.equal(isProfileComplete(normaliseProfile({ height_cm: 178, date_of_birth: "1991-03-12", sex: "prefer_not_to_say" })), true);
  assert.equal(sexLabel("prefer_not_to_say"), "Prefer not to say");
  assert.equal(sexId("Female"), "female");
});

test("the profile form is checked", () => {
  const today = "2026-10-05";
  assert.match(profileProblem({ heightCm: "", dateOfBirth: "1991-03-12", sex: "male" }, today), /height/);
  assert.match(profileProblem({ heightCm: 178, dateOfBirth: "", sex: "male" }, today), /date of birth/);
  assert.match(profileProblem({ heightCm: 178, dateOfBirth: "2027-01-01", sex: "male" }, today), /date of birth/);
  assert.match(profileProblem({ heightCm: 178, dateOfBirth: "2020-01-01", sex: "male" }, today), /13/);
  assert.match(profileProblem({ heightCm: 178, dateOfBirth: "1991-03-12", sex: "" }, today), /sex/);
  assert.equal(profileProblem({ heightCm: 178, dateOfBirth: "1991-03-12", sex: "Prefer not to say" }, today), "");
});

test("only given and changed values are saved", () => {
  assert.deepEqual(profileUpdate({ heightCm: "178", dateOfBirth: "", sex: "Male" }), { height_cm: 178, sex: "male" });
  const stored = { heightCm: 178, dateOfBirth: null, sex: "male" };
  assert.deepEqual(profileChanges(stored, { heightCm: "178", dateOfBirth: "1991-03-12", sex: "Male" }), { date_of_birth: "1991-03-12" });
  assert.deepEqual(profileChanges(stored, { heightCm: 178, sex: "Male" }), {});
});
