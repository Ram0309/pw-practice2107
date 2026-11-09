# Automation Standards

## Locator strategy (in priority order)
1. `getByRole(role, { name })` for buttons, links, headings
2. `getByLabel` for labelled form fields
3. Stable ids (`#small-searchterms`, `#Email`, `#Password`)
4. Short CSS on stable classes (`.product-item`, `.cart-qty`)
5. Never absolute XPath, never nth-child chains, never generated class names

## Known stable locators on Demo Web Shop (observed)
- Header search input: `#small-searchterms`
- Header search button: role button "Search"
- Header cart counter: `span.cart-qty` (text "(N)")
- Notification bar: `#bar-notification`
- Product tile: `.product-item`, title link `.product-title a`
- Listing add-to-cart: role button "Add to cart" inside `.product-item`
- Login: `#Email`, `#Password`, role button "Log in"
- Login error summary: `.validation-summary-errors`
- Product page add-to-cart: `[id^="add-to-cart-button-"]`
- Cart rows: `tr.cart-item-row`

## Coding rules
- Use the page objects in `src/pages` through the fixtures in `src/fixtures/test-fixtures.ts`.
- Use web-first assertions (`await expect(locator).toBeVisible()`); never `waitForTimeout`.
- One behaviour per test; test titles start with the test case id, e.g. `TC-REQ-001-01`.
- Tag smoke tests with `@smoke`, and every test with its module, e.g. `@search`.
- Test data comes from `test-data/demowebshop.json`, never hard-coded credentials.
- Never click "Confirm" on the final checkout step.
