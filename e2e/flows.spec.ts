import { expect, test } from "@playwright/test";

test("a judge clicks Try the demo and gets a recommended deal", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo" }).click();
  await expect(page).toHaveURL(/\/deal\//);
  await expect(page.getByText("Recommended deal")).toBeVisible({ timeout: 45_000 });
  // The nav shows who's signed in after the demo signs Sarah in.
  await expect(page.getByRole("banner").getByText("Sarah", { exact: true })).toBeVisible();
  // Arjun's floor is above the budget: no deal, whether his agent walks away or the rounds run out.
  await expect(page.getByLabel("Negotiation with Arjun").getByText(/Walked away|Closed/).first()).toBeVisible();
});

test("the attack test shows engine blocks and a withheld floor", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Run the attack test" }).click();
  await expect(page.getByText("Engine blocked").first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("my floor is [withheld]").first()).toBeVisible();
});

test("a seller logs in, sees their dashboard and their Hindi phone view", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /Meera · seller/ }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Meera, Varanasi" })).toBeVisible();
  await page.goto("/seller");
  await expect(page.getByText("मेरी बिक्री")).toBeVisible();
});

test("a seller can't open a buyer's negotiation room", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo" }).click();
  await expect(page).toHaveURL(/\/deal\//);
  const dealUrl = page.url();
  await page.getByRole("button", { name: "Log out" }).click();
  await page.goto("/login");
  await page.getByRole("button", { name: /Meera · seller/ }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto(dealUrl);
  await expect(page.getByText("This needs a buyer account")).toBeVisible();
});

test("anyone can browse listings and open a product page", async ({ page }) => {
  await page.goto("/browse");
  await page.getByText("Handwoven Banarasi silk scarf, rose and gold").click();
  await expect(page.getByRole("heading", { name: "Handwoven Banarasi silk scarf, rose and gold" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Negotiate for me" })).toBeVisible();
});
