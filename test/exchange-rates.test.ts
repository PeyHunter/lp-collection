import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, expect, test } from "vitest";
import { createEcbRates, parseEcbRates } from "../src/server/exchange-rates.ts";

const daily = await readFile(new URL("fixtures/ecb-daily.xml", import.meta.url), "utf8");

async function startEcbStub(body: string) {
  let requests = 0;
  const server = createServer((_, response) => {
    requests++;
    response.setHeader("Content-Type", "text/xml");
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/daily.xml`, requests: () => requests };
}

test("the ECB daily rates convert a Discogs price in euros or dollars into kroner", async () => {
  const stub = await startEcbStub(daily);
  const rates = createEcbRates({ url: stub.url });

  expect(await rates.convert({ amount: 30, currency: "EUR" }, "DKK")).toEqual({ amount: 224.21, currency: "DKK" });
  expect(await rates.convert({ amount: 30, currency: "USD" }, "DKK")).toEqual({ amount: 201.44, currency: "DKK" });
  expect(await rates.convert({ amount: 30, currency: "DKK" }, "DKK")).toEqual({ amount: 30, currency: "DKK" });
  expect(stub.requests()).toBe(1);
});

test("the rates are fetched again after twelve hours", async () => {
  const stub = await startEcbStub(daily);
  let now = 0;
  const rates = createEcbRates({ url: stub.url, now: () => now });

  await rates.convert({ amount: 1, currency: "EUR" }, "DKK");
  now += 11 * 60 * 60 * 1000;
  await rates.convert({ amount: 1, currency: "EUR" }, "SEK");
  now += 2 * 60 * 60 * 1000;
  await rates.convert({ amount: 1, currency: "EUR" }, "GBP");

  expect(stub.requests()).toBe(2);
});

test("a rates file without a currency the app offers is refused rather than guessed", () => {
  expect(() => parseEcbRates(daily.replace(/<Cube currency='DKK'[^>]*\/>/, ""))).toThrow("no rate for DKK");
});
