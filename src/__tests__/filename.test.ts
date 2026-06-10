import { describe, it, expect } from "vitest";
import { scanFilename, scanFilenames } from "@/scanner/filename";

describe("scanFilename — file metadata detection", () => {
  describe("blocked extensions", () => {
    it.each([".env", ".pem", ".key", ".p12", ".pfx", ".npmrc", ".pypirc"])(
      "blocks %s extension",
      (ext) => {
        const f = scanFilename(`config${ext}`);
        expect(f).not.toBeNull();
        expect(f!.category).toBe("SENSITIVE_FILENAME");
        expect(f!.action).toBe("block");
      }
    );
  });

  describe("blocked exact names", () => {
    it.each([
      "id_rsa",
      "id_dsa",
      "authorized_keys",
      "known_hosts",
      "credentials.json",
      "service-account.json",
      "secrets.yaml",
      "secrets.yml",
      "prod.env",
      "config.prod",
    ])("blocks %s", (name) => {
      const f = scanFilename(name);
      expect(f).not.toBeNull();
      expect(f!.category).toBe("SENSITIVE_FILENAME");
    });
  });

  it("handles path prefixes", () => {
    const f = scanFilename("/home/user/.ssh/id_rsa");
    expect(f).not.toBeNull();
    expect(f!.matched).toBe("id_rsa");
  });

  it("handles Windows-style paths", () => {
    const f = scanFilename("C:\\Users\\admin\\.ssh\\id_rsa");
    expect(f).not.toBeNull();
    expect(f!.matched).toBe("id_rsa");
  });

  it("case-insensitive matching for names", () => {
    const f = scanFilename("Credentials.JSON");
    expect(f).not.toBeNull();
    expect(f!.category).toBe("SENSITIVE_FILENAME");
  });

  it("allows normal files", () => {
    expect(scanFilename("document.pdf")).toBeNull();
    expect(scanFilename("photo.png")).toBeNull();
    expect(scanFilename("data.csv")).toBeNull();
    expect(scanFilename("config.json")).toBeNull();
    expect(scanFilename("index.ts")).toBeNull();
  });

  it("allows .txt key-suffixed files (not .key extension)", () => {
    expect(scanFilename("readme.txt")).toBeNull();
  });
});

describe("scanFilenames", () => {
  it("returns findings for multiple sensitive files", () => {
    const f = scanFilenames(["id_rsa", ".env", "normal.txt"]);
    expect(f).toHaveLength(2);
  });

  it("returns empty for all clean files", () => {
    const f = scanFilenames(["a.txt", "b.csv", "c.json"]);
    expect(f).toHaveLength(0);
  });
});
