import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const ADDRESS = "1CounterpartyXXXXXXXXXXXXXXXUWLpVr";
const TX = "08831b430e69f03c2bb3f5a41fc8e9d356a95d1399b1df8cdfd01c18a9c2b52a";

const ROUTES = ["/", "/assets", "/asset/RAREPEPE", `/address/${ADDRESS}`, `/tx/${TX}`, "/blocks", "/radar"];

for (const route of ROUTES) {
  test(`${route} has no serious automated accessibility violations`, async ({ page }) => {
    await page.goto(route, { waitUntil: "networkidle" });
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      // Contrast is tracked separately because resolving it changes the approved visual palette.
      .disableRules(["color-contrast"])
      .analyze();
    const violations = results.violations
      .filter(({ impact }) => impact === "serious" || impact === "critical")
      .map(({ id, impact, help, nodes }) => ({
        id,
        impact,
        help,
        targets: nodes.map((node) => node.target.join(" ")),
      }));

    expect(violations).toEqual([]);
  });
}
