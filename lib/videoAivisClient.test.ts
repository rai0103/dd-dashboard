import { test } from "node:test";
import assert from "node:assert/strict";
import { isAivisVoice, parseAivisSpeakerId } from "./videoAivisClient.ts";

test("isAivisVoice：aivis:接頭辞の声だけtrue", () => {
  assert.equal(isAivisVoice("aivis:3:花音（ノーマル）"), true);
  assert.equal(isAivisVoice("sapi:Microsoft Haruka Desktop"), false);
  assert.equal(isAivisVoice("oc:Ayumi"), false);
  assert.equal(isAivisVoice(""), false);
});

test("parseAivisSpeakerId：声の識別子からstyleIdを取り出す", () => {
  assert.equal(parseAivisSpeakerId("aivis:3:花音（ノーマル）"), 3);
  assert.equal(parseAivisSpeakerId("aivis:0:玄野武宏（ノーマル）"), 0);
  assert.equal(parseAivisSpeakerId("sapi:Microsoft Haruka Desktop"), null);
  assert.equal(parseAivisSpeakerId("aivis:abc:不正"), null);
});
