import { expect, type Locator, type Page } from '@playwright/test';
import { BasePage } from './base.page.js';

export class SearchResultsPage extends BasePage {
  readonly productItems: Locator;
  readonly productTitles: Locator;
  readonly results: Locator;

  constructor(page: Page) {
    super(page);
    this.productItems = page.locator('.search-results .product-item');
    this.productTitles = this.productItems.locator('.product-title a');
    this.results = page.locator('.search-results');
  }

  async goto(term: string): Promise<void> {
    await this.open(`/search?q=${encodeURIComponent(term)}`);
  }

  product(name: string): Locator {
    return this.productItems.filter({ has: this.page.locator('.product-title a', { hasText: name }) });
  }

  async addToCart(name: string): Promise<void> {
    await this.product(name).getByRole('button', { name: 'Add to cart' }).click();
  }

  async expectProductListed(name: string): Promise<void> {
    await expect(this.productTitles.filter({ hasText: name })).toBeVisible();
  }

  async expectMessage(text: string): Promise<void> {
    await expect(this.results).toContainText(text);
  }
}
