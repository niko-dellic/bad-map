import { expect, test } from "@playwright/test";

const README_URL = "https://github.com/niko-dellic/bad-map#readme";

test("points documentation to the canonical README", async ({ request }) => {
  const response = await request.get("/docs/");
  expect(response.ok()).toBe(true);
  const html = await response.text();
  expect(html).toContain(`0; url=${README_URL}`);
  expect(html).toContain(`rel="canonical"`);
  expect(html).toContain(`href="${README_URL}"`);
  expect(html).toContain("bad-map README");
});
