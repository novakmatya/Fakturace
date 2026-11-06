import { describe, expect, it } from "vitest";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { integrityMessage } from "@/lib/errors";
import { createOwnerAccount, isSetupDone, SetupError } from "@/lib/setup";
import { totpFromUri } from "../helpers/totp";

const OWNER = { name: "Jan Novák", email: "Majitel@Example.cz", password: "velmi-dlouhe-heslo-2026" };

function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

describe("jediný účet a přihlášení", () => {
  it("bez platného instalačního kódu účet nevznikne", async () => {
    await expect(createOwnerAccount({ ...OWNER, setupToken: "spatny-kod" })).rejects.toBeInstanceOf(SetupError);
    expect(await isSetupDone()).toBe(false);
  });

  it("s instalačním kódem vznikne právě jeden účet", async () => {
    const user = await createOwnerAccount({ ...OWNER, setupToken: process.env.SETUP_TOKEN! });
    expect(user.email).toBe("majitel@example.cz");
    await expect(
      createOwnerAccount({ ...OWNER, email: "druhy@example.cz", setupToken: process.env.SETUP_TOKEN! }),
    ).rejects.toBeInstanceOf(SetupError);

    // i přímý zápis do databáze odmítne trigger
    const error = await prisma.user
      .create({ data: { id: "x", name: "Vetřelec", email: "x@example.cz" } })
      .catch((e: unknown) => e);
    expect(integrityMessage(error)).toMatch(/jeden uživatelský účet/);
  });

  it("veřejná registrace je vypnutá", async () => {
    await expect(
      getAuth().api.signUpEmail({ body: { name: "Cizí", email: "cizi@example.cz", password: "dalsi-dlouhe-heslo-1" } }),
    ).rejects.toThrow();
  });

  it("špatné heslo neprojde, správné vytvoří relaci", async () => {
    await expect(
      getAuth().api.signInEmail({ body: { email: OWNER.email, password: "spatne-heslo-12345" } }),
    ).rejects.toThrow();
    const response = await getAuth().api.signInEmail({
      body: { email: OWNER.email, password: OWNER.password },
      asResponse: true,
    });
    expect(response.status).toBe(200);
    expect(cookieHeader(response)).toMatch(/session_token/);
  });

  it("zapnutí 2FA: TOTP kód aktivuje ochranu a další přihlášení ho vyžaduje", async () => {
    const login = await getAuth().api.signInEmail({
      body: { email: OWNER.email, password: OWNER.password },
      asResponse: true,
    });
    const headers = new Headers({ cookie: cookieHeader(login) });

    const enabled = await getAuth().api.enableTwoFactor({ body: { password: OWNER.password, method: "totp" }, headers });
    if (enabled.method !== "totp") throw new Error("Očekávána metoda TOTP");
    expect(enabled.totpURI).toMatch(/^otpauth:\/\/totp\//);
    expect(enabled.backupCodes).toHaveLength(10);

    await expect(getAuth().api.verifyTOTP({ body: { code: "000000" }, headers })).rejects.toThrow();
    await getAuth().api.verifyTOTP({ body: { code: totpFromUri(enabled.totpURI) }, headers });

    const user = await prisma.user.findFirstOrThrow();
    expect(user.twoFactorEnabled).toBe(true);

    const second = (await getAuth().api.signInEmail({ body: { email: OWNER.email, password: OWNER.password } })) as {
      twoFactorRedirect?: boolean;
      token?: string;
    };
    expect(second.twoFactorRedirect).toBe(true);
  });
});
