import { describe, expect, it } from "vitest";
import { emailAlertsStatus, smtpConfigFromEnv } from "./config";

const gmail = {
  SMTP_HOST: "smtp.gmail.com",
  SMTP_PORT: "465",
  SMTP_USER: "me@gmail.com",
  SMTP_PASS: "abcd efgh ijkl mnop",
  NOTIFY_EMAIL_TO: "me@gmail.com",
};

describe("smtpConfigFromEnv", () => {
  it("is off when SMTP_HOST is empty", () => {
    expect(smtpConfigFromEnv({})).toBeNull();
    expect(smtpConfigFromEnv({ SMTP_HOST: "  ", NOTIFY_EMAIL_TO: "me@x.dev" })).toBeNull();
  });

  it("reads a Gmail setup and strips the spaces Gmail shows in app passwords", () => {
    expect(smtpConfigFromEnv(gmail)).toEqual({
      host: "smtp.gmail.com",
      port: 465,
      user: "me@gmail.com",
      pass: "abcdefghijklmnop",
      from: '"Issue Radar" <me@gmail.com>',
      to: "me@gmail.com",
    });
  });

  it("keeps other passwords exactly as written", () => {
    expect(smtpConfigFromEnv({ ...gmail, SMTP_PASS: "p@ss word 123" })?.pass).toBe("p@ss word 123");
  });

  it("defaults the port to 465 and accepts a custom sender", () => {
    const config = smtpConfigFromEnv({ ...gmail, SMTP_PORT: "", NOTIFY_EMAIL_FROM: "Radar <alerts@example.com>" });
    expect(config?.port).toBe(465);
    expect(config?.from).toBe("Radar <alerts@example.com>");
  });

  it("allows servers without login (e.g. a local test server)", () => {
    const config = smtpConfigFromEnv({ SMTP_HOST: "127.0.0.1", SMTP_PORT: "1025", NOTIFY_EMAIL_TO: "me@x.dev" });
    expect(config).toMatchObject({ host: "127.0.0.1", port: 1025, user: undefined, pass: undefined, from: '"Issue Radar" <me@x.dev>' });
  });

  it.each([
    [{ ...gmail, NOTIFY_EMAIL_TO: "" }, /NOTIFY_EMAIL_TO is empty/],
    [{ ...gmail, SMTP_PORT: "smtp" }, /SMTP_PORT must be a port number/],
    [{ ...gmail, SMTP_PORT: "70000" }, /SMTP_PORT must be a port number/],
    [{ ...gmail, SMTP_PASS: "" }, /SMTP_PASS is empty/],
  ])("explains half-finished settings %#", (env, message) => {
    expect(() => smtpConfigFromEnv(env)).toThrow(message);
  });
});

describe("emailAlertsStatus", () => {
  it("reports on, off and misconfigured", () => {
    expect(emailAlertsStatus(gmail)).toEqual({ on: true, label: "on, to me@gmail.com" });
    expect(emailAlertsStatus({})).toEqual({ on: false, label: "off" });
    expect(emailAlertsStatus({ ...gmail, SMTP_PASS: "" }).label).toMatch(/^misconfigured: SMTP_USER is set/);
  });
});
