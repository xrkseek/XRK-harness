import { describe, expect, it } from "vitest";
import {
  formatJobDuration,
  jobStatusText,
} from "../src/client/job-list-shared.ts";
import { zh } from "../src/client/locales.ts";
import type { TranslateNS } from "@xrkseek/client-ui-slots";

const t: TranslateNS<"job"> = ((key, params) => {
  const template = zh[key as keyof typeof zh] ?? key;
  if (!params) return template;
  return Object.entries(params).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  );
}) as TranslateNS<"job">;

describe("formatJobDuration", () => {
  it("shows tenths under ten seconds so sub-second settles are not zero", () => {
    expect(formatJobDuration(0, t)).toBe("0秒");
    expect(formatJobDuration(30, t)).toBe("0.1秒");
    expect(formatJobDuration(450, t)).toBe("0.5秒");
    expect(formatJobDuration(1_250, t)).toBe("1.3秒");
    expect(formatJobDuration(9_000, t)).toBe("9秒");
  });

  it("widens to minutes and hours above ten seconds", () => {
    expect(formatJobDuration(10_000, t)).toBe("10秒");
    expect(formatJobDuration(125_000, t)).toBe("2分5秒");
    expect(formatJobDuration(7_380_000, t)).toBe("2小时3分");
  });

  it("clamps negative elapsed to zero", () => {
    expect(formatJobDuration(-500, t)).toBe("0秒");
  });
});

describe("jobStatusText", () => {
  it("keeps the status word and appends producer detail", () => {
    expect(
      jobStatusText({ status: "completed", detail: "exit code: 0" }, t),
    ).toBe("已完成 · exit code: 0");
    expect(jobStatusText({ status: "completed" }, t)).toBe("已完成");
  });
});
