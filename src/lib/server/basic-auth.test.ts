import { describe, expect, it } from "vitest";
import { checkBasicAuth, isAuthConfigured } from "./basic-auth";

const enc = (s: string) => "Basic " + Buffer.from(s, "utf8").toString("base64");

describe("checkBasicAuth", () => {
  it("환경변수가 없으면 인증을 걸지 않는다 — 로컬 개발은 그대로 열려 있어야 한다", () => {
    expect(checkBasicAuth(null, undefined, undefined)).toBe(true);
    expect(checkBasicAuth(null, "u", undefined)).toBe(true);
    expect(checkBasicAuth(null, "", "p")).toBe(true);
  });

  it("맞는 자격증명이면 통과한다", () => {
    expect(checkBasicAuth(enc("me:secret"), "me", "secret")).toBe(true);
  });

  it("헤더가 없으면 거부한다", () => {
    expect(checkBasicAuth(null, "me", "secret")).toBe(false);
  });

  it("비밀번호가 틀리면 거부한다", () => {
    expect(checkBasicAuth(enc("me:wrong"), "me", "secret")).toBe(false);
  });

  it("사용자가 틀리면 거부한다", () => {
    expect(checkBasicAuth(enc("you:secret"), "me", "secret")).toBe(false);
  });

  it("비밀번호에 콜론이 있어도 첫 콜론에서만 나눈다", () => {
    expect(checkBasicAuth(enc("me:a:b:c"), "me", "a:b:c")).toBe(true);
  });

  it("Basic 이 아닌 스킴은 거부한다", () => {
    expect(checkBasicAuth("Bearer abc", "me", "secret")).toBe(false);
  });

  it("깨진 base64는 거부하고 던지지 않는다", () => {
    expect(checkBasicAuth("Basic %%%", "me", "secret")).toBe(false);
  });

  it("앞부분만 맞는 값은 거부한다 — 길이가 다르면 반드시 실패해야 한다", () => {
    expect(checkBasicAuth(enc("me:secre"), "me", "secret")).toBe(false);
    expect(checkBasicAuth(enc("me:secret!"), "me", "secret")).toBe(false);
  });
});

describe("isAuthConfigured", () => {
  it("둘 다 있어야 설정된 것으로 본다", () => {
    expect(isAuthConfigured("u", "p")).toBe(true);
    expect(isAuthConfigured("u", "")).toBe(false);
    expect(isAuthConfigured(undefined, "p")).toBe(false);
  });
});
