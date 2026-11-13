import { describe, expect, it } from "vitest";
import { createToolRegistry, runToolDetailed } from "@xrkseek/core-tools";
import {
  FaceParentAskBroker,
  bindAnswerAskTool,
  bindAskParentTool,
  formatParentAskNotice,
} from "../src/parent-ask.js";
import { FaceQuestionBroker } from "../src/questions.js";

describe("Face parent-ask (child → parent AI)", () => {
  it("child ask blocks until parent answer_ask; no human question pending", async () => {
    const notices: string[] = [];
    const broker = new FaceParentAskBroker({
      onRequested(pending) {
        notices.push(formatParentAskNotice(pending));
      },
    });
    const questions = new FaceQuestionBroker({
      onRequested() {},
      onResolved() {},
    });

    const childTools = createToolRegistry();
    const parentTools = createToolRegistry();
    bindAskParentTool(childTools, {
      childSessionId: "child_1",
      parentSessionId: "parent_1",
      childLabel: "worker",
      broker,
    });
    bindAnswerAskTool(parentTools, {
      parentSessionId: "parent_1",
      broker,
    });

    const askPromise = runToolDetailed({
      registry: childTools,
      call: {
        id: "c1",
        name: "ask",
        arguments: { question: "use npm or pnpm?" },
      },
    });

    await new Promise((r) => setTimeout(r, 20));
    const pending = broker.listPending("parent_1");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.questions[0]!.question).toBe("use npm or pnpm?");
    expect(questions.listPending("parent_1")).toHaveLength(0);
    expect(notices[0]).toContain("<child_ask");
    expect(notices[0]).toContain("answer_ask");

    const answered = await runToolDetailed({
      registry: parentTools,
      call: {
        id: "p1",
        name: "answer_ask",
        arguments: {
          ask_id: pending[0]!.askId,
          answer: "pnpm",
        },
      },
    });
    expect(answered.result.isError).toBeUndefined();

    const childResult = await askPromise;
    expect(childResult.result.isError).toBeUndefined();
    expect(childResult.result.content).toBe("pnpm");
    expect(broker.listPending("parent_1")).toHaveLength(0);
  });

  it("cancelForChild rejects the waiter", async () => {
    const broker = new FaceParentAskBroker({ onRequested() {} });
    const childTools = createToolRegistry();
    bindAskParentTool(childTools, {
      childSessionId: "child_2",
      parentSessionId: "parent_2",
      childLabel: "nested",
      broker,
    });

    const askPromise = runToolDetailed({
      registry: childTools,
      call: {
        id: "c2",
        name: "ask",
        arguments: { question: "still waiting?" },
      },
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(broker.listPending("parent_2")).toHaveLength(1);
    broker.cancelForChild("child_2", "child stopped");
    const result = await askPromise;
    expect(result.result.isError).toBe(true);
    expect(String(result.result.content)).toContain("child stopped");
  });

  it("answer_ask dynamicSchema stays empty when idle", () => {
    const broker = new FaceParentAskBroker({ onRequested() {} });
    const tools = createToolRegistry();
    bindAnswerAskTool(tools, {
      parentSessionId: "parent_idle",
      broker,
    });
    expect(tools.get("answer_ask")?.dynamicSchema?.()).toEqual({});
  });
});
