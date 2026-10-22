import { afterEach, describe, expect, it } from "vitest";
import {
  isLikelyRemoteSessionsPath,
  resolveSqliteJournalMode,
} from "../src/sqlite-journal.js";

describe("sqlite journal mode", () => {
  const prev = process.env.XRK_SQLITE_JOURNAL;

  afterEach(() => {
    if (prev === undefined) delete process.env.XRK_SQLITE_JOURNAL;
    else process.env.XRK_SQLITE_JOURNAL = prev;
  });

  it("flags UNC and common sync-folder roots as remote", () => {
    expect(isLikelyRemoteSessionsPath("\\\\server\\share\\xrk")).toBe(true);
    expect(
      isLikelyRemoteSessionsPath("C:\\Users\\a\\OneDrive\\Documents\\proj"),
    ).toBe(true);
    expect(isLikelyRemoteSessionsPath("D:\\Dropbox\\work\\repo")).toBe(true);
    expect(isLikelyRemoteSessionsPath("C:\\Users\\a\\Desktop\\proj")).toBe(
      false,
    );
  });

  it("defaults to WAL on local paths and DELETE on remote", () => {
    delete process.env.XRK_SQLITE_JOURNAL;
    expect(resolveSqliteJournalMode("C:\\Users\\a\\Desktop\\proj")).toBe("WAL");
    expect(resolveSqliteJournalMode("\\\\nas\\home\\.xrk")).toBe("DELETE");
  });

  it("honors XRK_SQLITE_JOURNAL override", () => {
    process.env.XRK_SQLITE_JOURNAL = "DELETE";
    expect(resolveSqliteJournalMode("C:\\local")).toBe("DELETE");
    process.env.XRK_SQLITE_JOURNAL = "wal";
    expect(resolveSqliteJournalMode("\\\\nas\\share")).toBe("WAL");
  });
});
