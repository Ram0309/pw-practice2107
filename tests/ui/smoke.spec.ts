import { test, expect } from '../../src/fixtures/test-fixtures.js';

/**
 * Curated smoke suite for the Demo Web Shop. Human-reviewed; the baseline the
 * AI-generated tests are compared against and the suite CI runs on every push.
 */
test.describe('Demo Web Shop smoke @smoke', () => {
  test('home page shows store title, top menu and empty cart @home', async ({ homePage, page }) => {
    await homePage.goto();
    await expect(homePage.topMenu).toContainText(['Books', 'Computers', 'Electronics', 'Apparel & Shoes', 'Digital downloads', 'Jewelry', 'Gift Cards']);
    await homePage.expectCartCount(0);
    await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();
  });

  test('search for a known product lists it @search', async ({ homePage, searchPage, data, page }) => {
    await homePage.goto();
    await homePage.search(data.search.validTerm);
    await expect(page).toHaveURL(/\/search\?q=laptop/);
    await searchPage.expectProductListed(data.search.expectedProduct);
  });

  test('search term shorter than 3 characters is rejected @search', async ({ searchPage, data }) => {
    await searchPage.goto(data.search.shortTerm);
    await searchPage.expectMessage(data.messages.searchTooShort);
  });

  test('search with no matches shows no-results message @search', async ({ searchPage, data }) => {
    await searchPage.goto(data.search.noResultTerm);
    await searchPage.expectMessage(data.messages.searchNoResults);
    await expect(searchPage.productItems).toHaveCount(0);
  });

  test('guest adds a product to the cart from search results @cart', async ({ searchPage, cartPage, data }) => {
    await searchPage.goto(data.search.validTerm);
    await searchPage.expectCartCount(0);
    await searchPage.addToCart(data.search.expectedProduct);
    await searchPage.expectNotification(data.messages.addedToCart);
    await searchPage.expectCartCount(1);

    await cartPage.goto();
    await cartPage.expectProduct(data.search.expectedProduct, 1);
    const [unit, qty, total] = await cartPage.lineValues(data.search.expectedProduct);
    expect(total).toBeCloseTo(unit * qty, 2);
  });

  test('login with an unknown email shows an error @login', async ({ loginPage, data }) => {
    await loginPage.goto();
    await loginPage.login(data.login.unknownEmail, data.login.anyPassword);
    await loginPage.expectError(data.messages.loginFailed);
  });
});
