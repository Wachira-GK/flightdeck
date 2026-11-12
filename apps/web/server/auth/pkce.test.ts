import { describe, expect, it } from "vitest";
import { challengeFor, isVerifier, newVerifier } from "./pkce";

describe("PKCE", () => {
  it("matches the worked example in RFC 7636 appendix B", async () => {
    expect(await challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("makes long, URL-safe, unique verifiers", () => {
    const a = newVerifier();
    const b = newVerifier();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(isVerifier(a)).toBe(true);
  });

  it("rejects values that are not a verifier (cookie tampering)", () => {
    for (const bad of ["", "short", "a".repeat(129), "a".repeat(50) + ".x", "a".repeat(50) + " "]) expect(isVerifier(bad)).toBe(false);
  });
});
