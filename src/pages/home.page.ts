import { expect, type Locator, type Page } from '@playwright/test';
import { BasePage } from './base.page.js';

export class HomePage extends BasePage {
  readonly featuredProducts: Locator;

  constructor(page: Page) {
    super(page);
    this.featuredProducts = page.locator('.product-grid .product-item');
  }

  async goto(): Promise<void> {
    await this.open('/');
    await expect(this.page).toHaveTitle(/Demo Web Shop/);
  }

  async openCategory(name: string): Promise<void> {
    await this.topMenu.filter({ hasText: name }).first().click();
  }
}
