import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, extractBatchYear, extractSkills } from "./experience";

test("internship and senior titles win", () => {
  assert.equal(classify("Software Engineering Intern", "3 years of experience").level, "internship");
  assert.equal(classify("Senior Backend Engineer", "").level, "senior");
  assert.equal(classify("Staff Software Engineer", "").level, "senior");
});

test("years decide the level when the title is neutral", () => {
  const c = (body: string) => classify("Software Engineer", body);
  assert.equal(c("0-1 years of experience").level, "fresher");
  assert.equal(c("0–1 years of experience").label, "0–1 years");
  assert.equal(c("1-3 years of experience in backend").level, "junior");
  assert.equal(c("3+ years of professional experience").level, "mid");
  assert.equal(c("3+ years of professional experience").label, "3+ years");
  assert.equal(c("Minimum 5 years of experience with Go").level, "senior");
  assert.equal(c("You have at least 7 years building systems").level, "senior");
  assert.equal(c("Experience: 2 years").level, "junior");
});

test("takes the smallest requirement when several are listed", () => {
  const r = classify("Software Engineer", "2+ years of experience required. 5+ years of experience preferred.");
  assert.equal(r.minYears, 2);
  assert.equal(r.level, "junior");
});

test("entry-level wording", () => {
  assert.equal(classify("Graduate Software Engineer", "").level, "fresher");
  assert.equal(classify("Graduate Software Engineer", "").label, "Entry level");
  assert.equal(classify("Software Engineer I", "").level, "fresher");
  assert.equal(classify("Junior Developer", "").level, "junior");
  assert.equal(classify("Software Developer", "We welcome freshers and recent graduates").level, "fresher");
  assert.ok(classify("New Grad SDE", "").fresherMatch >= 80);
});

test("no signal means unspecified, not a guess", () => {
  const r = classify("Software Engineer", "Build things with a great team.");
  assert.equal(r.level, "unspecified");
  assert.equal(r.label, "Not stated");
  assert.equal(r.fresherMatch, 0);
});

test("ignores years that are not experience", () => {
  assert.equal(classify("Software Engineer", "Founded 15 years ago. Join us!").level, "unspecified");
});

test("batch year and skills", () => {
  assert.equal(extractBatchYear("Open to the class of 2026"), 2026);
  assert.equal(extractBatchYear("2025 batch graduates"), 2025);
  assert.equal(extractBatchYear("nothing"), null);
  const skills = extractSkills("We use TypeScript, React and PostgreSQL. Not Javascripty. C++ is a plus");
  assert.ok(skills.includes("TypeScript") && skills.includes("React") && skills.includes("PostgreSQL") && skills.includes("C++"));
  assert.ok(!skills.includes("Java"));
});
