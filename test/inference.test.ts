import { strict as assert } from "assert";
import {
  inferAnnotationRegexSources,
  inferAnnotationTargets,
  inferMethodPatterns,
  matchesInferredCompletionContext,
  parseCallLikeArg,
} from "../src/inference";

describe("inference", () => {
  it("inferMethodPatterns extracts literal-first-arg method paths and ignores comments", () => {
    const source = [
      `// infrastructureLogger.log("COMMENT_ONLY")`,
      `/* appLogger.warn("BLOCK_ONLY")`,
      `   continued */`,
      `String s = "text with appLogger.warn(\\"STR\\")";`,
      `infrastructureLogger.log("MSG.OK");`,
      `infrastructureLogger.log("MSG.MISS");`,
      `appLogger.warn('MSG.OK');`,
      `foo(bar, "ignored-second-arg");`,
      `messageSource.getMessage("MSG.OK");`,
    ].join("\n");

    const patterns = inferMethodPatterns(source, new Set(["MSG.OK"]));
    assert.deepStrictEqual(
      new Set(patterns),
      new Set(["appLogger.warn", "messageSource.getMessage"])
    );
  });

  it("inferMethodPatterns handles escaped literal characters", () => {
    const source = `a.log("MSG\\\\.A\\n\\r\\t"); b.log("MSG\\\\.A\\n\\r\\t");`;
    const patterns = inferMethodPatterns(source, new Set(["MSG\\.A\n\r\t"]));
    assert.deepStrictEqual(patterns, ["a.log", "b.log"]);
  });

  it("inferMethodPatterns handles zero-arg calls, malformed paths, and nested structures", () => {
    const source = [
      `fn();`,
      `.bad("X");`,
      `arr[idx].warn("K1");`,
      `ok.warn("K1", new Object[] { a, b }, map.get("x"));`,
    ].join("\n");
    const patterns = inferMethodPatterns(source, new Set(["K1"]));
    assert.ok(patterns.includes("ok.warn"));
  });

  it("inferAnnotationTargets and regex sources infer only non-ambiguous annotation attrs", () => {
    const source = [
      `@pkg.LogStartEnd(start = "MSG_START", end = "MSG_END", exception = "MISS")`,
      `@LogStartEnd(start = "MSG_START")`,
      `@Other(flag = true)`,
      `@Bad(start = unknownVar)`,
    ].join("\n");

    const keys = new Set(["MSG_START", "MSG_END"]);
    const targets = inferAnnotationTargets(source, keys);
    assert.deepStrictEqual(
      targets,
      new Set(["LogStartEnd#start", "LogStartEnd#end"])
    );

    const regexes = inferAnnotationRegexSources(source, keys);
    assert.ok(
      regexes.some((r) => new RegExp(r, "g").test(`@LogStartEnd(start="MSG_START")`))
    );
    assert.ok(
      regexes.some((r) => new RegExp(r, "g").test(`@LogStartEnd(foo=1, end="MSG_END")`))
    );
    assert.strictEqual(regexes.some((r) => r.includes("exception")), false);
  });

  it("inferAnnotationTargets skips malformed annotation forms", () => {
    const source = [
      `@1Bad(start="A")`,
      `@NoArgs`,
      `@Broken(start="A"`,
      `@Ann(noEq "A")`,
      `@Ann(bad-name="A")`,
      `@Ann('x' = "A")`,
      `@Ann(text='A')`,
      `@Ann(name(arr[0])="A")`,
      `@Ann(name{a}="A")`,
      `@Ann(data = "A", arr = { "B", "C" })`,
    ].join("\n");
    const targets = inferAnnotationTargets(source, new Set(["A"]));
    assert.ok(targets.has("Ann#data"));
    assert.strictEqual(targets.has("Ann#arr"), false);
  });

  it("parseCallLikeArg parses method call and arg count", () => {
    assert.deepStrictEqual(parseCallLikeArg("createLogParams(a, b)"), {
      methodName: "createLogParams",
      argCount: 2,
    });
    assert.deepStrictEqual(parseCallLikeArg("Utils.buildArgs ( req )"), {
      methodName: "buildArgs",
      argCount: 1,
    });
    assert.deepStrictEqual(parseCallLikeArg("emptyArgs()"), {
      methodName: "emptyArgs",
      argCount: 0,
    });
  });

  it("parseCallLikeArg rejects non-call and malformed expressions", () => {
    assert.strictEqual(parseCallLikeArg("justVariable"), null);
    assert.strictEqual(parseCallLikeArg("(a, b)"), null);
    assert.strictEqual(parseCallLikeArg("buildArgs(a)) + suffix"), null);
    assert.strictEqual(parseCallLikeArg(".buildArgs(a)"), null);
    assert.strictEqual(parseCallLikeArg("buildArgs(a))"), null);
    assert.deepStrictEqual(parseCallLikeArg("f(,a)"), {
      methodName: "f",
      argCount: 1,
    });
    assert.strictEqual(parseCallLikeArg("a.b.c."), null);
    assert.deepStrictEqual(parseCallLikeArg("buildArgs(a, b, c)"), {
      methodName: "buildArgs",
      argCount: 3,
    });
  });

  it("matchesInferredCompletionContext matches method invocation context", () => {
    assert.strictEqual(
      matchesInferredCompletionContext(
        `infrastructureLogger.log("`,
        ["infrastructureLogger.log"],
        new Set()
      ),
      true
    );
    assert.strictEqual(
      matchesInferredCompletionContext(`foo.log("`, ["appLogger.log"], new Set()),
      true
    );
  });

  it("matchesInferredCompletionContext matches annotation assignment context", () => {
    assert.strictEqual(
      matchesInferredCompletionContext(
        `@LogStartEnd(start="`,
        [],
        new Set(["LogStartEnd#start"])
      ),
      true
    );
    assert.strictEqual(
      matchesInferredCompletionContext(
        `@a.b.LogStartEnd(end = "`,
        [],
        new Set(["LogStartEnd#end"])
      ),
      true
    );
  });

  it("matchesInferredCompletionContext returns false for unsupported contexts", () => {
    assert.strictEqual(
      matchesInferredCompletionContext(`plain text`, ["a.log"], new Set()),
      false
    );
    assert.strictEqual(
      matchesInferredCompletionContext(`foo("`, [], new Set()),
      false
    );
    assert.strictEqual(
      matchesInferredCompletionContext(`start="`, [], new Set(["A#start"])),
      false
    );
    assert.strictEqual(
      matchesInferredCompletionContext(`@1Bad(start="`, [], new Set()),
      false
    );
    assert.strictEqual(
      matchesInferredCompletionContext(`@LogStartEnd(="`, [], new Set()),
      false
    );
    assert.strictEqual(
      matchesInferredCompletionContext(`@Ann(1a="`, [], new Set()),
      false
    );
    assert.strictEqual(
      matchesInferredCompletionContext(`("`, ["x.y"], new Set()),
      false
    );
    assert.strictEqual(
      matchesInferredCompletionContext(`foo "`, ["x.y"], new Set()),
      false
    );
  });
});
