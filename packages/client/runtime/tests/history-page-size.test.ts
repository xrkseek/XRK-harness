/**
 * Client history page sizes must stay aligned with Face pagination defaults
 * (long-session open/resume: one tail page, not the whole log).
 */

import { describe, expect, it } from "vitest";
import {
  JUMP_PAGE_MESSAGES,
  PAGE_MESSAGES,
} from "../src/client/sessions/session.ts";
import { DEFAULT_HISTORY_MAX_MESSAGES } from "../../../server/face/src/adapt/history-paginate.ts";

describe("history page size alignment", () => {
  it("PAGE_MESSAGES matches Face DEFAULT_HISTORY_MAX_MESSAGES", () => {
    expect(PAGE_MESSAGES).toBe(50);
    expect(PAGE_MESSAGES).toBe(DEFAULT_HISTORY_MAX_MESSAGES);
  });

  it("JUMP_PAGE_MESSAGES is larger than a normal page for rail loadThrough", () => {
    expect(JUMP_PAGE_MESSAGES).toBe(200);
    expect(JUMP_PAGE_MESSAGES).toBeGreaterThan(PAGE_MESSAGES);
  });
});
