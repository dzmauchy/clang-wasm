import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(
  new URL("../.github/workflows/llvm.yml", import.meta.url),
  "utf8",
);

const publishStep = workflow.slice(workflow.indexOf("name: Publish GitHub Release"));

test("release publish creates the tag ref before calling the Releases API", () => {
  const tagPush = publishStep.indexOf('git push origin "refs/tags/${TAG_NAME}"');
  const releaseCreate = publishStep.indexOf("gh release create");
  assert.ok(tagPush !== -1, "tag is pushed with git");
  assert.ok(releaseCreate !== -1, "release is created with gh");
  assert.ok(tagPush < releaseCreate, "tag push happens before gh release create");
  assert.equal(publishStep.includes("--target"), false);
  assert.match(publishStep, /git tag "\$TAG_NAME" "\$GITHUB_SHA"/);
});
