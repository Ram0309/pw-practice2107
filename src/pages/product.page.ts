import type { Locator, Page } from '@playwright/test';
import { BasePage } from './base.page.js';

export class ProductPage extends BasePage {
  readonly title: Locator;
  readonly price: Locator;
  readonly quantity: Locator;
  readonly addToCartButton: Locator;

  constructor(page: Page) {
    super(page);
    this.title = page.locator('.product-name h1');
    this.price = page.locator('.product-price').first();
    this.quantity = page.locator('input.qty-input');
    this.addToCartButton = page.locator('[id^="add-to-cart-button-"]');
  }

  async goto(slug: string): Promise<void> {
    await this.open(`/${slug}`);
  }

  async addToCart(quantity = 1): Promise<void> {
    await this.quantity.fill(String(quantity));
    await this.addToCartButton.click();
  }
}
