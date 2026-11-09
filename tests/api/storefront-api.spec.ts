import { test, expect } from '@playwright/test';
import { testData } from '../../src/fixtures/test-fixtures.js';

/**
 * Curated API tests using Playwright's APIRequestContext (`request` fixture).
 * Every test gets its own request context, so it has its own anonymous session and cart.
 */
test.describe('Storefront endpoints @smoke @api', () => {
  test('GET / returns the storefront HTML', async ({ request }) => {
    const res = await request.get('/');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/html');
    expect(await res.text()).toContain('Demo Web Shop');
  });

  test('GET /search?q=laptop finds the laptop', async ({ request }) => {
    const res = await request.get('/search', { params: { q: testData.search.validTerm } });
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain(testData.search.expectedProduct);
  });

  test('POST add-to-cart with a valid product returns success JSON', async ({ request }) => {
    const res = await request.post(`/addproducttocart/catalog/${testData.products.laptop.id}/1/1`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/json');
    const body = await res.json();
    expect(body).toMatchObject({ success: true, updatetopcartsectionhtml: '(1)' });
  });

  test('POST add-to-cart with an unknown product id is rejected', async ({ request }) => {
    const res = await request.post('/addproducttocart/catalog/999999/1/1');
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ success: false, message: 'No product found with the specified ID' });
  });
});
