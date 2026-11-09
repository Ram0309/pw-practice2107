import { expect, type Locator, type Page } from '@playwright/test';
import { BasePage } from './base.page.js';

export class CartPage extends BasePage {
  readonly rows: Locator;
  readonly emptyMessage: Locator;
  readonly termsCheckbox: Locator;
  readonly checkoutButton: Locator;

  constructor(page: Page) {
    super(page);
    this.rows = page.locator('table.cart tr.cart-item-row');
    this.emptyMessage = page.locator('.order-summary-content');
    this.termsCheckbox = page.locator('#termsofservice');
    this.checkoutButton = page.getByRole('button', { name: 'Checkout' });
  }

  async goto(): Promise<void> {
    await this.open('/cart');
  }

  row(productName: string): Locator {
    return this.rows.filter({ has: this.page.locator('.product-name', { hasText: productName }) });
  }

  async expectProduct(productName: string, quantity = 1): Promise<void> {
    const row = this.row(productName);
    await expect(row).toBeVisible();
    await expect(row.locator('input.qty-input')).toHaveValue(String(quantity));
  }

  /** Returns [unitPrice, quantity, lineTotal] for a product row. */
  async lineValues(productName: string): Promise<[number, number, number]> {
    const row = this.row(productName);
    const num = async (l: Locator) => Number(((await l.textContent()) ?? '').replace(/[^\d.]/g, ''));
    const qty = Number(await row.locator('input.qty-input').inputValue());
    return [await num(row.locator('.product-unit-price')), qty, await num(row.locator('.product-subtotal'))];
  }
}
