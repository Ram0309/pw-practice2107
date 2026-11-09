import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Header elements shared by every Demo Web Shop page.
 * Locators were verified against the live site (see project-knowledge/automation-standards.md).
 */
export class BasePage {
  readonly searchInput: Locator;
  readonly searchButton: Locator;
  readonly cartQuantity: Locator;
  readonly loginLink: Locator;
  readonly logoutLink: Locator;
  readonly notification: Locator;
  readonly topMenu: Locator;

  constructor(readonly page: Page) {
    this.searchInput = page.locator('#small-searchterms');
    this.searchButton = page.getByRole('button', { name: 'Search' });
    this.cartQuantity = page.locator('.header-links span.cart-qty');
    this.loginLink = page.getByRole('link', { name: 'Log in' });
    this.logoutLink = page.getByRole('link', { name: 'Log out' });
    this.notification = page.locator('#bar-notification');
    this.topMenu = page.locator('ul.top-menu > li > a');
  }

  /** 'domcontentloaded': the demo's full 'load' event is slow (third-party assets); web-first assertions do the waiting. */
  async open(path = '/'): Promise<void> {
    await this.page.goto(path, { waitUntil: 'domcontentloaded' });
  }

  async search(term: string): Promise<void> {
    await this.searchInput.fill(term);
    await this.searchButton.click();
  }

  /** Reads "(N)" from the header and returns N. */
  async cartCount(): Promise<number> {
    const text = (await this.cartQuantity.textContent()) ?? '';
    return Number(text.replace(/[^\d]/g, '') || '0');
  }

  async expectCartCount(count: number): Promise<void> {
    await expect(this.cartQuantity).toHaveText(`(${count})`);
  }

  async expectNotification(text: string): Promise<void> {
    await expect(this.notification).toBeVisible();
    await expect(this.notification).toContainText(text);
  }
}
