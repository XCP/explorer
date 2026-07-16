import { test, expect } from "@playwright/test";

const ADDRESS = "1CounterpartyXXXXXXXXXXXXXXXUWLpVr";
const TX = "08831b430e69f03c2bb3f5a41fc8e9d356a95d1399b1df8cdfd01c18a9c2b52a";

test("critical server-rendered routes return usable documents", async ({ page }) => {
  for (const route of ["/", "/assets", "/asset/RAREPEPE", `/address/${ADDRESS}`, `/tx/${TX}`, "/blocks"]) {
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.status(), route).toBeLessThan(400);
    await expect(page.locator("main")).toBeVisible();
    await expect(page).toHaveTitle(/xcp|rarepepe|address|transaction|blocks/i);
  }
});

test("global search shape-routes assets without a client error", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/", { waitUntil: "networkidle" });
  const search = page.locator("[data-search] input");
  await expect(search).toHaveCount(1);
  await search.fill("RAREPEPE");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/asset\/RAREPEPE$/);
  await expect(page.getByRole("heading", { name: "RAREPEPE", exact: false })).toBeVisible();
  expect(errors).toEqual([]);
});

test("unknown canonical records use the not-found surface", async ({ page }) => {
  await page.goto("/asset/THIS_ASSET_SHOULD_NOT_EXIST_12345", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "404", exact: true })).toBeVisible();
});

test("asset Rating and Activity Outlook remain separate and mobile-safe", async ({ page }) => {
  await page.goto("/asset/RAREPEPE", { waitUntil: "networkidle" });
  await expect(page.getByText("Rating", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Activity outlook", { exact: true })).toHaveCount(1);
  await expect(page.getByText("relative 180-day rank", { exact: false })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("Activity outlook", { exact: true })).toBeVisible();
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
});
